#!/usr/bin/env python3
"""Delete only the manifest-scoped canonical photo pipeline data.

The command is intentionally fail-closed. It requires a completed recovery
manifest, verifies that no new object appeared after the freeze, runs only
against the exact canonical B2 media prefix and photo-data patterns, and then
confirms those scopes are empty. Supabase rows are removed by the companion
transactional SQL file in the reset workflow.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import re
from typing import Any

import boto3
from botocore.client import Config


CANONICAL_MEDIA_PREFIX = "media/photos/by-sha256"


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


def client(endpoint: str, key_id: str, application_key: str, region: str, pool_size: int):
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


def list_keys(s3, bucket: str, prefix: str) -> list[str]:
    keys: list[str] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix.rstrip("/") + "/"):
        keys.extend(str(item.get("Key") or "") for item in page.get("Contents", []) if item.get("Key"))
    return sorted(set(keys))


def read_object(s3, bucket: str, key: str) -> bytes:
    response = s3.get_object(Bucket=bucket, Key=key)
    body = response["Body"]
    try:
        return body.read()
    finally:
        body.close()


def read_manifest(s3, bucket: str, key: str) -> dict[str, Any]:
    payload = json.loads(read_object(s3, bucket, key))
    if not isinstance(payload, dict):
        raise RuntimeError("photo reset manifest is not a JSON object")
    if payload.get("schemaVersion") != 1 or payload.get("status") != "complete":
        raise RuntimeError("photo reset manifest is not complete")
    if not isinstance(payload.get("files"), dict):
        raise RuntimeError("photo reset manifest has no file inventory")
    return payload


def read_manifest_records(s3, bucket: str, manifest: dict[str, Any], name: str) -> list[dict[str, Any]]:
    spec = manifest["files"].get(name)
    if not isinstance(spec, dict) or not spec.get("key"):
        raise RuntimeError(f"photo reset manifest is missing {name}")
    body = read_object(s3, bucket, str(spec["key"]))
    expected_digest = str(spec.get("sha256") or "")
    if expected_digest and hashlib.sha256(body).hexdigest() != expected_digest:
        raise RuntimeError(f"photo reset manifest file checksum mismatch: {name}")
    try:
        stream = gzip.GzipFile(fileobj=io.BytesIO(body), mode="rb")
        records = [json.loads(line) for line in stream.read().decode("utf-8").splitlines() if line.strip()]
    except Exception as error:
        raise RuntimeError(f"photo reset manifest file is unreadable: {name}") from error
    if not all(isinstance(record, dict) for record in records):
        raise RuntimeError(f"photo reset manifest file contains a non-object row: {name}")
    return records


def photo_data_matcher(data_prefix: str):
    normalized = re.compile(
        r"^"
        + re.escape(data_prefix)
        + r"/normalized/schema=v1/snapshot=[^/]+/country_code=[^/]+/photo_metadata\.parquet$"
    )
    snapshot_overlay = re.compile(
        r"^"
        + re.escape(data_prefix)
        + r"/search/schema=v1/snapshot=[^/]+/photo-overlay-v1(?:/|$)"
    )
    prefixes = tuple(
        f"{data_prefix}/{suffix}"
        for suffix in (
            "enrichment/photo_candidates",
            "enrichment/photo_metadata",
            "enrichment/photo_attempts",
            "enrichment/photo_exclusions",
            "enrichment/photo_state",
            "enrichment/photo_cursors",
            "enrichment/photo_registry_state",
            "search/photo-overlay-v1",
        )
    )

    def match(key: str) -> bool:
        if normalized.fullmatch(key) or snapshot_overlay.fullmatch(key):
            return True
        return any(key.startswith(prefix.rstrip("/") + "/") for prefix in prefixes)

    return match


def delete_in_batches(s3, bucket: str, keys: list[str]) -> int:
    deleted = 0
    for offset in range(0, len(keys), 1000):
        batch = keys[offset : offset + 1000]
        response = s3.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": key} for key in batch], "Quiet": True},
        )
        errors = response.get("Errors") or []
        if errors:
            sample = "; ".join(f"{error.get('Key')}: {error.get('Code')}" for error in errors[:5])
            raise RuntimeError(f"B2 delete failed for {len(errors)} objects: {sample}")
        deleted += len(batch)
    return deleted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest-key", required=True)
    parser.add_argument("--confirm", required=True)
    args = parser.parse_args()
    if args.confirm != "DELETE_CANONICAL_PHOTO_PIPELINE":
        raise RuntimeError("exact deletion confirmation is required")

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
        "B2_KEY",
        "B2_APPLICATION_KEY",
        default=data_key,
    )
    media_region = first_env("B2_MEDIA_S3_REGION", "B2_DATA_S3_REGION", "B2_REGION", default=data_region)
    media_prefix = clean_prefix(first_env("B2_MEDIA_OPEN_PHOTO_PREFIX", default=CANONICAL_MEDIA_PREFIX))

    if media_prefix != CANONICAL_MEDIA_PREFIX:
        raise RuntimeError("reset refuses a media prefix other than the canonical Puddle photo prefix")
    if ".." in data_prefix or not data_prefix:
        raise RuntimeError("reset refuses an unsafe data prefix")

    data_s3 = client(data_endpoint, data_key_id, data_key, data_region, 32)
    media_s3 = client(media_endpoint, media_key_id, media_key, media_region, 64)
    manifest = read_manifest(data_s3, data_bucket, args.manifest_key)
    if manifest.get("dataBucket") != data_bucket or manifest.get("dataPrefix") != data_prefix:
        raise RuntimeError("manifest data scope does not match the current B2 configuration")
    if manifest.get("mediaBucket") != media_bucket or manifest.get("mediaPrefix") != media_prefix:
        raise RuntimeError("manifest media scope does not match the current B2 configuration")

    media_manifest_records = read_manifest_records(data_s3, data_bucket, manifest, "mediaObjects")
    data_manifest_records = read_manifest_records(data_s3, data_bucket, manifest, "dataObjects")
    expected_media = {str(row.get("key")) for row in media_manifest_records if row.get("key")}
    expected_data = {str(row.get("key")) for row in data_manifest_records if row.get("key")}
    if not expected_media or not expected_data:
        # An empty canonical inventory is valid only when the manifest records
        # it explicitly; data objects should still include the photo pointer or
        # metadata scope when the pipeline has ever been active.
        if int(manifest.get("counts", {}).get("mediaObjectsInOwnedPrefix") or 0) != 0:
            raise RuntimeError("photo reset manifest media inventory is unexpectedly empty")

    actual_media = set(list_keys(media_s3, media_bucket, media_prefix))
    if not actual_media.issubset(expected_media):
        new_keys = sorted(actual_media - expected_media)[:10]
        raise RuntimeError(f"new B2 media appeared after the freeze; refusing reset: {new_keys}")

    matcher = photo_data_matcher(data_prefix)
    actual_data: set[str] = set()
    for prefix in (
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
    ):
        for key in list_keys(data_s3, data_bucket, prefix):
            if matcher(key):
                actual_data.add(key)
    if not actual_data.issubset(expected_data):
        new_keys = sorted(actual_data - expected_data)[:10]
        raise RuntimeError(f"new B2 photo data appeared after the freeze; refusing reset: {new_keys}")

    deleted_media = delete_in_batches(media_s3, media_bucket, sorted(actual_media))
    deleted_data = delete_in_batches(data_s3, data_bucket, sorted(actual_data))

    remaining_media = list_keys(media_s3, media_bucket, media_prefix)
    remaining_data: list[str] = []
    for prefix in (
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
    ):
        remaining_data.extend(key for key in list_keys(data_s3, data_bucket, prefix) if matcher(key))
    if remaining_media or remaining_data:
        raise RuntimeError(
            f"photo reset verification failed: media={len(remaining_media)} data={len(set(remaining_data))}"
        )

    print(
        json.dumps(
            {
                "ok": True,
                "manifestKey": args.manifest_key,
                "deletedCanonicalMediaObjects": deleted_media,
                "deletedPhotoDataObjects": deleted_data,
                "remainingCanonicalMediaObjects": 0,
                "remainingPhotoDataObjects": 0,
            },
            indent=2,
            sort_keys=True,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
