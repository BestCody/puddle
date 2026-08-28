#!/usr/bin/env python3
"""Verify every photo produced by the pilot against the canonical contract."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import urllib.error
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import boto3
import brotli
import duckdb
from botocore.client import Config
from PIL import Image


PROVIDER_CODES = {"wikimedia-commons": 1, "mapillary": 2, "kartaview": 3}
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
PHASH_RE = re.compile(r"^[0-9a-f]{16}$")
UUID_RE = re.compile(r"^[0-9a-fA-F-]{16,64}$")


def first_env(*names: str, default: str = "") -> str:
    for name in names:
        value = str(os.getenv(name, "")).strip()
        if value:
            return value
    return default


def clean_prefix(value: object) -> str:
    return "/".join(part for part in str(value or "").strip("/").split("/") if part)


def required(value: str, label: str) -> str:
    if not value:
        raise RuntimeError(f"{label} is required.")
    return value


def make_client(endpoint: str, key_id: str, application_key: str, region: str, pool_size: int):
    return boto3.client(
        "s3",
        endpoint_url=required(endpoint, "B2 S3 endpoint"),
        aws_access_key_id=required(key_id, "B2 application key ID"),
        aws_secret_access_key=required(application_key, "B2 application key"),
        region_name=region or None,
        config=Config(retries={"max_attempts": 10, "mode": "adaptive"}, max_pool_connections=pool_size),
    )


def list_keys(s3, bucket: str, prefix: str) -> list[str]:
    keys: list[str] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix.rstrip("/") + "/"):
        keys.extend(str(item.get("Key") or "") for item in page.get("Contents", []) if item.get("Key"))
    return sorted(set(keys))


def read_bytes(s3, bucket: str, key: str) -> bytes:
    response = s3.get_object(Bucket=bucket, Key=key)
    body = response["Body"]
    try:
        return body.read()
    finally:
        body.close()


def json_object(s3, bucket: str, key: str) -> dict:
    payload = json.loads(read_bytes(s3, bucket, key))
    if not isinstance(payload, dict):
        raise RuntimeError(f"B2 object is not a JSON object: {key}")
    return payload


def configure_duckdb(con, bucket: str, endpoint: str, key_id: str, application_key: str, region: str) -> None:
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET preserve_insertion_order=false")
    endpoint_host = endpoint.replace("https://", "").replace("http://", "").rstrip("/")
    quote = lambda value: str(value).replace("'", "''")
    con.execute(
        f"""
