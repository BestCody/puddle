#!/usr/bin/env python3
"""Audit canonical B2 photo bytes and their active snapshot references.

This command is deliberately read-only. It lists and reads B2 objects, validates
their immutable content-addressed identity, and reads active-snapshot metadata.
It does not publish, change, or remove any B2 or Supabase state.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import io
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone

import boto3
import duckdb
from botocore.client import Config
from PIL import Image


HEX_HASH = re.compile(r"[0-9a-f]{64}")
SNAPSHOT = re.compile(r"\d{4}-\d{2}-\d{2}")
MAX_IMAGE_BYTES = 10_000_000
MAX_SOURCE_PIXELS = 40_000_000
MAX_WIDTH = 1_600
MAX_HEIGHT = 1_000


def first_env(*names: str, default: str = "") -> str:
    for name in names:
        value = str(os.getenv(name, "")).strip()
        if value:
            return value
    return default


def clean_prefix(value: object) -> str:
    return "/".join(part for part in str(value or "").strip("/").split("/") if part)


def require(value: str, label: str) -> str:
    if not value:
        raise RuntimeError(f"{label} is required.")
    return value


def make_client(endpoint: str, key_id: str, application_key: str, region: str, pool_size: int):
    return boto3.client(
        "s3",
        endpoint_url=require(endpoint, "B2 endpoint"),
        aws_access_key_id=require(key_id, "B2 application key ID"),
        aws_secret_access_key=require(application_key, "B2 application key"),
        region_name=region or None,
        config=Config(
            retries={"max_attempts": 10, "mode": "adaptive"},
            max_pool_connections=max(8, pool_size),
        ),
    )


def list_objects(client, bucket: str, prefix: str) -> list[dict[str, object]]:
    objects: list[dict[str, object]] = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix.rstrip("/") + "/"):
        for item in page.get("Contents", []):
            key = str(item.get("Key") or "")
            if key:
                objects.append({"key": key, "listedSize": int(item.get("Size") or 0)})
    return objects


def read_json_object(client, bucket: str, key: str) -> dict:
    body = client.get_object(Bucket=bucket, Key=key)["Body"]
    try:
        value = json.loads(body.read())
    finally:
        body.close()
    return value if isinstance(value, dict) else {}


def validate_snapshot(value: object, label: str) -> str:
    snapshot = str(value or "").strip()
    if not SNAPSHOT.fullmatch(snapshot):
        raise RuntimeError(f"{label} must be an ISO date snapshot.")
    return snapshot


def audit_object(
    client,
    bucket: str,
    item: dict[str, object],
    pattern: re.Pattern[str],
    max_bytes: int,
) -> dict[str, object]:
    key = str(item["key"])
    issues: list[str] = []
    match = pattern.fullmatch(key)
    expected_hash = ""
    if not match:
        return {"key": key, "issues": ["noncanonical_key"], "expectedHash": None}

    prefix, expected_hash = match.groups()
    if prefix != expected_hash[:2]:
        issues.append("hash_prefix_mismatch")

    try:
        head = client.head_object(Bucket=bucket, Key=key)
    except Exception:
        return {"key": key, "issues": ["head_failed"], "expectedHash": expected_hash}

    size = int(head.get("ContentLength") or 0)
    listed_size = int(item.get("listedSize") or 0)
    if listed_size != size:
        issues.append("listing_size_mismatch")
    if size <= 0:
        issues.append("empty_object")
    if size > max_bytes:
        issues.append("size_exceeds_limit")

    content_type = str(head.get("ContentType") or "").lower().strip()
    if content_type != "image/jpeg":
        issues.append("content_type_not_jpeg")

    cache_control = str(head.get("CacheControl") or "").lower()
    if "max-age=31536000" not in cache_control or "immutable" not in cache_control:
        issues.append("cache_policy_mismatch")

    metadata = {
        str(name).lower(): str(value).strip()
        for name, value in (head.get("Metadata") or {}).items()
    }
    if metadata.get("sha256", "").lower() != expected_hash:
        issues.append("sha256_metadata_mismatch")
    if metadata.get("purpose") != "puddle_open_location_photo":
        issues.append("purpose_metadata_mismatch")

    body = b""
    if size <= max_bytes and size > 0:
        try:
            response = client.get_object(Bucket=bucket, Key=key)
            stream = response["Body"]
            try:
                body = stream.read(max_bytes + 1)
            finally:
                stream.close()
        except Exception:
            issues.append("read_failed")

    if body:
        if len(body) != size:
            issues.append("read_size_mismatch")
        if len(body) <= max_bytes:
            actual_hash = hashlib.sha256(body).hexdigest()
            if actual_hash != expected_hash:
                issues.append("sha256_content_mismatch")
            try:
                with Image.open(io.BytesIO(body)) as image:
                    image.verify()
                with Image.open(io.BytesIO(body)) as image:
                    image_format = str(image.format or "").upper()
                    width, height = image.size
                    mode = str(image.mode or "")
                    if width * height <= MAX_SOURCE_PIXELS:
                        image.load()
                if image_format != "JPEG":
                    issues.append("decoded_format_not_jpeg")
                if width <= 0 or height <= 0:
                    issues.append("invalid_dimensions")
                if width * height > MAX_SOURCE_PIXELS:
                    issues.append("source_pixels_exceed_safety_limit")
                if width > MAX_WIDTH or height > MAX_HEIGHT:
                    issues.append("dimensions_exceed_normalized_limit")
                if mode != "RGB":
                    issues.append("decoded_mode_not_rgb")
            except Exception:
                issues.append("image_decode_failed")
    elif size > 0 and size <= max_bytes and "read_failed" not in issues:
        issues.append("empty_read")

    return {
        "key": key,
        "expectedHash": expected_hash,
        "size": size,
        "issues": sorted(set(issues)),
    }


def sql_identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def source_column(columns: dict[str, str], name: str, sql_type: str) -> str:
    actual = columns.get(name.lower())
    if not actual:
        return f"NULL::{sql_type} AS {name}"
    return f"cast({sql_identifier(actual)} AS {sql_type}) AS {name}"


def configure_duckdb(con, bucket: str, endpoint: str, key_id: str, application_key: str, region: str) -> None:
    endpoint_host = endpoint.replace("https://", "").replace("http://", "").rstrip("/")
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET preserve_insertion_order=false")
    con.execute(
        f"""
