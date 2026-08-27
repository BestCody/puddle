#!/usr/bin/env python3
"""Create durable exclusions for photo metadata that has no canonical B2 object.

The command is read-only by default. With ``--apply`` it writes one append-only
Parquet exclusion set to the data bucket; it never deletes or overwrites photo
bytes. The materializer can then refill affected locations with a different
verified candidate, while the serving overlay stops emitting broken URLs.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone

import boto3
import duckdb
from botocore.client import Config


HASH_RE = re.compile(r"^[0-9a-f]{64}$")
SNAPSHOT_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")


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


def validate_snapshot(value: object, label: str) -> str:
    snapshot = str(value or "").strip()
    if not SNAPSHOT_RE.fullmatch(snapshot):
        raise RuntimeError(f"{label} must be an ISO date snapshot.")
    return snapshot


def make_client(endpoint: str, key_id: str, application_key: str, region: str):
    return boto3.client(
        "s3",
        endpoint_url=required(endpoint, "B2 endpoint"),
        aws_access_key_id=required(key_id, "B2 application key ID"),
        aws_secret_access_key=required(application_key, "B2 application key"),
        region_name=region or None,
        config=Config(retries={"max_attempts": 10, "mode": "adaptive"}),
    )


def list_keys(client, bucket: str, prefix: str) -> list[str]:
    paginator = client.get_paginator("list_objects_v2")
    keys: list[str] = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix.rstrip("/") + "/"):
        keys.extend(
            str(item.get("Key") or "")
            for item in page.get("Contents", [])
            if str(item.get("Key") or "").endswith(".parquet")
        )
    return sorted(keys)


def object_exists(client, bucket: str, key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except Exception as error:
        response = getattr(error, "response", {}) or {}
        code = str((response.get("Error") or {}).get("Code") or "")
        status = int((response.get("ResponseMetadata") or {}).get("HTTPStatusCode") or 0)
        if code in {"404", "NoSuchKey", "NotFound"} or status == 404:
            return False
        raise


def read_json_object(client, bucket: str, key: str) -> dict:
    body = client.get_object(Bucket=bucket, Key=key)["Body"]
    try:
        value = json.loads(body.read())
    finally:
        body.close()
    return value if isinstance(value, dict) else {}


def configure_duckdb(con, bucket: str, endpoint: str, key_id: str, application_key: str, region: str) -> None:
    endpoint_host = endpoint.replace("https://", "").replace("http://", "").rstrip("/")
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET preserve_insertion_order=false")
    con.execute(
        f"""
CREATE OR REPLACE SECRET b2_photo_reference_repair_secret (
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


def columns_for(con, glob: str) -> dict[str, str]:
    try:
        return {
            str(row[0]).lower(): str(row[0])
            for row in con.execute(
                f"DESCRIBE SELECT * FROM read_parquet('{glob}', union_by_name=true, hive_partitioning=true)"
            ).fetchall()
        }
    except Exception:
        return {}


def quoted_column(columns: dict[str, str], name: str, sql_type: str) -> str:
    actual = columns.get(name.lower())
    if not actual:
        return f"NULL::{sql_type}"
    return f'cast("{actual.replace(chr(34), chr(34) * 2)}" AS {sql_type})'


def canonical_media_hashes(client, bucket: str, prefix: str) -> set[str]:
    pattern = re.compile(r"^" + re.escape(prefix) + r"/([0-9a-f]{2})/([0-9a-f]{64})\.jpg$")
    hashes: set[str] = set()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix.rstrip("/") + "/"):
        for item in page.get("Contents", []):
            match = pattern.fullmatch(str(item.get("Key") or ""))
            if match and match.group(1) == match.group(2)[:2]:
                hashes.add(match.group(2))
    return hashes


