#!/usr/bin/env python3
"""Inspect or repair an immutable B2 search candidate from exact historical versions.

Validation is never weakened. The candidate hash ledger remains authoritative. Current
objects are HEAD-checked, historical B2 versions are accepted only when both compressed
byte length and SHA-256 exactly match the ledger, and restored current objects are
verified again after all parallel PUTs complete. Ledger destination keys are normalized
before any mutation: exact duplicate records are de-duplicated, while conflicting records
for the same key are a hard failure.
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


def record_identity(record: dict) -> tuple[str, int, str]:
    key = str(record.get("key") or "")
    if not key:
        raise RuntimeError("Candidate hash ledger contains an artifact with no key.")
    try:
        expected_size = int(record["compressed_bytes"])
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError(f"Candidate hash ledger contains an invalid compressed byte length: {key}") from error
    expected_sha = str(record.get("sha256") or "").lower()
    if expected_size < 0:
        raise RuntimeError(f"Candidate hash ledger contains a negative compressed byte length: {key}")
    if len(expected_sha) != 64 or any(char not in "0123456789abcdef" for char in expected_sha):
        raise RuntimeError(f"Candidate hash ledger contains an invalid SHA-256: {key}")
    return key, expected_size, expected_sha


def unique_ledger_records(records: list[dict]) -> tuple[list[dict], int, list[dict]]:
    """Return one record per destination key and surface impossible ledger conflicts."""
    unique: dict[str, dict] = {}
    exact_duplicates = 0
    conflicts: list[dict] = []

    for record in records:
        key, expected_size, expected_sha = record_identity(record)
        existing = unique.get(key)
        if existing is None:
            unique[key] = record
            continue

        _, existing_size, existing_sha = record_identity(existing)
        if (existing_size, existing_sha) == (expected_size, expected_sha):
            exact_duplicates += 1
            continue

        conflicts.append(
            {
                "key": key,
                "first_size": existing_size,
                "first_sha": existing_sha,
                "conflicting_size": expected_size,
                "conflicting_sha": expected_sha,
            }
        )

    return list(unique.values()), exact_duplicates, conflicts


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

    raw_records = json.loads(brotli.decompress(hashes_body))
    if len(raw_records) != int(validation.get("artifact_count", -1)) or not raw_records:
        raise RuntimeError("Candidate hash ledger artifact count does not match manifest.")

    records, exact_duplicates, conflicts = unique_ledger_records(raw_records)
    print(
        f"repair_ledger_records={len(raw_records)} unique_keys={len(records)} "
        f"exact_duplicate_records={exact_duplicates} conflicting_keys={len(conflicts)}",
        flush=True,
    )
    if conflicts:
        for conflict in conflicts[:50]:
            print(
                "repair_ledger_conflict "
                f"key={conflict['key']} "
                f"first_size={conflict['first_size']} first_sha={conflict['first_sha']} "
                f"conflicting_size={conflict['conflicting_size']} "
                f"conflicting_sha={conflict['conflicting_sha']}",
                flush=True,
            )
        if len(conflicts) > 50:
            print(f"repair_ledger_conflicts_omitted={len(conflicts) - 50}", flush=True)
        raise RuntimeError(
            f"Candidate hash ledger contains {len(conflicts)} destination keys with conflicting "
            "length/SHA-256 records; refusing to inspect or mutate B2."
        )

    if args.key:
        requested_key = str(args.key)
        records = [record for record in records if str(record.get("key") or "") == requested_key]
        if not records:
            raise RuntimeError(f"Artifact key is not present in candidate ledger: {requested_key}")
        print(f"repair_target_key={requested_key}", flush=True)

    def inspect(record: dict) -> dict | None:
        key, expected_size, expected_sha = record_identity(record)
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

    def final_verify(repaired_records: list[dict]) -> None:
        # Re-read the bytes of every artifact we restored. This catches same-size corruption
        # or stale/misleading metadata, and is intentionally done after every PUT has finished.
        deep_failures: list[dict] = []

        def verify_repaired_body(record: dict) -> dict | None:
            key, expected_size, expected_sha = record_identity(record)
            body = get_bytes(key)
            actual_size = len(body)
            actual_sha = sha256_hex(body)
            if (actual_size, actual_sha) == (expected_size, expected_sha):
                return None
            return {
                "record": record,
                "actual_size": actual_size,
                "actual_sha": actual_sha,
            }

        deep_completed = 0
        if repaired_records:
            with ThreadPoolExecutor(max_workers=restore_workers) as pool:
                futures = [pool.submit(verify_repaired_body, record) for record in repaired_records]
                for future in as_completed(futures):
                    result = future.result()
                    if result is not None:
                        deep_failures.append(result)
                    deep_completed += 1
                    if deep_completed % 25 == 0 or deep_completed == len(repaired_records):
                        print(
                            f"repair_final_deep_checked={deep_completed}/{len(repaired_records)} "
                            f"mismatches={len(deep_failures)}",
                            flush=True,
                        )
        else:
            print("repair_final_deep_checked=0/0 mismatches=0", flush=True)

        if deep_failures:
            deep_failures.sort(key=lambda item: str(item["record"]["key"]))
            for item in deep_failures[:50]:
                record = item["record"]
                print(
                    "repair_final_deep_mismatch "
                    f"key={record['key']} expected_size={record['compressed_bytes']} "
                    f"expected_sha={record['sha256']} actual_size={item['actual_size']} "
                    f"actual_sha={item['actual_sha']}",
                    flush=True,
                )
            raise RuntimeError(
                f"{len(deep_failures)} restored artifacts changed or failed exact byte verification "
                "after the parallel restore completed."
            )

        # HEAD every unique candidate key last, immediately before declaring repair success.
        final_mismatches: list[dict] = []
        final_completed = 0
        with ThreadPoolExecutor(max_workers=head_workers) as pool:
            futures = [pool.submit(inspect, record) for record in records]
            for future in as_completed(futures):
                result = future.result()
                if result is not None:
                    final_mismatches.append(result)
                final_completed += 1
                if final_completed % 1000 == 0 or final_completed == len(records):
                    print(
                        f"repair_final_head_checked={final_completed}/{len(records)} "
                        f"mismatches={len(final_mismatches)}",
                        flush=True,
                    )

        if final_mismatches:
            final_mismatches.sort(key=lambda item: str(item["record"]["key"]))
            for item in final_mismatches[:50]:
                record = item["record"]
                print(
                    "repair_final_head_mismatch "
                    f"key={record['key']} reason={item['reason']} "
                    f"expected_size={record['compressed_bytes']} expected_sha={record['sha256']} "
                    f"actual_size={item['actual_size']} actual_sha={item['actual_sha'] or 'missing'}",
                    flush=True,
                )
            raise RuntimeError(
                f"{len(final_mismatches)} candidate artifacts do not match the ledger after repair; "
                "refusing to report repair_complete."
            )

        print(
            f"repair_final_verified_keys={len(records)} repaired_hashes={len(repaired_records)}",
            flush=True,
        )

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
        if args.apply:
            final_verify([])
            print("repair_complete=0", flush=True)
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
        key, expected_size, expected_sha = record_identity(record)
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

    def restore(result: dict) -> tuple[str, str, dict]:
        item = result["item"]
        record = item["record"]
        key, expected_size, expected_sha = record_identity(record)
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
        return key, matching_version, record

    repaired = 0
    repaired_records: list[dict] = []
    print(f"repair_restore_workers={restore_workers}", flush=True)
    with ThreadPoolExecutor(max_workers=restore_workers) as pool:
        futures = [pool.submit(restore, result) for result in matches]
        for future in as_completed(futures):
            key, matching_version, record = future.result()
            repaired_records.append(record)
            repaired += 1
            if repaired % 25 == 0 or repaired == len(matches):
                print(
                    f"repair_restored={repaired}/{len(matches)} key={key} source_version={matching_version}",
                    flush=True,
                )

    repaired_records.sort(key=lambda record: str(record["key"]))
    final_verify(repaired_records)
    print(f"repair_complete={repaired}", flush=True)


if __name__ == "__main__":
    main()