CREATE OR REPLACE SECRET b2_photo_audit_secret (
  TYPE S3,
  KEY_ID '{key_id.replace("'", "''")}',
  SECRET '{application_key.replace("'", "''")}',
  REGION '{region.replace("'", "''")}',
  ENDPOINT '{endpoint_host.replace("'", "''")}',
  URL_STYLE 'path',
  USE_SSL true
);
"""
    )


def read_active_photo_metadata(
    data_client,
    data_bucket: str,
    data_prefix: str,
    snapshot: str,
    data_endpoint: str,
    data_key_id: str,
    data_key: str,
    data_region: str,
    media_prefix: str,
) -> dict[str, object]:
    normalized_prefix = f"{data_prefix}/normalized/schema=v1/snapshot={snapshot}"
    enriched_prefix = f"{data_prefix}/enrichment/photo_metadata/snapshot={snapshot}"
    normalized_keys = list_objects(data_client, data_bucket, normalized_prefix)
    enriched_keys = list_objects(data_client, data_bucket, enriched_prefix)
    normalized_files = [
        item["key"]
        for item in normalized_keys
        if str(item["key"]).endswith("/photo_metadata.parquet")
    ]
    enriched_files = [
        item["key"] for item in enriched_keys if str(item["key"]).endswith(".parquet")
    ]

    sources: list[dict[str, object]] = []
    if normalized_files:
        sources.append(
            {
                "name": "normalized",
                "glob": f"s3://{data_bucket}/{normalized_prefix}/country_code=*/photo_metadata.parquet",
                "hive": True,
                "files": len(normalized_files),
            }
        )
    if enriched_files:
        sources.append(
            {
                "name": "enriched",
                "glob": f"s3://{data_bucket}/{enriched_prefix}/country_code=*/*.parquet",
                "hive": True,
                "files": len(enriched_files),
            }
        )

    con = duckdb.connect()
    try:
        configure_duckdb(con, data_bucket, data_endpoint, data_key_id, data_key, data_region)
        con.execute(
            """