def metadata_sources(data_client, bucket: str, data_prefix: str, snapshot: str) -> list[tuple[str, str, str]]:
    normalized_prefix = f"{data_prefix}/normalized/schema=v1/snapshot={snapshot}"
    enriched_prefix = f"{data_prefix}/enrichment/photo_metadata/snapshot={snapshot}"
    normalized_keys = [
        key for key in list_keys(data_client, bucket, normalized_prefix)
        if key.endswith("/photo_metadata.parquet")
    ]
    enriched_keys = list_keys(data_client, bucket, enriched_prefix)
    sources: list[tuple[str, str, str]] = []
    if normalized_keys:
        sources.append(
            (
                "normalized",
                f"s3://{bucket}/{normalized_prefix}/country_code=*/photo_metadata.parquet",
                "true",
            )
        )
    if enriched_keys:
        sources.append(
            (
                "enriched",
                f"s3://{bucket}/{enriched_prefix}/country_code=*/*.parquet",
                "true",
            )
        )
    return sources


def read_reference_rows(con, data_client, bucket: str, data_prefix: str, snapshot: str) -> tuple[list[dict[str, str]], int]:
    con.execute(
        """
CREATE TEMP TABLE photo_references(
  location_id VARCHAR,
  content_hash VARCHAR,
  source VARCHAR
)
"""
    )
    compatible_sources = 0
    for source, glob, hive in metadata_sources(data_client, bucket, data_prefix, snapshot):
        columns = columns_for(con, glob)
        if not {"location_id", "content_hash"}.issubset(columns):
            continue
        con.execute(
            "INSERT INTO photo_references SELECT "
            + ",".join(
                [
                    quoted_column(columns, "location_id", "VARCHAR"),
                    quoted_column(columns, "content_hash", "VARCHAR"),
                    f"'{source}' AS source",
                ]
            )
            + f" FROM read_parquet('{glob}', union_by_name=true, hive_partitioning={hive})"
        )
        compatible_sources += 1

    rows = [
        {"location_id": str(row[0] or "").strip(), "content_hash": str(row[1] or "").strip().lower()}
        for row in con.execute(
            """
SELECT DISTINCT trim(cast(location_id AS VARCHAR)), lower(trim(cast(content_hash AS VARCHAR)))
FROM photo_references
WHERE trim(cast(location_id AS VARCHAR)) <> ''
"""
        ).fetchall()
    ]
    return rows, compatible_sources


def read_prior_exclusions(con, data_client, bucket: str, data_prefix: str, snapshot: str) -> set[tuple[str, str]]:
    prefix = f"{data_prefix}/enrichment/photo_exclusions/snapshot={snapshot}"
    if not list_keys(data_client, bucket, prefix):
        return set()
    glob = f"s3://{bucket}/{prefix}/*.parquet"
    columns = columns_for(con, glob)
    if not {"location_id", "content_hash"}.issubset(columns):
        return set()
    location_column = quoted_column(columns, "location_id", "VARCHAR")
    content_hash_column = quoted_column(columns, "content_hash", "VARCHAR")
    return {
        (str(row[0] or "").strip(), str(row[1] or "").strip().lower())
        for row in con.execute(
            f"""
SELECT DISTINCT trim({location_column}), lower(trim({content_hash_column}))
FROM read_parquet('{glob}', union_by_name=true, hive_partitioning=false)
"""
        ).fetchall()
    }


