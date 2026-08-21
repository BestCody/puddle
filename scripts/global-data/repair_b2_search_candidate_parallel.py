#!/usr/bin/env python3
"""Inspect or repair an immutable B2 search candidate from exact historical versions.

Validation is never weakened. The candidate hash ledger remains authoritative. Current
objects are HEAD-checked, historical B2 versions are accepted only when both compressed
byte length and SHA-256 exactly match the ledger, and restored current objects are
HEAD-verified immediately after PUT. Independent restores use bounded parallelism.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
import brotli
from botocore.client import Config
from botocore.exceptions import ClientError

from location_search_common import b2_source_config


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def is_missing(error: ClientError) -> bool:
    code = str(error.response.get("Error", {}).get("Code") or "")
    status = int(error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") or 0)
    return code in {"404", "NoSuchKey", "NotFound"} or status == 404


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument(
        "--key",
        help="Inspect only this exact ledger artifact key. Omit to inspect the full candidate.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Restore exact ledger-matching historical versions.",
    )
    parser.add_argument(
        "--head-workers",
        type=int,
        default=int(os.getenv("GLOBAL_LOCATION_VALIDATE_HEAD_WORKERS", "16")),
    )
    parser.add_argument(
        "--history-workers",
        type=int,
        default=int(os.getenv("GLOBAL_LOCATION_REPAIR_HISTORY_WORKERS", "16")),
    )
    parser.add_argument(
        "--restore-workers",
        type=int,
        default=int(os.getenv("GLOBAL_LOCATION_REPAIR_RESTORE_WORKERS", "16")),
    )
    args = parser.parse_args()

    head_workers = max(1, min(64, int(args.head_workers)))
    history_workers = max(1, min(32, int(args.history_workers)))
    restore_workers = max(1, min(32, int(args.restore_workers)))
    source = b2_source_config()
    prefix = f"{source.data_prefix}/search/schema=v1/snapshot={args.snapshot}"
    manifest_key = f"{prefix}/manifest.json"
    pool_connections = max(32, min(128, head_workers + history_workers + restore_workers))

    s3 = boto3.client(
        "s3",
        endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id,
        aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(
            retries={"max_attempts": 10, "mode": "adaptive"},
            max_pool_connections=pool_connections,
        ),
    )

    def get_bytes(key: str, *, version_id: str | None = None) -> bytes:
        kwargs: dict[str, object] = {"Bucket": source.bucket, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        return s3.get_object(**kwargs)["Body"].read()

    manifest_body = get_bytes(manifest_key)
    manifest = json.loads(manifest_body)
    if int(manifest.get("schema_version", 0)) != 1 or str(manifest.get("snapshot")) != args.snapshot:
        raise RuntimeError("Candidate manifest does not match requested schema/snapshot.")

    validation = manifest.get("validation") or {}
    hashes_key = str(validation.get("hashes_key") or "")
    expected_hashes_sha = str(validation.get("hashes_sha256") or "").lower()
    hashes_body = get_bytes(hashes_key)
    if sha256_hex(hashes_body) != expected_hashes_sha:
        raise RuntimeError("Candidate hash ledger checksum does not match manifest.")

    records = json.loads(brotli.decompress(hashes_body))
    if len(records) != int(validation.get("artifact_count", -1)) or not records:
        raise RuntimeError("Candidate hash ledger artifact count does not match manifest.")

    if args.key:
        requested_key = str(args.key)
        records = [record for record in records if str(record.get("key") or "") == requested_key]
        if not records:
            raise RuntimeError(f"Artifact key is not present in candidate ledger: {requested_key}")
        print(f"repair_target_key={requested_key}", flush=True)

    def inspect(record: dict) -> dict | None:
        key = str(record["key"])
        expected_size = int(record["compressed_bytes"])
        expected_sha = str(record["sha256"]).lower()
        try:
            head = s3.head_object(Bucket=source.bucket, Key=key)
        except ClientError as error:
            if is_missing(error):
                return {
                    "record": record,
                    "reason": "missing",
                    "actual_size": None,
                    "actual_sha": None,
                }
            raise
        actual_size = int(head.get("ContentLength", -1))
        actual_sha = str((head.get("Metadata") or {}).get("sha256", "")).lower()
        if (actual_size, actual_sha) == (expected_size, expected_sha):
            return None
        return {
            "record": record,
            "reason": "mismatch",
            "actual_size": actual_size,
            "actual_sha": actual_sha,
        }

    mismatches: list[dict] = []
    completed = 0
    with ThreadPoolExecutor(max_workers=head_workers) as pool:
        futures = [pool.submit(inspect, record) for record in records]
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                mismatches.append(result)
            completed += 1
            if completed % 1000 == 0 or completed == len(records):
                print(
                    f"repair_head_checked={completed}/{len(records)} mismatches={len(mismatches)}",
                    flush=True,
                )

    mismatches.sort(key=lambda item: str(item["record"]["key"]))
    if not mismatches:
        print("repair_mismatches=0", flush=True)
        print("repair_dry_run_exact_matches=0/0 missing=0", flush=True)
        return

    print(f"repair_mismatches={len(mismatches)}", flush=True)
    for item in mismatches:
        record = item["record"]
        print(
            "repair_mismatch "
            f"key={record['key']} reason={item['reason']} "
            f"expected_size={record['compressed_bytes']} expected_sha={record['sha256']} "
            f"actual_size={item['actual_size']} actual_sha={item['actual_sha'] or 'missing'}",
            flush=True,
        )

    def find_history_match(item: dict) -> dict:
        record = item["record"]
        key = str(record["key"])
        expected_size = int(record["compressed_bytes"])
        expected_sha = str(record["sha256"]).lower()
        versions_seen = 0
        size_candidates = 0

        paginator = s3.get_paginator("list_object_versions")
        for page in paginator.paginate(Bucket=source.bucket, Prefix=key):
            for version in page.get("Versions", []):
                if str(version.get("Key") or "") != key:
                    continue
                versions_seen += 1
                if int(version.get("Size") or -1) != expected_size:
                    continue
                size_candidates += 1
                version_id = str(version.get("VersionId") or "")
                if not version_id:
                    continue
                response = s3.get_object(Bucket=source.bucket, Key=key, VersionId=version_id)
                body = response["Body"].read()
                if len(body) != expected_size or sha256_hex(body) != expected_sha:
                    continue
                return {
                    "item": item,
                    "matching_version": version_id,
                    "content_type": str(response.get("ContentType") or "application/json"),
                    "versions_seen": versions_seen,
                    "size_candidates": size_candidates,
                }

        return {
            "item": item,
            "matching_version": None,
            "content_type": None,
            "versions_seen": versions_seen,
            "size_candidates": size_candidates,
        }

    matches: list[dict] = []
    unavailable: list[dict] = []
    history_completed = 0
    with ThreadPoolExecutor(max_workers=history_workers) as pool:
        futures = [pool.submit(find_history_match, item) for item in mismatches]
        for future in as_completed(futures):
            result = future.result()
            record = result["item"]["record"]
            key = str(record["key"])
            matching_version = result["matching_version"]
            if matching_version:
                matches.append(result)
                print(
                    f"repair_history_exact_match=true key={key} source_version={matching_version} "
                    f"versions_seen={result['versions_seen']} size_candidates={result['size_candidates']}",
                    flush=True,
                )
            else:
                unavailable.append(result)
                print(
                    f"repair_history_exact_match=false key={key} "
                    f"versions_seen={result['versions_seen']} size_candidates={result['size_candidates']}",
                    flush=True,
                )
            history_completed += 1
            if history_completed % 100 == 0 or history_completed == len(mismatches):
                print(
                    f"repair_history_checked={history_completed}/{len(mismatches)} "
                    f"exact_matches={len(matches)} missing={len(unavailable)}",
                    flush=True,
                )

    matches.sort(key=lambda result: str(result["item"]["record"]["key"]))
    unavailable.sort(key=lambda result: str(result["item"]["record"]["key"]))
    print(
        f"repair_dry_run_exact_matches={len(matches)}/{len(mismatches)} missing={len(unavailable)}",
        flush=True,
    )

    if unavailable:
        missing_keys = [str(result["item"]["record"]["key"]) for result in unavailable]
        print("repair_unavailable_keys=" + json.dumps(missing_keys), flush=True)
        raise RuntimeError(
            f"{len(unavailable)} candidate artifacts have no historical B2 version matching the ledger; "
            "refusing to synthesize data or relax validation."
        )

    if not args.apply:
        return

    def restore(result: dict) -> tuple[str, str]:
        item = result["item"]
        record = item["record"]
        key = str(record["key"])
        expected_size = int(record["compressed_bytes"])
        expected_sha = str(record["sha256"]).lower()
        matching_version = str(result["matching_version"])
        matching_content_type = str(result["content_type"] or "application/json")

        response = s3.get_object(Bucket=source.bucket, Key=key, VersionId=matching_version)
        matching_body = response["Body"].read()
        if len(matching_body) != expected_size or sha256_hex(matching_body) != expected_sha:
            raise RuntimeError(f"Historical version changed verification result before restore: {key}")

        s3.put_object(
            Bucket=source.bucket,
            Key=key,
            Body=matching_body,
            ContentType=matching_content_type,
            CacheControl="public,max-age=31536000,immutable",
            Metadata={"sha256": expected_sha},
        )
        head = s3.head_object(Bucket=source.bucket, Key=key)
        actual_size = int(head.get("ContentLength", -1))
        actual_sha = str((head.get("Metadata") or {}).get("sha256", "")).lower()
        if (actual_size, actual_sha) != (expected_size, expected_sha):
            raise RuntimeError(f"Restored object did not verify after PUT: {key}")
        return key, matching_version

    repaired = 0
    print(f"repair_restore_workers={restore_workers}", flush=True)
    with ThreadPoolExecutor(max_workers=restore_workers) as pool:
        futures = [pool.submit(restore, result) for result in matches]
        for future in as_completed(futures):
            key, matching_version = future.result()
            repaired += 1
            if repaired % 25 == 0 or repaired == len(matches):
                print(
                    f"repair_restored={repaired}/{len(matches)} key={key} source_version={matching_version}",
                    flush=True,
                )

    print(f"repair_complete={repaired}", flush=True)


if __name__ == "__main__":
    main()
