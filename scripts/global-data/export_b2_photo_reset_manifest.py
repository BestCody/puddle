#!/usr/bin/env python3
"""Export a complete recovery manifest for the canonical photo pipeline.

The manifest is read-only with respect to the photo inventory. It records every
object in the Puddle-owned canonical media prefix, every photo-only B2 data
artifact, active-snapshot photo metadata, and the Supabase rows that can be
removed or have their photo link cleared by the reset operation. The manifest
is uploaded last, after all referenced files have been uploaded, and its
``status=complete`` value is the reset safety gate.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import gzip
import hashlib
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import boto3
import duckdb
from botocore.client import Config


SNAPSHOT_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
CANONICAL_HASH_RE = re.compile(r"^[0-9a-f]{64}$")


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


def validate_snapshot(value: object) -> str:
    snapshot = str(value or "").strip()
    if not SNAPSHOT_RE.fullmatch(snapshot):
        raise RuntimeError("The active location snapshot is not an ISO date.")
    return snapshot


def s3_client(endpoint: str, key_id: str, application_key: str, region: str, pool_size: int):
    return boto3.client(
        "s3",
        endpoint_url=required(endpoint, "B2 S3 endpoint"),
        aws_access_key_id=required(key_id, "B2 application key ID"),
        aws_secret_access_key=required(application_key, "B2 application key"),
        region_name=region or None,
        config=Config(
            retries={"max_attempts": 10, "mode": "adaptive"},
            max_pool_connections=max(8, pool_size),
        ),
    )


def serializable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, dict):
        return {str(key): serializable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [serializable(item) for item in value]
    return value


def list_objects(client, bucket: str, prefix: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix.rstrip("/") + "/"):
        for item in page.get("Contents", []):
            key = str(item.get("Key") or "")
            if not key:
                continue
            result.append(
                {
                    "key": key,
                    "listedSize": int(item.get("Size") or 0),
                    "etag": str(item.get("ETag") or "").strip('"'),
                    "lastModified": serializable(item.get("LastModified")),
                    "storageClass": str(item.get("StorageClass") or ""),
                }
            )
    return result


def get_json(client, bucket: str, key: str) -> dict[str, Any]:
    response = client.get_object(Bucket=bucket, Key=key)
    body = response["Body"]
    try:
        value = json.loads(body.read())
    finally:
        body.close()
    if not isinstance(value, dict):
        raise RuntimeError(f"B2 JSON object is not an object: {key}")
    return value


def canonical_media_pattern(prefix: str) -> re.Pattern[str]:
    return re.compile(r"^" + re.escape(prefix) + r"/([0-9a-f]{2})/([0-9a-f]{64})\.jpg$")


def media_head(client, bucket: str, item: dict[str, Any], pattern: re.Pattern[str]) -> dict[str, Any]:
    key = str(item["key"])
    head = client.head_object(Bucket=bucket, Key=key)
    match = pattern.fullmatch(key)
    expected_hash = match.group(2) if match else None
    issues: list[str] = []
    if match and match.group(1) != match.group(2)[:2]:
        issues.append("hash_prefix_mismatch")
    metadata = {
        str(name).lower(): str(value).strip()
        for name, value in (head.get("Metadata") or {}).items()
    }
    if match and metadata.get("sha256", "").lower() != expected_hash:
        issues.append("sha256_metadata_mismatch")
    if match and metadata.get("purpose") != "puddle_open_location_photo":
        issues.append("purpose_metadata_mismatch")
    size = int(head.get("ContentLength") or 0)
    if int(item.get("listedSize") or 0) != size:
        issues.append("listing_size_mismatch")
    return {
        "key": key,
        "listedSize": int(item.get("listedSize") or 0),
        "size": size,
        "etag": str(head.get("ETag") or "").strip('"'),
        "lastModified": serializable(head.get("LastModified")),
        "contentType": str(head.get("ContentType") or ""),
        "cacheControl": str(head.get("CacheControl") or ""),
        "metadata": metadata,
        "canonicalKey": bool(match and match.group(1) == match.group(2)[:2]),
        "contentSha256": expected_hash,
        "issues": sorted(set(issues)),
    }


def photo_data_key_matcher(data_prefix: str, snapshot: str):
    normalized = re.compile(
        r"^"
        + re.escape(data_prefix)
        + r"/normalized/schema=v1/snapshot=[^/]+/country_code=[^/]+/photo_metadata\.parquet$"
    )
    active_search_overlay = re.compile(
        r"^"
        + re.escape(data_prefix)
        + r"/search/schema=v1/snapshot=[^/]+/photo-overlay-v1(?:/|$)"
    )
    prefixes = (
        f"{data_prefix}/enrichment/photo_candidates",
        f"{data_prefix}/enrichment/photo_metadata",
        f"{data_prefix}/enrichment/photo_attempts",
        f"{data_prefix}/enrichment/photo_exclusions",
        f"{data_prefix}/enrichment/photo_state",
        f"{data_prefix}/enrichment/photo_cursors",
        f"{data_prefix}/enrichment/photo_registry_state",
        f"{data_prefix}/search/photo-overlay-v1",
    )

    def matches(key: str) -> tuple[bool, str]:
        if normalized.fullmatch(key):
            return True, "normalized_photo_metadata"
        if active_search_overlay.fullmatch(key):
            return True, "search_photo_overlay"
        for prefix in prefixes:
            if key.startswith(prefix.rstrip("/") + "/"):
                return True, prefix[len(data_prefix) + 1 :]
        return False, ""

    return matches


def write_jsonl_gzip(path: Path, rows: Iterable[dict[str, Any]]) -> tuple[int, int, str]:
    count = 0
    with gzip.open(path, "wt", encoding="utf-8", newline="\n") as stream:
        for row in rows:
            stream.write(json.dumps(serializable(row), ensure_ascii=False, separators=(",", ":")))
            stream.write("\n")
            count += 1
    return count, path.stat().st_size, file_sha256(path)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sql_escape(value: str) -> str:
    return value.replace("'", "''")


def configure_duckdb(con, bucket: str, endpoint: str, key_id: str, application_key: str, region: str) -> None:
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET preserve_insertion_order=false")
    endpoint_host = endpoint.replace("https://", "").replace("http://", "").rstrip("/")
    con.execute(
        f"""