def write_exclusions(data_client, bucket: str, key: str, rows: list[tuple[str, str, str, str]], con) -> None:
    con.execute("DROP TABLE IF EXISTS repair_exclusions")
    con.execute(
        """
CREATE TEMP TABLE repair_exclusions(
  location_id VARCHAR,
  content_hash VARCHAR,
  reason VARCHAR,
  detected_at VARCHAR
)
"""
    )
    con.executemany("INSERT INTO repair_exclusions VALUES (?,?,?,?)", rows)
    with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as handle:
        local_path = handle.name
    try:
        escaped = local_path.replace("'", "''")
        con.execute(f"COPY repair_exclusions TO '{escaped}' (FORMAT PARQUET,COMPRESSION ZSTD)")
        with open(local_path, "rb") as handle:
            payload = handle.read()
        data_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=payload,
            ContentType="application/vnd.apache.parquet",
            CacheControl="no-store",
            Metadata={"purpose": "puddle_missing_canonical_photo_exclusions"},
        )
    finally:
        try:
            os.remove(local_path)
        except FileNotFoundError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", default="", help="ISO date snapshot; empty reads the active manifest")
    parser.add_argument("--apply", action="store_true", help="Write durable exclusions; never deletes photo objects")
    args = parser.parse_args()

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
    media_key = first_env("B2_MEDIA_APPLICATION_KEY", "B2_DATA_APPLICATION_KEY", "B2_APPLICATION_KEY", default=data_key)
    media_region = first_env("B2_MEDIA_S3_REGION", "B2_DATA_S3_REGION", "B2_REGION", default=data_region)
    media_prefix = clean_prefix(first_env("B2_MEDIA_OPEN_PHOTO_PREFIX", default="media/photos/by-sha256"))

    data_client = make_client(data_endpoint, data_key_id, data_key, data_region)
    media_client = make_client(media_endpoint, media_key_id, media_key, media_region)
    manifest = read_json_object(data_client, data_bucket, f"{data_prefix}/manifests/active-location-snapshot.json")
    snapshot = validate_snapshot(args.snapshot or manifest.get("snapshot"), "snapshot")
    exclusion_prefix = f"{data_prefix}/enrichment/photo_exclusions/snapshot={snapshot}"
    repair_key = f"{exclusion_prefix}/repair-missing-canonical-v1.parquet"

    canonical_hashes = canonical_media_hashes(media_client, media_bucket, media_prefix)
    con = duckdb.connect()
    try:
        configure_duckdb(con, data_bucket, data_endpoint, data_key_id, data_key, data_region)
        reference_rows, compatible_sources = read_reference_rows(con, data_client, data_bucket, data_prefix, snapshot)
        if reference_rows and not canonical_hashes:
            raise RuntimeError("Photo metadata exists but no canonical media objects were found; refusing to exclude every reference.")
        prior_exclusions = read_prior_exclusions(con, data_client, data_bucket, data_prefix, snapshot)
        current = []
        for row in reference_rows:
            location_id = row["location_id"]
            content_hash = row["content_hash"]
            if (location_id, content_hash) in prior_exclusions:
                continue
            if not HASH_RE.fullmatch(content_hash):
                reason = "invalid_photo_reference"
            elif content_hash not in canonical_hashes:
                reason = "missing_canonical_object"
            else:
                continue
            current.append((location_id, content_hash, reason, datetime.now(timezone.utc).isoformat()))

        existing_repair = []
        if object_exists(data_client, data_bucket, repair_key):
            columns = columns_for(con, f"s3://{data_bucket}/{repair_key}")
            if {"location_id", "content_hash", "reason", "detected_at"}.issubset(columns):
                existing_repair = [
                    (str(row[0]), str(row[1]), str(row[2]), str(row[3]))
                    for row in con.execute(f"SELECT location_id,content_hash,reason,detected_at FROM read_parquet('s3://{data_bucket}/{repair_key}')").fetchall()
                ]
        unique = {(row[0], row[1]): row for row in existing_repair + current}
        all_repair_rows = sorted(unique.values(), key=lambda row: (row[0], row[1]))
        applied = False
        if args.apply and current:
            write_exclusions(data_client, data_bucket, repair_key, all_repair_rows, con)
            applied = True
        summary = {
            "ok": True,
            "mode": "apply" if args.apply else "dry-run",
            "snapshot": snapshot,
            "metadata": {
                "referenceRows": len(reference_rows),
                "compatibleSources": compatible_sources,
                "canonicalMediaObjects": len(canonical_hashes),
            },
            "candidates": {
                "newExclusions": len(current),
                "missingCanonicalObjects": sum(1 for row in current if row[2] == "missing_canonical_object"),
                "invalidReferences": sum(1 for row in current if row[2] == "invalid_photo_reference"),
                "durableExclusions": len(all_repair_rows),
            },
            "applied": applied,
            "exclusionKey": repair_key if applied else None,
            "deletion": {"attempted": False, "objectsRemoved": 0},
        }
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)[:500]}), file=sys.stderr)
        raise
