#!/usr/bin/env python3
"""Compatibility entrypoint for exact B2 candidate recovery.

A structurally conflicting candidate ledger cannot be repaired by choosing one historical
version arbitrarily. For a full ``--apply`` repair of an unactivated candidate, regenerate
the candidate once from the authoritative canonical snapshot with deterministic ordering,
then rerun the strict exact-version repair/verification path. Active candidates are never
rebuilt in place.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from location_search_common import b2_source_config
from repair_b2_search_candidate_parallel import main as repair_main


def _is_missing(error: ClientError) -> bool:
    code = str(error.response.get("Error", {}).get("Code") or "")
    status = int(error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") or 0)
    return code in {"404", "NoSuchKey", "NotFound"} or status == 404


def _candidate_is_active(snapshot: str) -> bool:
    source = b2_source_config()
    s3 = boto3.client(
        "s3",
        endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id,
        aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(retries={"max_attempts": 10, "mode": "adaptive"}),
    )
    active_key = f"{source.data_prefix}/search/active.json"
    try:
        body = s3.get_object(Bucket=source.bucket, Key=active_key)["Body"].read()
    except ClientError as error:
        if _is_missing(error):
            return False
        raise
    active = json.loads(body)
    return str(active.get("snapshot") or "") == snapshot


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--key")
    parser.add_argument("--apply", action="store_true")
    args, _ = parser.parse_known_args()

    try:
        repair_main()
        return
    except RuntimeError as error:
        message = str(error)
        conflicting_ledger = (
            "Candidate hash ledger contains" in message
            and "destination keys with conflicting length/SHA-256 records" in message
        )
        if not conflicting_ledger or not args.apply or args.key:
            raise

    if _candidate_is_active(args.snapshot):
        raise RuntimeError(
            f"Refusing to rebuild conflicting candidate snapshot {args.snapshot} in place because it is active."
        )

    builder = Path(__file__).with_name("build_b2_search_index.py")
    print(
        f"repair_conflicting_ledger_rebuild=true snapshot={args.snapshot} "
        "reason=ledger_conflicts candidate_active=false",
        flush=True,
    )
    subprocess.run(
        [sys.executable, str(builder), "--snapshot", args.snapshot, "--no-resume"],
        check=True,
    )
    print(
        f"repair_conflicting_ledger_rebuild_completed=true snapshot={args.snapshot}",
        flush=True,
    )

    # The rebuild must produce a structurally valid ledger. Run the unchanged strict repair
    # path again; any remaining conflict or object mismatch is a hard failure.
    repair_main()


if __name__ == "__main__":
    main()
