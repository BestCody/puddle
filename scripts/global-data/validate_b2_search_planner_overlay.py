#!/usr/bin/env python3
"""Validate and optionally activate a B2 planner-overlay manifest."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import boto3
import brotli
from botocore.client import Config

from location_search_common import b2_source_config


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def hash_bucket(value: object) -> str:
    return hashlib.sha256(str(value).encode()).hexdigest()[:3]


def json_bytes(value) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def record_identity(record: dict) -> tuple[str, int, str]:
    key = str(record.get("key") or "")
    if not key:
        raise RuntimeError("Hash ledger contains an artifact with no key.")
    try:
        expected_size = int(record["compressed_bytes"])
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError(f"Hash ledger contains an invalid compressed byte length: {key}") from error
    expected_sha = str(record.get("sha256") or "").lower()
    if expected_size < 0:
        raise RuntimeError(f"Hash ledger contains a negative compressed byte length: {key}")
    if len(expected_sha) != 64 or any(char not in "0123456789abcdef" for char in expected_sha):
        raise RuntimeError(f"Hash ledger contains an invalid SHA-256: {key}")
    return key, expected_size, expected_sha


def unique_ledger_records(records: list[dict]) -> tuple[list[dict], int]:
    unique: dict[str, dict] = {}
    exact_duplicates = 0
    for record in records:
        key, expected_size, expected_sha = record_identity(record)
        existing = unique.get(key)
        if existing is None:
            unique[key] = record
            continue
        _, existing_size, existing_sha = record_identity(existing)
        if (existing_size, existing_sha) != (expected_size, expected_sha):
            raise RuntimeError(f"Hash ledger contains conflicting integrity records for {key}.")
        exact_duplicates += 1
    return list(unique.values()), exact_duplicates


def descriptor_fields(descriptor) -> tuple[str, float, float, float, float, int, int]:
    if isinstance(descriptor, list):
        if len(descriptor) < 8:
            raise RuntimeError("Routing descriptor array is incomplete.")
        key = str(descriptor[0])
        north, south, east, west = map(float, descriptor[2:6])
        count = int(descriptor[6])
        compressed_bytes = int(descriptor[7])
    elif isinstance(descriptor, dict):
        key = str(descriptor.get("key") or "")
        north = float(descriptor["north"])
        south = float(descriptor["south"])
        east = float(descriptor["east"])
        west = float(descriptor["west"])
        count = int(descriptor.get("count") or 0)
        compressed_bytes = int(descriptor.get("compressed_bytes") or 0)
    else:
        raise RuntimeError("Routing descriptor has an unsupported shape.")
    if not key:
        raise RuntimeError("Routing descriptor is missing its target key.")
    if not all(math.isfinite(value) for value in (north, south, east, west)):
        raise RuntimeError(f"Routing descriptor {key} has non-finite bounds.")
    if not (-90 <= south <= north <= 90):
        raise RuntimeError(f"Routing descriptor {key} has invalid latitude bounds.")
    if not (-180 <= west <= 180 and -180 <= east <= 180):
        raise RuntimeError(f"Routing descriptor {key} has invalid longitude bounds.")
    if count <= 0 or compressed_bytes <= 0:
        raise RuntimeError(f"Routing descriptor {key} has invalid count/byte metadata.")
    return key, north, south, east, west, count, compressed_bytes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--planner-id", default=os.getenv("GLOBAL_LOCATION_PLANNER_ID", "v2-c4000-b524288"))
    parser.add_argument("--manifest-key", default="")
    parser.add_argument("--activate", action="store_true")
    parser.add_argument("--head-workers", type=int, default=int(os.getenv("GLOBAL_LOCATION_VALIDATE_HEAD_WORKERS", "16")))
    parser.add_argument("--deep-hash-samples", type=int, default=int(os.getenv("GLOBAL_LOCATION_VALIDATE_DEEP_SAMPLES", "32")))
    args = parser.parse_args()

    source = b2_source_config()
    base_prefix = f"{source.data_prefix}/search/schema=v1/snapshot={args.snapshot}"
    manifest_key = args.manifest_key.strip() or f"{base_prefix}/manifest-{args.planner_id}.json"

    s3 = boto3.client(
        "s3",
        endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id,
        aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(
            retries={"max_attempts": 10, "mode": "adaptive"},
            max_pool_connections=max(32, int(args.head_workers) * 2),
        ),
    )

    def get_bytes(key: str) -> bytes:
        return s3.get_object(Bucket=source.bucket, Key=key)["Body"].read()

    def get_json(key: str, compressed: bool = False):
        body = get_bytes(key)
        raw = brotli.decompress(body) if compressed else body
        return json.loads(raw)

    manifest_body = get_bytes(manifest_key)
    manifest = json.loads(manifest_body)
    if int(manifest.get("schema_version", 0)) != 1:
        raise RuntimeError("Unsupported B2 search manifest schema.")
    if str(manifest.get("snapshot") or "") != args.snapshot:
        raise RuntimeError("Planner manifest snapshot does not match requested snapshot.")
    if int(manifest.get("location_count", 0)) <= 0 or int(manifest.get("published_count", 0)) <= 0:
        raise RuntimeError("Planner manifest contains no searchable locations.")

    planner = manifest.get("planner") or {}
    if int(planner.get("version", 0)) != 2:
        raise RuntimeError("Planner overlay manifest is not planner version 2.")
    planner_id = str(planner.get("id") or "")
    if planner_id != args.planner_id:
        raise RuntimeError(f"Planner manifest id {planner_id!r} does not match requested {args.planner_id!r}.")
    if planner.get("tight_document_bounds") is not True:
        raise RuntimeError("Planner overlay does not declare tight document bounds.")

    manifest_prefix = str(manifest.get("prefix") or base_prefix).rstrip("/")
    directory = (manifest.get("geo") or {}).get("directory") or {}
    route_prefix = str(directory.get("prefix") or "").rstrip("/")
    if not route_prefix:
        raise RuntimeError("Planner manifest is missing its routing prefix.")

    validation = manifest.get("validation") or {}
    counts = get_json(str(validation["counts_key"]), compressed=True)
    if int(counts.get("location_count", -1)) != int(manifest["location_count"]):
        raise RuntimeError("Validation count does not match manifest location_count.")
    if int(counts.get("published_count", -1)) != int(manifest["published_count"]):
        raise RuntimeError("Validation published count does not match manifest.")
    if int(counts.get("geo_shards", 0)) <= 0 or int(counts.get("routing_shards", 0)) <= 0:
        raise RuntimeError("Planner validation counts require geo and routing shards.")

    hashes_body = get_bytes(str(validation["hashes_key"]))
    if sha256_hex(hashes_body) != str(validation.get("hashes_sha256") or ""):
        raise RuntimeError("Planner hash ledger checksum does not match manifest.")
    raw_records = json.loads(brotli.decompress(hashes_body))
    if len(raw_records) != int(validation.get("artifact_count", -1)):
        raise RuntimeError("Planner hash ledger artifact count does not match manifest.")
    if not raw_records:
        raise RuntimeError("Planner hash ledger is empty.")

    records, exact_duplicates = unique_ledger_records(raw_records)
    if exact_duplicates:
        print(f"planner_ledger_exact_duplicates={exact_duplicates}", flush=True)

    def verify_head(record: dict) -> None:
        key, expected_size, expected_sha = record_identity(record)
        head = s3.head_object(Bucket=source.bucket, Key=key)
        if int(head.get("ContentLength", -1)) != expected_size:
            raise RuntimeError(f"Length mismatch for {key}.")
        if str((head.get("Metadata") or {}).get("sha256", "")).lower() != expected_sha:
            raise RuntimeError(f"SHA-256 metadata mismatch for {key}.")

    workers = max(1, min(32, int(args.head_workers)))
    for start in range(0, len(records), 1000):
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(verify_head, records[start : start + 1000]))
        print(f"planner_head_validated={min(len(records), start + 1000)}/{len(records)}", flush=True)

    sample_count = max(1, min(len(records), int(args.deep_hash_samples)))
    samples = sorted(records, key=lambda record: hashlib.sha256(record["key"].encode()).digest())[:sample_count]
    for record in samples:
        if sha256_hex(get_bytes(record["key"])) != str(record["sha256"]).lower():
            raise RuntimeError(f"Deep checksum mismatch for {record['key']}.")

    id_records = [record for record in records if record.get("kind") == "id"]
    slug_records = [record for record in records if record.get("kind") == "slug"]
    geo_records = [record for record in records if record.get("kind") == "geo"]
    route_records = [record for record in records if record.get("kind") == "routing"]
    if not id_records or not slug_records or not geo_records or not route_records:
        raise RuntimeError("Planner ledger must contain ID, slug, geo, and routing artifact families.")

    geo_by_key = {str(record["key"]): record for record in geo_records}
    referenced_geo: set[str] = set()
    descriptor_count = 0
    for index, route_record in enumerate(sorted(route_records, key=lambda item: str(item["key"])), start=1):
        route_key = str(route_record["key"])
        if not route_key.startswith(route_prefix + "/"):
            raise RuntimeError(f"Routing artifact is outside planner routing prefix: {route_key}")
        route = get_json(route_key, compressed=True)
        if not isinstance(route, list) or not route:
            raise RuntimeError(f"Routing artifact is empty or invalid: {route_key}")
        for descriptor in route:
            geo_key, _north, _south, _east, _west, count, compressed_bytes = descriptor_fields(descriptor)
            geo_record = geo_by_key.get(geo_key)
            if geo_record is None:
                raise RuntimeError(f"Routing descriptor points outside planner geo ledger: {geo_key}")
            if int(geo_record.get("count") or 0) != count:
                raise RuntimeError(f"Routing descriptor count disagrees with geo ledger: {geo_key}")
            if int(geo_record.get("compressed_bytes") or 0) != compressed_bytes:
                raise RuntimeError(f"Routing descriptor byte length disagrees with geo ledger: {geo_key}")
            referenced_geo.add(geo_key)
            descriptor_count += 1
        if index % 250 == 0 or index == len(route_records):
            print(f"planner_routes_validated={index}/{len(route_records)}", flush=True)

    missing_routes = set(geo_by_key) - referenced_geo
    if missing_routes:
        sample = sorted(missing_routes)[:10]
        raise RuntimeError(f"{len(missing_routes)} active geo shards are unreachable from routing: {sample}")

    id_map = get_json(str(id_records[0]["key"]), compressed=True)
    if not isinstance(id_map, dict) or not id_map:
        raise RuntimeError("ID shard did not decode to a non-empty map.")
    sample_id, sample_document = next(iter(id_map.items()))
    if str(sample_document.get("id")) != str(sample_id):
        raise RuntimeError("ID shard key and canonical document ID disagree.")
    sample_slug = str(sample_document.get("slug") or "").strip()
    if sample_slug:
        slug_key = f"{manifest_prefix}/slug/{hash_bucket(sample_slug)}.json.br"
        slug_map = get_json(slug_key, compressed=True)
        if str(slug_map.get(sample_slug)) != str(sample_id):
            raise RuntimeError("Slug shard does not resolve sample slug back to its ID.")

    sample_geo_key = sorted(geo_by_key)[0]
    geo_documents = get_json(sample_geo_key, compressed=True)
    if not isinstance(geo_documents, list) or not geo_documents:
        raise RuntimeError("Planner geo shard did not decode to a non-empty document list.")

    report = {
        "schema_version": 1,
        "snapshot": args.snapshot,
        "planner_id": planner_id,
        "manifest_key": manifest_key,
        "validated_at": utc_now(),
        "location_count": manifest["location_count"],
        "published_count": manifest["published_count"],
        "artifact_count": len(records),
        "geo_shards": len(geo_records),
        "routing_shards": len(route_records),
        "routing_descriptors": descriptor_count,
        "deep_hash_samples": sample_count,
        "checks": {
            "manifest": True,
            "counts": True,
            "ledger": True,
            "artifact_presence_length_sha256_metadata": True,
            "deep_hash_sample": True,
            "routing_prefix": True,
            "routing_targets": True,
            "all_geo_shards_routable": True,
            "id_lookup": True,
            "slug_lookup": bool(sample_slug),
            "geo_decode": True,
        },
    }
    report_key = f"{manifest_prefix}/validation/report-{planner_id}.json"
    s3.put_object(
        Bucket=source.bucket,
        Key=report_key,
        Body=json_bytes(report),
        ContentType="application/json",
        CacheControl="no-store",
    )

    if args.activate:
        active_key = f"{source.data_prefix}/search/active.json"
        previous = None
        try:
            previous = json.loads(get_bytes(active_key))
        except Exception as error:
            code = getattr(error, "response", {}).get("Error", {}).get("Code")
            if code not in {"NoSuchKey", "404", "NotFound"}:
                raise
        activated = {
            "schema_version": 1,
            "snapshot": args.snapshot,
            "manifest_key": manifest_key,
            "activated_at": utc_now(),
            "validation_report_key": report_key,
            "planner_id": planner_id,
        }
        if previous:
            history_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            s3.put_object(
                Bucket=source.bucket,
                Key=f"{source.data_prefix}/search/history/{history_stamp}.json",
                Body=json_bytes({"previous": previous, "replacement": activated}),
                ContentType="application/json",
                CacheControl="public,max-age=31536000,immutable",
            )
        s3.put_object(
            Bucket=source.bucket,
            Key=active_key,
            Body=json_bytes(activated),
            ContentType="application/json",
            CacheControl="no-store",
        )
        report["activated"] = True
        report["active_key"] = active_key

    print(json.dumps(report, indent=2, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
