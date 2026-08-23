#!/usr/bin/env python3
"""Repair a B2 search candidate, rebuilding a corrupt unactivated ledger when needed."""
from __future__ import annotations

import argparse
import hashlib
import signal
import subprocess
import sys
from pathlib import Path

import boto3
import brotli
import orjson
from botocore.client import Config

from location_search_common import b2_source_config
from repair_b2_search_candidate_parallel import main as repair_main, unique_ledger_records

BUILDER_PATH = Path(__file__).with_name("build_b2_search_index_continuous.py")
REBUILD_CHECKPOINT_VERSION = 2


def is_missing(error: Exception) -> bool:
    response = getattr(error, "response", {}) or {}
    code = str((response.get("Error") or {}).get("Code") or "")
    status = int((response.get("ResponseMetadata") or {}).get("HTTPStatusCode") or 0)
    return code in {"404", "NoSuchKey", "NotFound"} or status == 404


def make_client(source):
    return boto3.client(
        "s3",
        endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id,
        aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(retries={"max_attempts": 10, "mode": "adaptive"}),
    )


def active_snapshot(client, bucket: str, data_prefix: str) -> str | None:
    key = f"{data_prefix}/search/active.json"
    try:
        body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
    except Exception as error:
        if is_missing(error):
            return None
        raise
    pointer = orjson.loads(body)
    return str(pointer.get("snapshot") or "").strip() or None


def parse_entrypoint_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--key")
    parser.add_argument("--only-key", dest="key")
    args, _ = parser.parse_known_args()
    return args


def load_candidate_records(snapshot: str):
    """Load and checksum the authoritative candidate ledger without mutating B2."""
    source = b2_source_config()
    client = make_client(source)
    prefix = f"{source.data_prefix}/search/schema=v1/snapshot={snapshot}"
    manifest_key = f"{prefix}/manifest.json"
    manifest = orjson.loads(
        client.get_object(Bucket=source.bucket, Key=manifest_key)["Body"].read()
    )
    if int(manifest.get("schema_version", 0)) != 1 or str(manifest.get("snapshot")) != snapshot:
        raise RuntimeError("Candidate manifest does not match requested schema/snapshot.")

    validation = manifest.get("validation") or {}
    hashes_key = str(validation.get("hashes_key") or "")
    expected_hashes_sha = str(validation.get("hashes_sha256") or "").lower()
    hashes_body = client.get_object(Bucket=source.bucket, Key=hashes_key)["Body"].read()
    if hashlib.sha256(hashes_body).hexdigest() != expected_hashes_sha:
        raise RuntimeError("Candidate hash ledger checksum does not match manifest.")

    records = orjson.loads(brotli.decompress(hashes_body))
    if not isinstance(records, list) or not records:
        raise RuntimeError("Candidate hash ledger is empty or invalid.")
    if len(records) != int(validation.get("artifact_count", -1)):
        raise RuntimeError("Candidate hash ledger artifact count does not match manifest.")
    return source, client, records


def analyze_ledger(
    records: list[dict],
    *,
    print_conflicts: bool,
    fail_on_conflicts: bool = True,
) -> list[dict]:
    unique, exact_duplicates, conflicts = unique_ledger_records(records)
    print(
        f"repair_ledger_records={len(records)} unique_keys={len(unique)} "
        f"exact_duplicate_records={exact_duplicates} conflicting_keys={len(conflicts)}",
        flush=True,
    )
    if conflicts and print_conflicts:
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
    if conflicts and fail_on_conflicts:
        raise RuntimeError(
            f"Candidate hash ledger contains {len(conflicts)} destination keys with conflicting "
            "length/SHA-256 records."
        )
    return unique


