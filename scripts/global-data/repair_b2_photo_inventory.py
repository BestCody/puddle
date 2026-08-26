#!/usr/bin/env python3
"""Repair safe metadata defects on canonical B2 photo objects.

The repair is deliberately byte-preserving and never deletes an object. Each
candidate is read and verified against the SHA-256 encoded by its canonical key
before a same-key S3 copy replaces only the required metadata. Objects with a
content, decode, or dimension defect are reported for quarantine/replacement and
are not changed by this command.
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

import boto3
from botocore.client import Config
from PIL import Image


HEX_HASH = re.compile(r"[0-9a-f]{64}")
MAX_IMAGE_BYTES = 10_000_000
MAX_SOURCE_PIXELS = 40_000_000
MAX_WIDTH = 1_600
MAX_HEIGHT = 1_000
REQUIRED_PURPOSE = "puddle_open_location_photo"
REQUIRED_CACHE = "public, max-age=31536000, immutable"
METADATA_ONLY_ISSUES = {
    "cache_policy_mismatch",
    "purpose_metadata_mismatch",
    "sha256_metadata_mismatch",
    "content_type_not_jpeg",
}


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


def make_client(endpoint: str, key_id: str, application_key: str, region: str, workers: int):
    return boto3.client(
        "s3",
        endpoint_url=require(endpoint, "B2 endpoint"),
        aws_access_key_id=require(key_id, "B2 application key ID"),
        aws_secret_access_key=require(application_key, "B2 application key"),
        region_name=region or None,
        config=Config(
            retries={"max_attempts": 10, "mode": "adaptive"},
            max_pool_connections=max(8, workers * 2),
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


def normalized_metadata(head: dict[str, object]) -> dict[str, str]:
    return {
        str(name).lower(): str(value).strip()
        for name, value in (head.get("Metadata") or {}).items()
    }


def verify_bytes(client, bucket: str, key: str, expected_hash: str, size: int, max_bytes: int) -> list[str]:
    issues: list[str] = []
    try:
        response = client.get_object(Bucket=bucket, Key=key)
        stream = response["Body"]
        try:
            body = stream.read(max_bytes + 1)
        finally:
            stream.close()
    except Exception:
        return ["read_failed"]

    if len(body) != size:
        issues.append("read_size_mismatch")
    if len(body) > max_bytes:
        issues.append("size_exceeds_limit")
    if hashlib.sha256(body).hexdigest() != expected_hash:
        issues.append("sha256_content_mismatch")
        return issues

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
    return sorted(set(issues))


def inspect_object(
    client,
    bucket: str,
    item: dict[str, object],
    pattern: re.Pattern[str],
    max_bytes: int,
) -> dict[str, object]:
    key = str(item["key"])
    match = pattern.fullmatch(key)
    if not match:
        return {"key": key, "status": "quarantine", "issues": ["noncanonical_key"]}

    prefix, expected_hash = match.groups()
    issues: list[str] = []
    if prefix != expected_hash[:2]:
        issues.append("hash_prefix_mismatch")
    try:
        head = client.head_object(Bucket=bucket, Key=key)
    except Exception:
        return {"key": key, "status": "quarantine", "issues": ["head_failed"]}

    size = int(head.get("ContentLength") or 0)
    if int(item.get("listedSize") or 0) != size:
        issues.append("listing_size_mismatch")
    if size <= 0:
        issues.append("empty_object")
    if size > max_bytes:
        issues.append("size_exceeds_limit")

    metadata = normalized_metadata(head)
    if str(head.get("ContentType") or "").lower().strip() != "image/jpeg":
        issues.append("content_type_not_jpeg")
    cache_control = str(head.get("CacheControl") or "").lower()
    if "max-age=31536000" not in cache_control or "immutable" not in cache_control:
        issues.append("cache_policy_mismatch")
    if metadata.get("sha256", "").lower() != expected_hash:
        issues.append("sha256_metadata_mismatch")
    if metadata.get("purpose") != REQUIRED_PURPOSE:
        issues.append("purpose_metadata_mismatch")

    issues = sorted(set(issues))
    if not issues:
        return {"key": key, "status": "valid", "issues": [], "size": size}
    if not set(issues).issubset(METADATA_ONLY_ISSUES) or size <= 0 or size > max_bytes:
        return {"key": key, "status": "quarantine", "issues": issues, "size": size}

    byte_issues = verify_bytes(client, bucket, key, expected_hash, size, max_bytes)
    if byte_issues:
        return {"key": key, "status": "quarantine", "issues": sorted(set(issues + byte_issues)), "size": size}
    return {
        "key": key,
        "status": "repairable",
        "issues": issues,
        "size": size,
        "head": head,
        "expectedHash": expected_hash,
    }


def repair_metadata(client, bucket: str, result: dict[str, object]) -> dict[str, object]:
    key = str(result["key"])
    head = dict(result["head"])
    expected_hash = str(result["expectedHash"])
    kwargs: dict[str, object] = {
        "Bucket": bucket,
        "Key": key,
        "CopySource": {"Bucket": bucket, "Key": key},
        "MetadataDirective": "REPLACE",
        "ContentType": "image/jpeg",
        "CacheControl": REQUIRED_CACHE,
        "Metadata": {"sha256": expected_hash, "purpose": REQUIRED_PURPOSE},
    }
    for field in (
        "ContentDisposition",
        "ContentEncoding",
        "ContentLanguage",
        "Expires",
        "WebsiteRedirectLocation",
    ):
        if head.get(field) is not None:
            kwargs[field] = head[field]
    client.copy_object(**kwargs)
    verified = client.head_object(Bucket=bucket, Key=key)
    verified_metadata = normalized_metadata(verified)
    if int(verified.get("ContentLength") or 0) != int(result["size"]):
        raise RuntimeError(f"metadata repair changed object size: {key}")
    if verified_metadata.get("sha256", "").lower() != expected_hash:
        raise RuntimeError(f"metadata repair did not persist SHA-256 metadata: {key}")
    if verified_metadata.get("purpose") != REQUIRED_PURPOSE:
        raise RuntimeError(f"metadata repair did not persist purpose metadata: {key}")
    return {"key": key, "status": "repaired", "issues": result["issues"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prefix", default=first_env("B2_MEDIA_OPEN_PHOTO_PREFIX", default="media/photos/by-sha256"))
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--max-image-bytes", type=int, default=MAX_IMAGE_BYTES)
    parser.add_argument("--max-samples", type=int, default=25)
    parser.add_argument("--apply", action="store_true", help="Apply verified same-key metadata repairs.")
    args = parser.parse_args()

    if args.workers < 1 or args.workers > 64:
        raise RuntimeError("--workers must be between 1 and 64.")
    if args.max_image_bytes < 1 or args.max_image_bytes > MAX_IMAGE_BYTES:
        raise RuntimeError("--max-image-bytes must be between 1 and 10000000.")
    if args.max_samples < 0:
        raise RuntimeError("--max-samples must not be negative.")

    bucket = first_env("B2_MEDIA_BUCKET_NAME", "B2_DATA_BUCKET_NAME", "B2_BUCKET", default="puddle-assets")
    endpoint = first_env("B2_MEDIA_S3_ENDPOINT", "B2_DATA_S3_ENDPOINT", "B2_S3_ENDPOINT")
    key_id = first_env("B2_MEDIA_KEY_ID", "B2_MEDIA_APPLICATION_KEY_ID", "B2_DATA_APPLICATION_KEY_ID", "B2_KEY_ID")
    application_key = first_env("B2_MEDIA_APPLICATION_KEY", "B2_DATA_APPLICATION_KEY", "B2_APPLICATION_KEY")
    region = first_env("B2_MEDIA_S3_REGION", "B2_DATA_S3_REGION", "B2_REGION", default="us-east-005")
    prefix = clean_prefix(args.prefix)
    if not prefix:
        raise RuntimeError("B2 photo prefix is required.")

    client = make_client(endpoint, key_id, application_key, region, args.workers)
    objects = list_objects(client, bucket, prefix)
    pattern = re.compile(r"^" + re.escape(prefix) + r"/([0-9a-f]{2})/([0-9a-f]{64})\.jpg$")
    results: list[dict[str, object]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(inspect_object, client, bucket, item, pattern, args.max_image_bytes) for item in objects]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
    results.sort(key=lambda item: str(item.get("key") or ""))

    counts = Counter(str(result.get("status") or "unknown") for result in results)
    issue_counts: Counter[str] = Counter()
    samples: list[dict[str, object]] = []
    for result in results:
        issues = [str(value) for value in result.get("issues", [])]
        issue_counts.update(issues)
        if issues and len(samples) < args.max_samples:
            samples.append({"key": result.get("key"), "status": result.get("status"), "issues": issues})

    repaired = []
    if args.apply:
        repairable = [result for result in results if result.get("status") == "repairable"]
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(repair_metadata, client, bucket, result) for result in repairable]
            for future in concurrent.futures.as_completed(futures):
                repaired.append(future.result())
        repaired.sort(key=lambda item: str(item.get("key") or ""))

    summary = {
        "ok": not counts.get("quarantine", 0) and (not args.apply or len(repaired) == counts.get("repairable", 0)),
        "mode": "apply" if args.apply else "dry-run",
        "bucket": bucket,
        "prefix": prefix,
        "inventory": {"listedObjects": len(objects), "statusCounts": dict(sorted(counts.items()))},
        "issueCounts": dict(sorted(issue_counts.items())),
        "repairsApplied": len(repaired),
        "samples": samples,
        "deletion": {"attempted": False, "objectsRemoved": 0},
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)[:500]}), file=sys.stderr)
        raise