CREATE TEMP TABLE photo_refs(
  location_id VARCHAR,
  content_hash VARCHAR,
  storage_key VARCHAR,
  provider VARCHAR,
  attribution VARCHAR,
  attribution_url VARCHAR,
  license VARCHAR,
  license_url VARCHAR,
  source VARCHAR
)
"""
        )
        compatible_sources = 0
        incompatible_files = 0
        for source in sources:
            glob = str(source["glob"])
            hive = "true" if source["hive"] else "false"
            try:
                columns = {
                    str(row[0]).lower(): str(row[0])
                    for row in con.execute(
                        f"DESCRIBE SELECT * FROM read_parquet('{glob}', union_by_name=true, hive_partitioning={hive})"
                    ).fetchall()
                }
            except Exception:
                incompatible_files += int(source["files"])
                continue
            if not {"location_id", "content_hash"}.issubset(columns):
                incompatible_files += int(source["files"])
                continue
            projection = [
                source_column(columns, "location_id", "VARCHAR"),
                source_column(columns, "content_hash", "VARCHAR"),
                source_column(columns, "storage_key", "VARCHAR"),
                source_column(columns, "provider", "VARCHAR"),
                source_column(columns, "attribution", "VARCHAR"),
                source_column(columns, "attribution_url", "VARCHAR"),
                source_column(columns, "license", "VARCHAR"),
                source_column(columns, "license_url", "VARCHAR"),
                f"'{str(source['name'])}' AS source",
            ]
            con.execute(
                f"INSERT INTO photo_refs SELECT {','.join(projection)} FROM read_parquet('{glob}', union_by_name=true, hive_partitioning={hive})"
            )
            compatible_sources += 1

        metadata_rows = int(con.execute("SELECT count(*) FROM photo_refs").fetchone()[0])
        distinct_refs = int(
            con.execute(
                """
SELECT count(*) FROM (
  SELECT DISTINCT location_id,content_hash
  FROM photo_refs
  WHERE location_id IS NOT NULL AND content_hash IS NOT NULL
)
"""
            ).fetchone()[0]
        )
        invalid_reference_count = int(
            con.execute(
                """
SELECT count(*) FROM photo_refs
WHERE content_hash IS NULL
   OR NOT regexp_full_match(lower(trim(content_hash)), '[0-9a-f]{64}')
"""
            ).fetchone()[0]
        )
        storage_key_prefix_sql = media_prefix.replace("'", "''")
        invalid_storage_key_count = int(
            con.execute(
                f"""
SELECT count(*) FROM photo_refs
WHERE storage_key IS NOT NULL AND trim(storage_key) <> ''
  AND (
    content_hash IS NULL
    OR trim(storage_key) <> '{storage_key_prefix_sql}/' || substr(lower(trim(content_hash)),1,2) || '/' || lower(trim(content_hash)) || '.jpg'
  )
"""
            ).fetchone()[0]
        )
        incomplete_license_rows = int(
            con.execute(
                """
SELECT count(*) FROM photo_refs
WHERE content_hash IS NOT NULL
  AND (
    nullif(trim(coalesce(provider,'')), '') IS NULL
    OR nullif(trim(coalesce(attribution,'')), '') IS NULL
    OR nullif(trim(coalesce(attribution_url,'')), '') IS NULL
    OR nullif(trim(coalesce(license,'')), '') IS NULL
    OR nullif(trim(coalesce(license_url,'')), '') IS NULL
  )
"""
            ).fetchone()[0]
        )
        reference_hashes = {
            str(row[0]).lower().strip()
            for row in con.execute(
                """
SELECT DISTINCT lower(trim(content_hash))
FROM photo_refs
WHERE content_hash IS NOT NULL
  AND regexp_full_match(lower(trim(content_hash)), '[0-9a-f]{64}')