CREATE OR REPLACE SECRET b2_photo_pilot_secret (
  TYPE S3,
  KEY_ID '{quote(key_id)}',
  SECRET '{quote(application_key)}',
  REGION '{quote(region)}',
  ENDPOINT '{quote(endpoint_host)}',
  URL_STYLE 'path',
  USE_SSL true
);
"""
    )


def fetch_rows(base_url: str, key: str, table: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        params = {"select": "*", "order": "provider_code,provider_asset_id", "limit": "1000", "offset": str(offset)}
        if table == "global_photo_candidate_registry":
            params["provider_code"] = "in.(1,2,3)"
        request = Request(
            f"{base_url}/rest/v1/{table}?{urlencode(params)}",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Accept": "application/json",
                "Accept-Profile": "public",
                "Content-Profile": "public",
                "User-Agent": "Puddle/photo-pilot-verifier",
            },
        )
        try:
            with urlopen(request, timeout=60) as response:
                payload = json.loads(response.read())
        except Exception as error:
            status = getattr(error, "code", None)
            raise RuntimeError(f"Supabase pilot verification failed for {table} ({status or 'network error'}).") from error
        if not isinstance(payload, list):
            raise RuntimeError(f"Supabase pilot verification returned a non-array for {table}.")
        rows.extend(payload)
        if len(payload) < 1000:
            return rows
        offset += 1000


def normalized_hash(value: object) -> str:
    text = str(value or "").strip().lower()
    if text.startswith("\\x"):
        text = text[2:]
    if text.startswith("0x"):
        text = text[2:]
    return text


def dhash(image: Image.Image) -> str:
    gray = image.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    pixels = list(gray.getdata())
    bits = 0
    for row in range(8):
        for column in range(8):
            bits = (bits << 1) | int(pixels[row * 9 + column] > pixels[row * 9 + column + 1])
    return f"{bits:016x}"


def load_metadata(con, bucket: str, data_prefix: str, snapshot: str) -> list[dict]:
    rows: list[dict] = []
    for source_name, prefix in (
        ("normalized", f"{data_prefix}/normalized/schema=v1/snapshot={snapshot}"),
        ("enriched", f"{data_prefix}/enrichment/photo_metadata/snapshot={snapshot}"),
    ):
        keys = list_keys(DATA_S3, bucket, prefix)
        parquet_keys = [key for key in keys if key.endswith(".parquet") and (source_name == "enriched" or key.endswith("/photo_metadata.parquet"))]
        countries = sorted({
            match.group(1)
            for key in parquet_keys
            if (match := re.search(r"/country_code=([^/]+)/", key))
        })
        for country in countries:
            glob = f"s3://{bucket}/{prefix}/country_code={country}/*.parquet"
            if source_name == "normalized":
                glob = f"s3://{bucket}/{prefix}/country_code={country}/photo_metadata.parquet"
            cursor = con.execute(
                f"SELECT * FROM read_parquet('{glob.replace(chr(39), chr(39) * 2)}', union_by_name=true, hive_partitioning=true)"
            )
            columns = [str(item[0]) for item in cursor.description]
            for values in cursor.fetchall():
                row = {"metadataSource": source_name, "metadataCountry": country}
                row.update(dict(zip(columns, values)))
                rows.append(row)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--countries", default="")
    parser.add_argument("--report", default="pilot-verification.json")
    args = parser.parse_args()

    data_bucket = first_env("B2_DATA_BUCKET_NAME", "B2_BUCKET", default="puddle-assets")
    data_endpoint = first_env("B2_DATA_S3_ENDPOINT", "B2_S3_ENDPOINT")
    data_key_id = first_env("B2_DATA_KEY_ID", "B2_DATA_APPLICATION_KEY_ID", "B2_KEY_ID")
    data_key = first_env("B2_DATA_APPLICATION_KEY", "B2_APPLICATION_KEY")
    data_region = first_env("B2_DATA_S3_REGION", "B2_REGION", default="us-east-005")
    data_prefix = clean_prefix(first_env("B2_DATA_PREFIX", default="data"))
    media_bucket = first_env("B2_MEDIA_BUCKET_NAME", "B2_DATA_BUCKET_NAME", "B2_BUCKET", default=data_bucket)
    media_endpoint = first_env("B2_MEDIA_S3_ENDPOINT", "B2_DATA_S3_ENDPOINT", "B2_S3_ENDPOINT", default=data_endpoint)
    media_key_id = first_env("B2_MEDIA_KEY_ID", "B2_MEDIA_APPLICATION_KEY_ID", "B2_DATA_KEY_ID", "B2_KEY_ID", default=data_key_id)
    media_key = first_env("B2_MEDIA_APPLICATION_KEY", "B2_DATA_APPLICATION_KEY", default=data_key)
    media_region = first_env("B2_MEDIA_S3_REGION", "B2_DATA_S3_REGION", "B2_REGION", default=data_region)
    media_prefix = clean_prefix(first_env("B2_MEDIA_OPEN_PHOTO_PREFIX", default="media/photos/by-sha256"))
    supabase_url = first_env("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL").rstrip("/")
    supabase_key = first_env("SUPABASE_SECRET_KEY")
    required(supabase_url, "Supabase URL")
    required(supabase_key, "Supabase service key")

    global DATA_S3
    DATA_S3 = make_client(data_endpoint, data_key_id, data_key, data_region, 16)
    media_s3 = make_client(media_endpoint, media_key_id, media_key, media_region, 16)
    active = json_object(DATA_S3, data_bucket, f"{data_prefix}/manifests/active-location-snapshot.json")
    active_snapshot = str(active.get("snapshot") or "")
    if active_snapshot != args.snapshot:
        raise RuntimeError(f"pilot snapshot {args.snapshot} is not active ({active_snapshot})")

    con = duckdb.connect()
    try:
        configure_duckdb(con, data_bucket, data_endpoint, data_key_id, data_key, data_region)
        metadata_rows = load_metadata(con, data_bucket, data_prefix, args.snapshot)
        requested_countries = {
            value.strip().upper()
            for value in args.countries.split(",")
            if value.strip()
        }
        if requested_countries:
            metadata_rows = [
                row for row in metadata_rows
                if str(row.get("metadataCountry") or "").upper() in requested_countries
            ]
        location_ids_by_country: dict[str, set[str]] = {}
        for row in metadata_rows:
            country = str(row.get("metadataCountry") or "")
            location_ids_by_country.setdefault(country, set()).add(str(row.get("location_id") or ""))
        known_locations: set[str] = set()
        con.execute("CREATE TEMP TABLE pilot_location_ids(location_id VARCHAR)")
        for country, ids in location_ids_by_country.items():
            if not country:
                continue
            con.execute("DELETE FROM pilot_location_ids")
            con.executemany("INSERT INTO pilot_location_ids VALUES (?)", [(value,) for value in sorted(ids) if value])
            location_path = f"s3://{data_bucket}/{data_prefix}/normalized/schema=v1/snapshot={args.snapshot}/country_code={country}/locations.parquet"
            escaped = location_path.replace("'", "''")
            known_locations.update(
                str(row[0])
                for row in con.execute(
                    f"SELECT cast(l.id AS VARCHAR) FROM read_parquet('{escaped}') l JOIN pilot_location_ids p ON cast(l.id AS VARCHAR)=p.location_id"
                ).fetchall()
            )
    finally:
        con.close()

    registry_rows = fetch_rows(supabase_url, supabase_key, "global_photo_candidate_registry")
    registry = {
        (int(row.get("provider_code") or 0), str(row.get("provider_asset_id") or "")): row
        for row in registry_rows
    }
    pointer = json_object(DATA_S3, data_bucket, f"{data_prefix}/search/photo-overlay-v1/active.json")
    overlay_key = str(pointer.get("object_key") or "")
    if not overlay_key:
        raise RuntimeError("active photo overlay pointer has no object key")
    overlay_payload = json.loads(brotli.decompress(read_bytes(DATA_S3, data_bucket, overlay_key)))
    if not isinstance(overlay_payload, list) or len(overlay_payload) != 2:
        raise RuntimeError("active photo overlay has an invalid schema")
    overlay_entries = {
        str(entry[0]): entry[1]
        for entry in overlay_payload[1]
        if isinstance(entry, list) and len(entry) == 2
    }

    failures: list[dict] = []
    seen_locations: set[str] = set()
    seen_hashes: set[str] = set()
    seen_provider_assets: set[tuple[str, str]] = set()
    for row in metadata_rows:
        location_id = str(row.get("location_id") or "").strip()
        provider = str(row.get("provider") or "").strip()
        external_id = str(row.get("external_photo_id") or "").strip()
        content_hash = normalized_hash(row.get("content_hash"))
        perceptual_hash = normalized_hash(row.get("perceptual_hash"))
        storage_key = str(row.get("storage_key") or "").strip()
        errors: list[str] = []
        if not location_id or location_id not in known_locations:
            errors.append("invalid_location_mapping")
        if provider not in PROVIDER_CODES or not external_id:
            errors.append("missing_provider_identity")
        if not HASH_RE.fullmatch(content_hash):
            errors.append("missing_content_sha256")
        if not PHASH_RE.fullmatch(perceptual_hash):
            errors.append("missing_perceptual_hash")
        expected_key = f"{media_prefix}/{content_hash[:2]}/{content_hash}.jpg" if HASH_RE.fullmatch(content_hash) else ""
        if storage_key != expected_key:
            errors.append("noncanonical_storage_key")
        registry_row = registry.get((PROVIDER_CODES.get(provider, 0), external_id))
        normalized_url = str((registry_row or {}).get("normalized_source_url") or "").strip()
        if not registry_row or str(registry_row.get("status") or "") != "accepted":
            errors.append("missing_accepted_candidate_registry_row")
        if not normalized_url.startswith("https://"):
            errors.append("missing_normalized_source_url")
        if registry_row and normalized_hash(registry_row.get("content_sha256")) not in {"", content_hash}:
            errors.append("registry_content_hash_mismatch")
        if registry_row and str(registry_row.get("storage_key") or "") not in {"", storage_key}:
            errors.append("registry_storage_key_mismatch")

        if location_id in seen_locations:
            errors.append("duplicate_location_reference")
        if content_hash in seen_hashes:
            errors.append("duplicate_content_hash")
        if (provider, external_id) in seen_provider_assets:
            errors.append("duplicate_provider_asset")
        seen_locations.add(location_id)
        seen_hashes.add(content_hash)
        seen_provider_assets.add((provider, external_id))

        if expected_key:
            try:
                head = media_s3.head_object(Bucket=media_bucket, Key=expected_key)
                body = read_bytes(media_s3, media_bucket, expected_key)
                if hashlib.sha256(body).hexdigest() != content_hash:
                    errors.append("b2_content_hash_mismatch")
                if str((head.get("Metadata") or {}).get("sha256") or "").lower() != content_hash:
                    errors.append("b2_sha256_metadata_mismatch")
                if str((head.get("Metadata") or {}).get("purpose") or "") != "puddle_open_location_photo":
                    errors.append("b2_purpose_metadata_mismatch")
                if str(head.get("ContentType") or "").lower() != "image/jpeg":
                    errors.append("b2_content_type_mismatch")
                cache = str(head.get("CacheControl") or "").lower()
                if "max-age=31536000" not in cache or "immutable" not in cache:
                    errors.append("b2_cache_policy_mismatch")
                with Image.open(io.BytesIO(body)) as image:
                    image.verify()
                with Image.open(io.BytesIO(body)) as image:
                    if dhash(image) != perceptual_hash:
                        errors.append("perceptual_hash_mismatch")
            except Exception:
                errors.append("canonical_b2_object_missing_or_unreadable")

        entry = overlay_entries.get(location_id)
        if not entry or not isinstance(entry, list) or not entry or str(entry[0]).lower() != content_hash:
            errors.append("missing_searchable_reference")
        if errors:
            failures.append({"locationId": location_id, "provider": provider, "errors": sorted(set(errors))})

    report = {
        "ok": bool(metadata_rows) and not failures,
        "snapshot": args.snapshot,
        "countries": sorted({str(row.get("metadataCountry") or "") for row in metadata_rows}),
        "photosVerified": len(metadata_rows),
        "uniqueLocations": len(seen_locations),
        "uniqueContentHashes": len(seen_hashes),
        "uniqueProviderAssets": len(seen_provider_assets),
        "overlayObjectKey": overlay_key,
        "failures": failures[:50],
    }
    with open(args.report, "w", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2, sort_keys=True)
        stream.write("\n")
    print(json.dumps(report, indent=2, sort_keys=True), flush=True)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