CREATE OR REPLACE SECRET b2_photo_manifest_secret (
  TYPE S3,
  KEY_ID '{sql_escape(key_id)}',
  SECRET '{sql_escape(application_key)}',
  REGION '{sql_escape(region)}',
  ENDPOINT '{sql_escape(endpoint_host)}',
  URL_STYLE 'path',
  USE_SSL true
);
"""
    )


def parquet_rows(
    con,
    bucket: str,
    prefix: str,
    source_name: str,
    output: Path,
    file_count: int,
    filename: str = "*.parquet",
) -> tuple[int, int, str]:
    if file_count == 0:
        return write_jsonl_gzip(output, [])
    glob = f"s3://{bucket}/{prefix.rstrip('/')}/country_code=*/{filename}"
    cursor = con.execute(
        f"SELECT * FROM read_parquet('{sql_escape(glob)}', union_by_name=true, hive_partitioning=true)"
    )
    columns = [str(item[0]) for item in cursor.description]
    count = 0
    with gzip.open(output, "wt", encoding="utf-8", newline="\n") as stream:
        while True:
            batch = cursor.fetchmany(1000)
            if not batch:
                break
            for values in batch:
                row = {"metadataSource": source_name}
                row.update({column: serializable(value) for column, value in zip(columns, values)})
                stream.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
                stream.write("\n")
                count += 1
    return count, output.stat().st_size, file_sha256(output)


def supabase_rows(
    base_url: str,
    service_key: str,
    table: str,
    filters: list[tuple[str, str]],
    order: str,
    page_size: int = 1000,
    optional: bool = False,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        params = {"select": "*", "order": order, "limit": str(page_size), "offset": str(offset)}
        params.update({name: value for name, value in filters})
        url = f"{base_url}/rest/v1/{table}?{urlencode(params)}"
        request = Request(
            url,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Accept": "application/json",
                "Accept-Profile": "public",
                "Content-Profile": "public",
                "Prefer": "count=exact",
                "User-Agent": "Puddle/photo-reset-manifest",
            },
        )
        try:
            with urlopen(request, timeout=60) as response:
                payload = json.loads(response.read())
        except HTTPError as error:
            if optional and error.code == 404:
                return []
            status = getattr(error, "code", None)
            raise RuntimeError(f"Supabase table export failed for {table} ({status or 'network error'}).") from error
        except Exception as error:
            raise RuntimeError(f"Supabase table export failed for {table} (network error).") from error
        if not isinstance(payload, list):
            raise RuntimeError(f"Supabase table export returned a non-array for {table}.")
        rows.extend(payload)
        if len(payload) < page_size:
            break
        offset += page_size
    return rows


def upload_file(client, bucket: str, key: str, path: Path, content_type: str) -> None:
    client.upload_file(
        str(path),
        bucket,
        key,
        ExtraArgs={
            "ContentType": content_type,
            "CacheControl": "private,max-age=31536000,immutable",
        },
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", default="")
    parser.add_argument("--manifest-id", default="")
    parser.add_argument("--output-dir", default="")
    parser.add_argument("--workers", type=int, default=32)
    args = parser.parse_args()
    if args.workers < 1 or args.workers > 64:
        raise RuntimeError("--workers must be between 1 and 64.")

    data_bucket = first_env("B2_DATA_BUCKET_NAME", "B2_BUCKET", default="puddle-assets")
    data_endpoint = first_env("B2_DATA_S3_ENDPOINT", "B2_S3_ENDPOINT")
    data_key_id = first_env("B2_DATA_KEY_ID", "B2_DATA_APPLICATION_KEY_ID", "B2_KEY_ID")
    data_key = first_env("B2_DATA_APPLICATION_KEY", "B2_APPLICATION_KEY")
    data_region = first_env("B2_DATA_S3_REGION", "B2_REGION", default="us-east-005")
    data_prefix = clean_prefix(first_env("B2_DATA_PREFIX", default="data"))

    media_bucket = first_env("B2_MEDIA_BUCKET_NAME", "B2_DATA_BUCKET_NAME", "B2_BUCKET", default=data_bucket)
    media_endpoint = first_env("B2_MEDIA_S3_ENDPOINT", "B2_DATA_S3_ENDPOINT", "B2_S3_ENDPOINT", default=data_endpoint)
    media_key_id = first_env(
        "B2_MEDIA_KEY_ID",
        "B2_MEDIA_APPLICATION_KEY_ID",
        "B2_DATA_KEY_ID",
        "B2_DATA_APPLICATION_KEY_ID",
        "B2_KEY_ID",
        default=data_key_id,
    )
    media_key = first_env(
        "B2_MEDIA_APPLICATION_KEY",
        "B2_DATA_APPLICATION_KEY",
        "B2_APPLICATION_KEY",
        default=data_key,
    )
    media_region = first_env("B2_MEDIA_S3_REGION", "B2_DATA_S3_REGION", "B2_REGION", default=data_region)
    media_prefix = clean_prefix(first_env("B2_MEDIA_OPEN_PHOTO_PREFIX", default="media/photos/by-sha256"))
    supabase_url = first_env("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL").rstrip("/")
    supabase_key = first_env("SUPABASE_SECRET_KEY")
    required(supabase_url, "Supabase URL")
    required(supabase_key, "Supabase service key")

    data_client = s3_client(data_endpoint, data_key_id, data_key, data_region, args.workers)
    media_client = s3_client(media_endpoint, media_key_id, media_key, media_region, args.workers * 2)
    active_manifest_key = f"{data_prefix}/manifests/active-location-snapshot.json"
    active = get_json(data_client, data_bucket, active_manifest_key)
    active_snapshot = validate_snapshot(active.get("snapshot"))
    snapshot = validate_snapshot(args.snapshot or active_snapshot)

    media_items = list_objects(media_client, media_bucket, media_prefix)
    pattern = canonical_media_pattern(media_prefix)
    media_records: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(media_head, media_client, media_bucket, item, pattern) for item in media_items]
        for future in concurrent.futures.as_completed(futures):
            media_records.append(future.result())
    media_records.sort(key=lambda row: str(row["key"]))

    matcher = photo_data_key_matcher(data_prefix, snapshot)
    data_records: list[dict[str, Any]] = []
    seen_data_keys: set[str] = set()
    data_list_prefixes = [
        f"{data_prefix}/enrichment/photo_candidates",
        f"{data_prefix}/enrichment/photo_metadata",
        f"{data_prefix}/enrichment/photo_attempts",
        f"{data_prefix}/enrichment/photo_exclusions",
        f"{data_prefix}/enrichment/photo_state",
        f"{data_prefix}/enrichment/photo_cursors",
        f"{data_prefix}/enrichment/photo_registry_state",
        f"{data_prefix}/search/photo-overlay-v1",
        f"{data_prefix}/search/schema=v1",
        f"{data_prefix}/normalized/schema=v1",
    ]
    for prefix in data_list_prefixes:
        for item in list_objects(data_client, data_bucket, prefix):
            key = str(item["key"])
            if key in seen_data_keys:
                continue
            matches, scope = matcher(key)
            if not matches:
                continue
            seen_data_keys.add(key)
            item["scope"] = scope
            data_records.append(item)
    data_records.sort(key=lambda row: str(row["key"]))

    normalized_prefix = f"{data_prefix}/normalized/schema=v1/snapshot={snapshot}"
    enriched_prefix = f"{data_prefix}/enrichment/photo_metadata/snapshot={snapshot}"
    normalized_files = [
        row for row in data_records if str(row["key"]).startswith(normalized_prefix + "/") and str(row["key"]).endswith("/photo_metadata.parquet")
    ]
    enriched_files = [
        row for row in data_records if str(row["key"]).startswith(enriched_prefix + "/") and str(row["key"]).endswith(".parquet")
    ]

    db_tables = {
        "location_photo_sources": {
            "filters": [("storage_backend", "eq.b2")],
            "order": "id",
            "optional": True,
        },
        "media_objects": {
            "filters": [("storage_backend", "eq.b2")],
            "order": "id",
            "optional": False,
        },
        "static_location_assets": {
            "filters": [("media_object_id", "not.is.null")],
            "order": "static_location_id",
            "optional": True,
        },
        "global_photo_claims": {"filters": [], "order": "location_id", "optional": False},
        "global_photo_candidate_registry": {
            "filters": [],
            "order": "provider_code,provider_asset_id",
            "optional": True,
        },
    }
    db_rows = {
        table: supabase_rows(
            supabase_url,
            supabase_key,
            table,
            config["filters"],
            config["order"],
            optional=config["optional"],
        )
        for table, config in db_tables.items()
    }

    output_dir = Path(args.output_dir or tempfile.mkdtemp(prefix="puddle-photo-reset-manifest-"))
    output_dir.mkdir(parents=True, exist_ok=True)
    created_temp_dir = not bool(args.output_dir)
    file_specs: dict[str, dict[str, Any]] = {}

    def record_file(name: str, path: Path, count: int, remote_key: str) -> None:
        file_specs[name] = {
            "key": remote_key,
            "rows": count,
            "bytes": path.stat().st_size,
            "sha256": file_sha256(path),
        }

    media_path = output_dir / "canonical-media-objects.jsonl.gz"
    media_count, _, _ = write_jsonl_gzip(media_path, media_records)
    data_path = output_dir / "photo-data-objects.jsonl.gz"
    data_count, _, _ = write_jsonl_gzip(data_path, data_records)
    metadata_path = output_dir / "active-photo-metadata.jsonl.gz"
    con = duckdb.connect()
    try:
        configure_duckdb(con, data_bucket, data_endpoint, data_key_id, data_key, data_region)
        normalized_count, _, _ = parquet_rows(
            con,
            data_bucket,
            normalized_prefix,
            "normalized",
            metadata_path,
            len(normalized_files),
            filename="photo_metadata.parquet",
        )
        enriched_path = output_dir / "active-enriched-photo-metadata.jsonl.gz"
        enriched_count, _, _ = parquet_rows(
            con, data_bucket, enriched_prefix, "enriched", enriched_path, len(enriched_files)
        )
    finally:
        con.close()

    manifest_id = args.manifest_id.strip() or (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        + (f"-{os.getenv('GITHUB_RUN_ID').strip()}" if os.getenv("GITHUB_RUN_ID", "").strip() else "")
    )
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", manifest_id):
        raise RuntimeError("manifest ID contains unsafe characters")
    remote_root = f"{data_prefix}/manifests/photo-reset/{manifest_id}"

    record_file("mediaObjects", media_path, media_count, f"{remote_root}/{media_path.name}")
    record_file("dataObjects", data_path, data_count, f"{remote_root}/{data_path.name}")
    record_file("normalizedPhotoMetadata", metadata_path, normalized_count, f"{remote_root}/{metadata_path.name}")
    record_file("enrichedPhotoMetadata", enriched_path, enriched_count, f"{remote_root}/{enriched_path.name}")

    for table, rows in db_rows.items():
        path = output_dir / f"supabase-{table}.jsonl.gz"
        count, _, _ = write_jsonl_gzip(path, rows)
        record_file(f"supabase.{table}", path, count, f"{remote_root}/{path.name}")

    canonical_media_rows = [row for row in media_records if row.get("canonicalKey")]
    manifest = {
        "schemaVersion": 1,
        "status": "complete",
        "manifestId": manifest_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "activeManifestKey": active_manifest_key,
        "activeSnapshot": active_snapshot,
        "auditedSnapshot": snapshot,
        "dataBucket": data_bucket,
        "dataPrefix": data_prefix,
        "mediaBucket": media_bucket,
        "mediaPrefix": media_prefix,
        "scopes": {
            "media": f"{media_prefix}/<all objects>",
            "photoDataPrefixes": [
                f"{data_prefix}/enrichment/photo_candidates/",
                f"{data_prefix}/enrichment/photo_metadata/",
                f"{data_prefix}/enrichment/photo_attempts/",
                f"{data_prefix}/enrichment/photo_exclusions/",
                f"{data_prefix}/enrichment/photo_state/",
                f"{data_prefix}/enrichment/photo_cursors/",
                f"{data_prefix}/enrichment/photo_registry_state/",
                f"{data_prefix}/search/photo-overlay-v1/",
                f"{data_prefix}/search/schema=v1/<snapshot>/photo-overlay-v1/",
            ],
            "normalizedPhotoMetadataPattern": f"{data_prefix}/normalized/schema=v1/snapshot=<snapshot>/country_code=<country>/photo_metadata.parquet",
        },
        "counts": {
            "mediaObjectsInOwnedPrefix": len(media_records),
            "canonicalMediaObjects": len(canonical_media_rows),
            "nonCanonicalMediaObjectsInOwnedPrefix": len(media_records) - len(canonical_media_rows),
            "photoDataObjects": len(data_records),
            "normalizedMetadataRows": normalized_count,
            "enrichedMetadataRows": enriched_count,
            "supabaseRows": {table: len(rows) for table, rows in db_rows.items()},
        },
        "files": file_specs,
        "resetContract": {
            "deleteCanonicalMediaPrefix": True,
            "deletePhotoDataOnly": True,
            "deleteB2BackedPhotoRows": True,
            "clearStaticPhotoLinksPreserveGoogleMetadata": True,
            "preserveUserMediaAndGeneralCatalogue": True,
            "preserveManifest": True,
        },
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    for spec in file_specs.values():
        path = output_dir / Path(str(spec["key"])).name
        upload_file(data_client, data_bucket, str(spec["key"]), path, "application/gzip")
    manifest_key = f"{remote_root}/manifest.json"
    upload_file(data_client, data_bucket, manifest_key, manifest_path, "application/json")

    print(
        json.dumps(
            {
                "ok": True,
                "status": "complete",
                "manifestKey": manifest_key,
                "manifestId": manifest_id,
                "snapshot": snapshot,
                "counts": manifest["counts"],
            },
            indent=2,
            sort_keys=True,
        ),
        flush=True,
    )
    if created_temp_dir:
        shutil.rmtree(output_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