def normalize_rebuilt_ledger(source, client, snapshot: str, records: list[dict]) -> list[dict]:
    """Collapse checkpoint history to the final write for each artifact key.

    A resumed rebuild can append multiple records for a destination that was rewritten in a
    later attempt. B2 contains the final write, so the authoritative ledger must describe that
    final object exactly once. This is allowed only for the unactivated snapshot guarded by main().
    """
    seen: set[str] = set()
    final_reverse: list[dict] = []
    for record in reversed(records):
        key = str(record.get("key") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        final_reverse.append(record)
    final_records = list(reversed(final_reverse))
    if len(final_records) == len(records):
        return records

    prefix = f"{source.data_prefix}/search/schema=v1/snapshot={snapshot}"
    manifest_key = f"{prefix}/manifest.json"
    manifest = orjson.loads(client.get_object(Bucket=source.bucket, Key=manifest_key)["Body"].read())
    validation = manifest.get("validation") or {}
    hashes_key = str(validation.get("hashes_key") or f"{prefix}/validation/hashes.json.br")
    hashes_raw = orjson.dumps(final_records)
    hashes_body = brotli.compress(hashes_raw, quality=5, mode=brotli.MODE_TEXT)
    hashes_sha = hashlib.sha256(hashes_body).hexdigest()

    client.put_object(
        Bucket=source.bucket,
        Key=hashes_key,
        Body=hashes_body,
        ContentType="application/json",
        CacheControl="public,max-age=31536000,immutable",
        Metadata={"sha256": hashes_sha},
    )
    validation["hashes_key"] = hashes_key
    validation["hashes_sha256"] = hashes_sha
    validation["artifact_count"] = len(final_records)
    manifest["validation"] = validation
    manifest_raw = orjson.dumps(manifest, option=orjson.OPT_INDENT_2) + b"\n"
    client.put_object(
        Bucket=source.bucket,
        Key=manifest_key,
        Body=manifest_raw,
        ContentType="application/json",
        CacheControl="public,max-age=31536000,immutable",
        Metadata={"sha256": hashlib.sha256(manifest_raw).hexdigest()},
    )
    print(
        f"repair_ledger_normalized records={len(records)} final_records={len(final_records)} "
        f"removed_history={len(records) - len(final_records)}",
        flush=True,
    )
    return final_records


def delete_prefix(client, bucket: str, prefix: str) -> int:
    deleted = 0
    batch: list[dict] = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            batch.append({"Key": item["Key"]})
            if len(batch) == 1000:
                client.delete_objects(Bucket=bucket, Delete={"Objects": batch, "Quiet": True})
                deleted += len(batch)
                batch = []
    if batch:
        client.delete_objects(Bucket=bucket, Delete={"Objects": batch, "Quiet": True})
        deleted += len(batch)
    return deleted


def initialize_rebuild_checkpoints(client, bucket: str, data_prefix: str, snapshot: str) -> None:
    """Clear legacy checkpoints exactly once, then preserve deterministic rebuild save points."""
    checkpoint_prefix = f"{data_prefix}/search/checkpoints/schema=v1/snapshot={snapshot}/"
    marker_key = f"{checkpoint_prefix}deterministic-rebuild-v{REBUILD_CHECKPOINT_VERSION}.json"
    try:
        client.head_object(Bucket=bucket, Key=marker_key)
        print(
            "repair_rebuild_checkpoint_resume "
            f"snapshot={snapshot} marker={marker_key}",
            flush=True,
        )
        return
    except Exception as error:
        if not is_missing(error):
            raise

    deleted = delete_prefix(client, bucket, checkpoint_prefix)
    marker = {
        "schema_version": 1,
        "rebuild_checkpoint_version": REBUILD_CHECKPOINT_VERSION,
        "snapshot": snapshot,
        "purpose": "deterministic-conflicting-ledger-rebuild",
    }
    client.put_object(
        Bucket=bucket,
        Key=marker_key,
        Body=orjson.dumps(marker, option=orjson.OPT_SORT_KEYS | orjson.OPT_INDENT_2) + b"\n",
        ContentType="application/json",
        CacheControl="no-store",
    )
    print(
        "repair_rebuild_checkpoint_initialized "
        f"snapshot={snapshot} deleted_legacy_objects={deleted} marker={marker_key}",
        flush=True,
    )


def rebuild_candidate(snapshot: str) -> None:
    command = [sys.executable, str(BUILDER_PATH), f"--snapshot={snapshot}"]
    print(
        "repair_rebuild_start "
        f"snapshot={snapshot} reason=conflicting_ledger mode=deterministic_checkpointed_full_rebuild",
        flush=True,
    )

    child = subprocess.Popen(command)
    previous_handlers: dict[int, object] = {}

    def forward_cancel(signum, _frame) -> None:
        if child.poll() is None:
            print(
                f"repair_rebuild_forward_cancel signal={signum} pid={child.pid}",
                flush=True,
            )
            child.send_signal(signum)

    for signum in (signal.SIGINT, signal.SIGTERM):
        previous_handlers[signum] = signal.getsignal(signum)
        signal.signal(signum, forward_cancel)

    try:
        return_code = child.wait()
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)

    if return_code != 0:
        raise subprocess.CalledProcessError(return_code, command)
    print(f"repair_rebuild_complete snapshot={snapshot}", flush=True)


def main() -> None:
    args = parse_entrypoint_args()
    if not args.apply or args.key:
        repair_main()
        return

    source, client, records = load_candidate_records(args.snapshot)
    try:
        analyze_ledger(records, print_conflicts=False)
    except RuntimeError as error:
        if "conflicting length/SHA-256 records" not in str(error):
            raise

        active = active_snapshot(client, source.bucket, source.data_prefix)
        if active == args.snapshot:
            raise RuntimeError(
                f"Refusing to rebuild active B2 search snapshot {args.snapshot}; "
                "publish a new snapshot namespace instead."
            ) from error

        analyze_ledger(records, print_conflicts=True, fail_on_conflicts=False)
        initialize_rebuild_checkpoints(
            client,
            source.bucket,
            source.data_prefix,
            args.snapshot,
        )
        rebuild_candidate(args.snapshot)

        source, client, rebuilt_records = load_candidate_records(args.snapshot)
        rebuilt_records = normalize_rebuilt_ledger(source, client, args.snapshot, rebuilt_records)
        analyze_ledger(rebuilt_records, print_conflicts=True)
        repair_main()
        return

    repair_main()


if __name__ == "__main__":
    main()
