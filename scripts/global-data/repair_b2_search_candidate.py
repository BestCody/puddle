#!/usr/bin/env python3
"""Repair a B2 search candidate, rebuilding a corrupt unactivated ledger when needed."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import boto3
import orjson
from botocore.client import Config

from repair_b2_search_candidate_parallel import (
    conflict_message,
    load_candidate_context,
    main as repair_main,
    validate_and_deduplicate_records,
)

BUILDER_PATH = Path(__file__).with_name("build_b2_search_index.py")
REBUILD_CHECKPOINT_VERSION = 2


def is_missing(error: Exception) -> bool:
    response = getattr(error, "response", {}) or {}
    code = str((response.get("Error") or {}).get("Code") or "")
    status = int((response.get("ResponseMetadata") or {}).get("HTTPStatusCode") or 0)
    return code in {"404", "NoSuchKey", "NotFound"} or status == 404


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
    parser.add_argument("--only-key")
    args, _ = parser.parse_known_args()
    return args


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
    marker_key = (
        f"{checkpoint_prefix}deterministic-rebuild-v{REBUILD_CHECKPOINT_VERSION}.json"
    )
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
    command = [
        sys.executable,
        str(BUILDER_PATH),
        f"--snapshot={snapshot}",
    ]
    print(
        "repair_rebuild_start "
        f"snapshot={snapshot} reason=conflicting_ledger mode=deterministic_checkpointed_full_rebuild",
        flush=True,
    )
    subprocess.run(command, check=True)
    print(f"repair_rebuild_complete snapshot={snapshot}", flush=True)


def main() -> None:
    args = parse_entrypoint_args()
    if not args.apply or args.only_key:
        repair_main()
        return

    context = load_candidate_context(args.snapshot)
    try:
        validate_and_deduplicate_records(context.records)
    except RuntimeError as error:
        if "conflicting length/SHA-256 records" not in str(error):
            raise

        source = context.source
        client = boto3.client(
            "s3",
            endpoint_url=source.endpoint_url,
            aws_access_key_id=source.key_id,
            aws_secret_access_key=source.application_key,
            region_name=source.region,
            config=Config(retries={"max_attempts": 10, "mode": "adaptive"}),
        )
        active = active_snapshot(client, source.bucket, source.data_prefix)
        if active == args.snapshot:
            raise RuntimeError(
                f"Refusing to rebuild active B2 search snapshot {args.snapshot}; "
                "publish a new snapshot namespace instead."
            ) from error

        conflict_message(context.records)
        initialize_rebuild_checkpoints(
            client,
            source.bucket,
            source.data_prefix,
            args.snapshot,
        )
        rebuild_candidate(args.snapshot)

        rebuilt = load_candidate_context(args.snapshot)
        validate_and_deduplicate_records(rebuilt.records)
        repair_main()
        return

    repair_main()


if __name__ == "__main__":
    main()