"""
            ).fetchall()
        }
    finally:
        con.close()

    return {
        "metadataFiles": len(normalized_files) + len(enriched_files),
        "normalizedMetadataFiles": len(normalized_files),
        "enrichedMetadataFiles": len(enriched_files),
        "compatibleMetadataSources": compatible_sources,
        "incompatibleMetadataFiles": incompatible_files,
        "metadataRows": metadata_rows,
        "distinctLocationPhotoReferences": distinct_refs,
        "referenceHashCount": len(reference_hashes),
        "invalidReferenceCount": invalid_reference_count,
        "invalidStorageKeyCount": invalid_storage_key_count,
        "incompleteLicenseMetadataRows": incomplete_license_rows,
        "referenceHashes": reference_hashes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", default="", help="ISO snapshot date; empty reads the active manifest")
    parser.add_argument(
        "--media-prefix",
        default=first_env("B2_MEDIA_OPEN_PHOTO_PREFIX", default="media/photos/by-sha256"),
    )
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--max-image-bytes", type=int, default=MAX_IMAGE_BYTES)
    parser.add_argument("--max-samples", type=int, default=25)
    args = parser.parse_args()

    if args.workers < 1 or args.workers > 64:
        raise RuntimeError("--workers must be between 1 and 64.")
    if args.max_image_bytes < 1 or args.max_image_bytes > MAX_IMAGE_BYTES:
        raise RuntimeError("--max-image-bytes must be between 1 and 10000000.")

    scan_started = datetime.now(timezone.utc)
    data_bucket = first_env("B2_DATA_BUCKET_NAME", "B2_BUCKET", default="puddle-assets")
    data_endpoint = first_env("B2_DATA_S3_ENDPOINT", "B2_S3_ENDPOINT")
    data_key_id = first_env("B2_DATA_KEY_ID", "B2_DATA_APPLICATION_KEY_ID", "B2_KEY_ID")
    data_key = first_env("B2_DATA_APPLICATION_KEY", "B2_APPLICATION_KEY")
    data_region = first_env("B2_DATA_S3_REGION", "B2_REGION", default="us-east-005")
    data_prefix = clean_prefix(first_env("B2_DATA_PREFIX", default="data"))

    media_bucket = first_env("B2_MEDIA_BUCKET_NAME", "B2_DATA_BUCKET_NAME", "B2_BUCKET", default=data_bucket)
    media_endpoint = first_env("B2_MEDIA_S3_ENDPOINT", "B2_DATA_S3_ENDPOINT", "B2_S3_ENDPOINT", default=data_endpoint)
    media_key_id = first_env("B2_MEDIA_KEY_ID", "B2_MEDIA_APPLICATION_KEY_ID", "B2_DATA_APPLICATION_KEY_ID", "B2_KEY_ID", default=data_key_id)
    media_key = first_env("B2_MEDIA_APPLICATION_KEY", "B2_DATA_APPLICATION_KEY", "B2_APPLICATION_KEY", default=data_key)
    media_region = first_env("B2_MEDIA_S3_REGION", "B2_DATA_S3_REGION", "B2_REGION", default=data_region)
    media_prefix = clean_prefix(args.media_prefix)
    if not media_prefix:
        raise RuntimeError("B2 media prefix is required.")

    data_client = make_client(data_endpoint, data_key_id, data_key, data_region, 16)
    media_client = make_client(media_endpoint, media_key_id, media_key, media_region, args.workers * 2)

    manifest_key = f"{data_prefix}/manifests/active-location-snapshot.json"
    manifest = read_json_object(data_client, data_bucket, manifest_key)
    manifest_snapshot = validate_snapshot(manifest.get("snapshot"), "active manifest snapshot")
    snapshot = validate_snapshot(args.snapshot or manifest_snapshot, "snapshot")

    media_objects = list_objects(media_client, media_bucket, media_prefix)
    pattern = re.compile(r"^" + re.escape(media_prefix) + r"/([0-9a-f]{2})/([0-9a-f]{64})\.jpg$")
    object_results: list[dict[str, object]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [
            pool.submit(audit_object, media_client, media_bucket, item, pattern, args.max_image_bytes)
            for item in media_objects
        ]
        for future in concurrent.futures.as_completed(futures):
            object_results.append(future.result())
    object_results.sort(key=lambda item: str(item.get("key") or ""))

    issue_counts: Counter[str] = Counter()
    invalid_results = []
    canonical_hashes: set[str] = set()
    valid_hashes: set[str] = set()
    total_bytes = 0
    for result in object_results:
        issues = [str(value) for value in result.get("issues", [])]
        issue_counts.update(issues)
        if result.get("expectedHash"):
            expected_hash = str(result["expectedHash"])
            canonical_hashes.add(expected_hash)
            if not issues:
                valid_hashes.add(expected_hash)
        total_bytes += int(result.get("size") or 0)
        if issues and len(invalid_results) < args.max_samples:
            invalid_results.append({"key": result.get("key"), "issues": issues})

    metadata = read_active_photo_metadata(
        data_client,
        data_bucket,
        data_prefix,
        snapshot,
        data_endpoint,
        data_key_id,
        data_key,
        data_region,
        media_prefix,
    )
    reference_hashes = set(metadata.pop("referenceHashes"))
    missing_reference_hashes = sorted(reference_hashes - canonical_hashes)
    unreferenced_hashes = sorted(canonical_hashes - reference_hashes)
    linked_invalid_hashes = sorted(reference_hashes - valid_hashes)

    hard_issue_counts = Counter(issue_counts)
    if missing_reference_hashes:
        hard_issue_counts["reference_missing_canonical_object"] = len(missing_reference_hashes)
    if metadata["invalidReferenceCount"]:
        hard_issue_counts["invalid_metadata_reference"] = int(metadata["invalidReferenceCount"])
    if metadata["invalidStorageKeyCount"]:
        hard_issue_counts["metadata_storage_key_mismatch"] = int(metadata["invalidStorageKeyCount"])
    if not canonical_hashes:
        hard_issue_counts["no_canonical_media_objects"] = 1

    scan_completed = datetime.now(timezone.utc)
    summary = {
        "ok": not hard_issue_counts,
        "scanStartedAt": scan_started.isoformat(),
        "scanCompletedAt": scan_completed.isoformat(),
        "bucket": media_bucket,
        "mediaPrefix": media_prefix,
        "activeManifestSnapshot": manifest_snapshot,
        "auditedSnapshot": snapshot,
        "requirements": {
            "canonicalKey": f"{media_prefix}/<first-two>/<sha256>.jpg",
            "maxImageBytes": args.max_image_bytes,
            "maxSourcePixels": MAX_SOURCE_PIXELS,
            "format": "JPEG",
            "mode": "RGB",
            "maxWidth": MAX_WIDTH,
            "maxHeight": MAX_HEIGHT,
            "contentHash": "SHA-256 of stored bytes",
            "requiredObjectMetadata": ["sha256", "purpose=puddle_open_location_photo"],
            "cachePolicy": "max-age=31536000, immutable",
        },
        "inventory": {
            "listedObjects": len(media_objects),
            "canonicalObjects": len(canonical_hashes),
            "validCanonicalObjects": len(valid_hashes),
            "invalidObjects": len(object_results) - len(valid_hashes),
            "totalBytes": total_bytes,
            "issueCounts": dict(sorted(issue_counts.items())),
        },
        "activeMetadata": {
            key: value
            for key, value in metadata.items()
            if key != "referenceHashes"
        },
        "linkage": {
            "missingCanonicalObjectHashCount": len(missing_reference_hashes),
            "linkedInvalidObjectHashCount": len(linked_invalid_hashes),
            "unreferencedCanonicalObjectHashCount": len(unreferenced_hashes),
            "sampleMissingHashes": missing_reference_hashes[:args.max_samples],
            "sampleLinkedInvalidHashes": linked_invalid_hashes[:args.max_samples],
            "sampleUnreferencedHashes": unreferenced_hashes[:args.max_samples],
        },
        "hardIssueCounts": dict(sorted(hard_issue_counts.items())),
        "sampleViolations": invalid_results,
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)[:500]}), file=sys.stderr)
        raise
