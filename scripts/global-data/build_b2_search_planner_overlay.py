#!/usr/bin/env python3
"""Build a query-planner overlay from an already validated B2 search candidate.

The overlay reuses hydration/coarse-map artifacts, tightens every geo descriptor to
actual document bounds, and microshards only oversized geo leaves. It never
rewrites the base candidate's immutable geo objects.
"""
from __future__ import annotations

import argparse
import hashlib
import math
import os
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import boto3
import brotli
import h3
import orjson
from botocore.client import Config
from botocore.exceptions import ClientError

from location_search_common import b2_source_config

PLANNER_VERSION = 2
DEFAULT_TARGET_CANDIDATES = 4000
DEFAULT_TARGET_BYTES = 512 * 1024
MAX_H3_RESOLUTION = 15
MAX_RUNTIME_OBJECT_BYTES = 16 * 1024 * 1024


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def is_missing(error: ClientError) -> bool:
    code = str(error.response.get("Error", {}).get("Code") or "")
    status = int(error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") or 0)
    return code in {"404", "NoSuchKey", "NotFound"} or status == 404


def minimal_longitude_bounds(longitudes: list[float]) -> tuple[float, float]:
    west = min(longitudes)
    east = max(longitudes)
    if east - west <= 180:
        return west, east
    shifted = [value if value >= 0 else value + 360 for value in longitudes]
    west_shifted = min(shifted)
    east_shifted = max(shifted)

    def wrap(value: float) -> float:
        return value - 360 if value > 180 else value

    return wrap(west_shifted), wrap(east_shifted)


def document_bounds(documents: list[dict]) -> dict:
    if not documents:
        raise RuntimeError("Planner cannot route an empty geo shard.")
    latitudes: list[float] = []
    longitudes: list[float] = []
    for document in documents:
        try:
            latitude = float(document["latitude"])
            longitude = float(document["longitude"])
        except (KeyError, TypeError, ValueError) as error:
            raise RuntimeError(f"Geo document {document.get('id')} has invalid coordinates.") from error
        if not math.isfinite(latitude) or not -90 <= latitude <= 90:
            raise RuntimeError(f"Geo document {document.get('id')} has invalid latitude.")
        if not math.isfinite(longitude) or not -180 <= longitude <= 180:
            raise RuntimeError(f"Geo document {document.get('id')} has invalid longitude.")
        latitudes.append(latitude)
        longitudes.append(longitude)
    west, east = minimal_longitude_bounds(longitudes)
    return {
        "north": max(latitudes),
        "south": min(latitudes),
        "east": east,
        "west": west,
    }


def longitude_ranges(west: float, east: float):
    return [(west, east)] if west <= east else [(west, 180.0), (-180.0, east)]


def directory_tiles(bounds: dict, degrees: float):
    lat_count = int(math.ceil(180 / degrees))
    lon_count = int(math.ceil(360 / degrees))
    south = max(0, min(lat_count - 1, int(math.floor((max(-90, bounds["south"]) + 90) / degrees))))
    north_value = min(89.999999, bounds["north"])
    north = max(0, min(lat_count - 1, int(math.floor((north_value + 90) / degrees))))
    for west, east in longitude_ranges(bounds["west"], bounds["east"]):
        west_index = max(0, min(lon_count - 1, int(math.floor((west + 180) / degrees))))
        east_value = min(179.999999, east)
        east_index = max(0, min(lon_count - 1, int(math.floor((east_value + 180) / degrees))))
        for lat_index in range(south, north + 1):
            for lon_index in range(west_index, east_index + 1):
                yield lat_index, lon_index


def ordered_documents(documents: list[dict]) -> list[dict]:
    return sorted(documents, key=lambda item: str(item.get("id") or ""))


def brotli_json(documents: list[dict]) -> tuple[list[dict], bytes, int]:
    ordered = ordered_documents(documents)
    raw = orjson.dumps(ordered)
    body = brotli.compress(raw, quality=5, mode=brotli.MODE_TEXT)
    return ordered, body, len(raw)


def record_identity(record: dict) -> tuple[str, int, str]:
    key = str(record.get("key") or "")
    if not key:
        raise RuntimeError("Hash ledger contains an artifact with no key.")
    try:
        compressed_bytes = int(record["compressed_bytes"])
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError(f"Hash ledger has an invalid byte length for {key}.") from error
    digest = str(record.get("sha256") or "").lower()
    if compressed_bytes < 0 or len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
        raise RuntimeError(f"Hash ledger has invalid integrity metadata for {key}.")
    return key, compressed_bytes, digest


def unique_records(records: list[dict]) -> list[dict]:
    by_key: dict[str, dict] = {}
    for record in records:
        key, compressed_bytes, digest = record_identity(record)
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = record
            continue
        _, existing_bytes, existing_digest = record_identity(existing)
        if (existing_bytes, existing_digest) != (compressed_bytes, digest):
            raise RuntimeError(f"Hash ledger has conflicting records for {key}.")
    return list(by_key.values())


def split_documents(
    source_cell: str,
    documents: list[dict],
    *,
    target_candidates: int,
    target_bytes: int,
) -> list[tuple[str, list[dict], bytes, int]]:
    leaves: list[tuple[str, list[dict], bytes, int]] = []

    def recurse(cell: str, values: list[dict], suffix: str = "") -> None:
        ordered, body, raw_bytes = brotli_json(values)
        if len(ordered) <= target_candidates and len(body) <= target_bytes:
            leaves.append((f"{cell}{suffix}", ordered, body, raw_bytes))
            return

        resolution = h3.get_resolution(cell)
        if resolution < MAX_H3_RESOLUTION:
            next_resolution = resolution + 1
            groups: dict[str, list[dict]] = defaultdict(list)
            for document in ordered:
                child = h3.latlng_to_cell(
                    float(document["latitude"]),
                    float(document["longitude"]),
                    next_resolution,
                )
                groups[child].append(document)
            # Moving down a single-child chain is still useful because a later
            # resolution can separate a very dense parent cell.
            if groups:
                for child in sorted(groups):
                    recurse(child, groups[child], suffix)
                return

        # Pathological same-coordinate clusters can remain in one H3 cell even at
        # resolution 15. Split deterministically so no runtime object or planner
        # leaf has to exceed the target merely because geometry cannot separate it.
        if len(ordered) <= 1:
            if len(body) > MAX_RUNTIME_OBJECT_BYTES:
                raise RuntimeError(
                    f"Single location {ordered[0].get('id')} produces a {len(body)}-byte geo object."
                )
            leaves.append((f"{cell}{suffix}", ordered, body, raw_bytes))
            return

        latitudes = [float(item["latitude"]) for item in ordered]
        longitudes = [float(item["longitude"]) for item in ordered]
        lat_span = max(latitudes) - min(latitudes)
        lon_span = max(longitudes) - min(longitudes)
        if lat_span >= lon_span:
            ordered.sort(key=lambda item: (float(item["latitude"]), float(item["longitude"]), str(item.get("id") or "")))
        else:
            ordered.sort(key=lambda item: (float(item["longitude"]), float(item["latitude"]), str(item.get("id") or "")))
        midpoint = len(ordered) // 2
        recurse(cell, ordered[:midpoint], suffix + "a")
        recurse(cell, ordered[midpoint:], suffix + "b")

    recurse(source_cell, documents)
    return leaves


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument(
        "--target-candidates",
        type=int,
        default=int(os.getenv("GLOBAL_LOCATION_PLANNER_TARGET_CANDIDATES", str(DEFAULT_TARGET_CANDIDATES))),
    )
    parser.add_argument(
        "--target-compressed-bytes",
        type=int,
        default=int(os.getenv("GLOBAL_LOCATION_PLANNER_TARGET_BYTES", str(DEFAULT_TARGET_BYTES))),
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=int(os.getenv("GLOBAL_LOCATION_PLANNER_WORKERS", "16")),
    )
    args = parser.parse_args()

    target_candidates = max(500, min(20_000, int(args.target_candidates)))
    target_bytes = max(128 * 1024, min(2 * 1024 * 1024, int(args.target_compressed_bytes)))
    workers = max(1, min(32, int(args.workers)))
    planner_id = f"v{PLANNER_VERSION}-c{target_candidates}-b{target_bytes}"

    source = b2_source_config()
    base_prefix = f"{source.data_prefix}/search/schema=v1/snapshot={args.snapshot}"
    base_manifest_key = f"{base_prefix}/manifest.json"
    planner_manifest_key = f"{base_prefix}/manifest-{planner_id}.json"
    planner_candidate_key = f"{source.data_prefix}/search/candidates/{args.snapshot}-{planner_id}.json"
    planner_geo_prefix = f"{base_prefix}/geo-{planner_id}"
    planner_route_prefix = f"{base_prefix}/routing-{planner_id}"
    planner_counts_key = f"{base_prefix}/validation/counts-{planner_id}.json.br"
    planner_hashes_key = f"{base_prefix}/validation/hashes-{planner_id}.json.br"

    s3 = boto3.client(
        "s3",
        endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id,
        aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(
            retries={"max_attempts": 10, "mode": "adaptive"},
            max_pool_connections=max(32, workers * 2),
        ),
    )

    def get_bytes(key: str) -> bytes:
        return s3.get_object(Bucket=source.bucket, Key=key)["Body"].read()

    def get_optional_json(key: str):
        try:
            return orjson.loads(get_bytes(key))
        except ClientError as error:
            if is_missing(error):
                return None
            raise

    def put_immutable(
        key: str,
        body: bytes,
        *,
        kind: str,
        count: int | None,
        uncompressed_bytes: int,
        content_type: str = "application/json",
    ) -> dict:
        digest = sha256_hex(body)
        try:
            head = s3.head_object(Bucket=source.bucket, Key=key)
        except ClientError as error:
            if not is_missing(error):
                raise
        else:
            actual_size = int(head.get("ContentLength", -1))
            actual_sha = str((head.get("Metadata") or {}).get("sha256", "")).lower()
            if actual_size != len(body) or actual_sha != digest:
                raise RuntimeError(
                    f"Immutable planner artifact already exists with different bytes: {key}"
                )
            record = {
                "key": key,
                "sha256": digest,
                "compressed_bytes": len(body),
                "uncompressed_bytes": int(uncompressed_bytes),
                "kind": kind,
            }
            if count is not None:
                record["count"] = int(count)
            return record

        s3.put_object(
            Bucket=source.bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
            CacheControl="public,max-age=31536000,immutable",
            Metadata={"sha256": digest},
        )
        record = {
            "key": key,
            "sha256": digest,
            "compressed_bytes": len(body),
            "uncompressed_bytes": int(uncompressed_bytes),
            "kind": kind,
        }
        if count is not None:
            record["count"] = int(count)
        return record

    base_manifest_body = get_bytes(base_manifest_key)
    base_manifest_sha = sha256_hex(base_manifest_body)
    base_manifest = orjson.loads(base_manifest_body)
    if int(base_manifest.get("schema_version", 0)) != 1:
        raise RuntimeError("Planner overlay requires B2 search schema version 1.")
    if str(base_manifest.get("snapshot") or "") != args.snapshot:
        raise RuntimeError("Base manifest snapshot does not match requested planner snapshot.")

    existing_manifest = get_optional_json(planner_manifest_key)
    if existing_manifest is not None:
        planner = existing_manifest.get("planner") or {}
        if (
            int(planner.get("version", 0)) != PLANNER_VERSION
            or str(planner.get("base_manifest_sha256") or "") != base_manifest_sha
            or int(planner.get("target_candidates", -1)) != target_candidates
            or int(planner.get("target_compressed_bytes", -1)) != target_bytes
        ):
            raise RuntimeError(
                f"Existing planner manifest {planner_manifest_key} does not match requested configuration."
            )
        candidate = {
            "schema_version": 1,
            "snapshot": args.snapshot,
            "manifest_key": planner_manifest_key,
            "location_count": int(existing_manifest["location_count"]),
            "built_at": existing_manifest.get("built_at"),
            "planner_id": planner_id,
        }
        s3.put_object(
            Bucket=source.bucket,
            Key=planner_candidate_key,
            Body=orjson.dumps(candidate, option=orjson.OPT_INDENT_2) + b"\n",
            ContentType="application/json",
            CacheControl="no-store",
        )
        print(
            f"planner_overlay_reused=true planner_id={planner_id} manifest_key={planner_manifest_key}",
            flush=True,
        )
        print(orjson.dumps(candidate, option=orjson.OPT_INDENT_2).decode(), flush=True)
        return

    validation = base_manifest.get("validation") or {}
    base_hashes_body = get_bytes(str(validation["hashes_key"]))
    if sha256_hex(base_hashes_body) != str(validation.get("hashes_sha256") or ""):
        raise RuntimeError("Base hash ledger checksum does not match base manifest.")
    base_records = unique_records(orjson.loads(brotli.decompress(base_hashes_body)))
    geo_records = sorted(
        (record for record in base_records if record.get("kind") == "geo"),
        key=lambda record: str(record["key"]),
    )
    if not geo_records:
        raise RuntimeError("Base candidate contains no geo shards.")

    shared_records = [
        record
        for record in base_records
        if record.get("kind") not in {"geo", "routing", "validation-counts"}
    ]
    base_counts_body = get_bytes(str(validation["counts_key"]))
    base_counts = orjson.loads(brotli.decompress(base_counts_body))
    directory_degrees = float(((base_manifest.get("geo") or {}).get("directory") or {}).get("tile_degrees") or 1)
    if not 0.25 <= directory_degrees <= 5:
        raise RuntimeError(f"Invalid base routing tile size {directory_degrees}.")

    routes: dict[tuple[int, int], list] = defaultdict(list)
    active_geo_records: list[dict] = []
    reused_geo_shards = 0
    split_source_geo_shards = 0
    produced_microshards = 0
    source_compressed_bytes = 0
    active_compressed_bytes = 0

    def process_geo(record: dict):
        key, expected_size, expected_sha = record_identity(record)
        body = get_bytes(key)
        if len(body) != expected_size or sha256_hex(body) != expected_sha:
            raise RuntimeError(f"Base geo shard integrity mismatch while planning: {key}")
        documents = orjson.loads(brotli.decompress(body))
        if not isinstance(documents, list) or not documents:
            raise RuntimeError(f"Base geo shard does not decode to a non-empty list: {key}")
        expected_count = record.get("count")
        if expected_count is not None and int(expected_count) != len(documents):
            raise RuntimeError(f"Base geo shard count mismatch: {key}")

        source_cell = key.rsplit("/", 1)[-1].removesuffix(".json.br")
        tight_bounds = document_bounds(documents)
        if len(documents) <= target_candidates and len(body) <= target_bytes:
            descriptor = [
                key,
                source_cell,
                tight_bounds["north"],
                tight_bounds["south"],
                tight_bounds["east"],
                tight_bounds["west"],
                len(documents),
                len(body),
            ]
            return {
                "source_bytes": len(body),
                "reused": True,
                "records": [record],
                "descriptors": [descriptor],
            }

        leaves = split_documents(
            source_cell,
            documents,
            target_candidates=target_candidates,
            target_bytes=target_bytes,
        )
        token = hashlib.sha256(key.encode()).hexdigest()[:16]
        output_records: list[dict] = []
        descriptors: list[list] = []
        for index, (label, leaf_documents, leaf_body, raw_bytes) in enumerate(leaves):
            relative = f"{token}/{index:04d}.json.br"
            leaf_key = f"{planner_geo_prefix}/{relative}"
            leaf_record = put_immutable(
                leaf_key,
                leaf_body,
                kind="geo",
                count=len(leaf_documents),
                uncompressed_bytes=raw_bytes,
            )
            bounds = document_bounds(leaf_documents)
            output_records.append(leaf_record)
            descriptors.append(
                [
                    leaf_key,
                    f"{label}:{index}",
                    bounds["north"],
                    bounds["south"],
                    bounds["east"],
                    bounds["west"],
                    len(leaf_documents),
                    len(leaf_body),
                ]
            )
        return {
            "source_bytes": len(body),
            "reused": False,
            "records": output_records,
            "descriptors": descriptors,
        }

    processed = 0
    for start in range(0, len(geo_records), workers * 8):
        batch = geo_records[start : start + workers * 8]
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(process_geo, record) for record in batch]
            for future in as_completed(futures):
                result = future.result()
                processed += 1
                source_compressed_bytes += int(result["source_bytes"])
                if result["reused"]:
                    reused_geo_shards += 1
                else:
                    split_source_geo_shards += 1
                    produced_microshards += len(result["records"])
                for record in result["records"]:
                    active_geo_records.append(record)
                    active_compressed_bytes += int(record["compressed_bytes"])
                for descriptor in result["descriptors"]:
                    bounds = {
                        "north": float(descriptor[2]),
                        "south": float(descriptor[3]),
                        "east": float(descriptor[4]),
                        "west": float(descriptor[5]),
                    }
                    for tile in directory_tiles(bounds, directory_degrees):
                        routes[tile].append(descriptor)
                if processed % 250 == 0 or processed == len(geo_records):
                    print(
                        "planner_geo_processed="
                        f"{processed}/{len(geo_records)} reused={reused_geo_shards} "
                        f"split_sources={split_source_geo_shards} active_geo={len(active_geo_records)}",
                        flush=True,
                    )

    route_records: list[dict] = []
    for index, ((lat_index, lon_index), descriptors) in enumerate(sorted(routes.items()), start=1):
        descriptors.sort(key=lambda item: str(item[0]))
        raw = orjson.dumps(descriptors)
        body = brotli.compress(raw, quality=5, mode=brotli.MODE_TEXT)
        key = f"{planner_route_prefix}/{lat_index}/{lon_index}.json.br"
        record = put_immutable(
            key,
            body,
            kind="routing",
            count=len(descriptors),
            uncompressed_bytes=len(raw),
        )
        route_records.append(record)
        if index % 250 == 0 or index == len(routes):
            print(f"planner_routing_written={index}/{len(routes)}", flush=True)

    counts = dict(base_counts)
    counts["geo_shards"] = len(active_geo_records)
    counts["routing_shards"] = len(route_records)
    counts["planner_version"] = PLANNER_VERSION
    counts["planner_id"] = planner_id
    counts_raw = orjson.dumps(counts)
    counts_body = brotli.compress(counts_raw, quality=5, mode=brotli.MODE_TEXT)
    counts_record = put_immutable(
        planner_counts_key,
        counts_body,
        kind="validation-counts",
        count=None,
        uncompressed_bytes=len(counts_raw),
    )

    active_records = unique_records(
        shared_records + active_geo_records + route_records + [counts_record]
    )
    active_records.sort(key=lambda record: str(record["key"]))
    hashes_raw = orjson.dumps(active_records)
    hashes_body = brotli.compress(hashes_raw, quality=5, mode=brotli.MODE_TEXT)
    hashes_digest = sha256_hex(hashes_body)
    put_immutable(
        planner_hashes_key,
        hashes_body,
        kind="validation-hashes",
        count=len(active_records),
        uncompressed_bytes=len(hashes_raw),
    )

    manifest = dict(base_manifest)
    manifest["built_at"] = utc_now()
    manifest["planner"] = {
        "version": PLANNER_VERSION,
        "id": planner_id,
        "base_manifest_key": base_manifest_key,
        "base_manifest_sha256": base_manifest_sha,
        "target_candidates": target_candidates,
        "target_compressed_bytes": target_bytes,
        "tight_document_bounds": True,
        "source_geo_shards": len(geo_records),
        "reused_geo_shards": reused_geo_shards,
        "split_source_geo_shards": split_source_geo_shards,
        "active_geo_shards": len(active_geo_records),
        "new_microshards": produced_microshards,
        "source_geo_compressed_bytes": source_compressed_bytes,
        "active_geo_compressed_bytes": active_compressed_bytes,
    }
    manifest["shard_counts"] = dict(base_manifest.get("shard_counts") or {})
    manifest["shard_counts"]["geo_shards"] = len(active_geo_records)
    manifest["shard_counts"]["routing_shards"] = len(route_records)
    manifest["geo"] = dict(base_manifest.get("geo") or {})
    manifest["geo"]["directory"] = {
        "tile_degrees": directory_degrees,
        "prefix": planner_route_prefix,
    }
    manifest["geo"]["planner_target_candidates"] = target_candidates
    manifest["geo"]["planner_target_compressed_bytes"] = target_bytes
    manifest["geo"]["tight_document_bounds"] = True
    manifest["validation"] = {
        "counts_key": planner_counts_key,
        "hashes_key": planner_hashes_key,
        "hashes_sha256": hashes_digest,
        "artifact_count": len(active_records),
    }

    manifest_body = orjson.dumps(manifest, option=orjson.OPT_INDENT_2) + b"\n"
    put_immutable(
        planner_manifest_key,
        manifest_body,
        kind="manifest",
        count=None,
        uncompressed_bytes=len(manifest_body),
        content_type="application/json",
    )

    candidate = {
        "schema_version": 1,
        "snapshot": args.snapshot,
        "manifest_key": planner_manifest_key,
        "location_count": int(manifest["location_count"]),
        "built_at": manifest["built_at"],
        "planner_id": planner_id,
    }
    s3.put_object(
        Bucket=source.bucket,
        Key=planner_candidate_key,
        Body=orjson.dumps(candidate, option=orjson.OPT_INDENT_2) + b"\n",
        ContentType="application/json",
        CacheControl="no-store",
    )

    print(
        "planner_overlay_complete=true "
        f"planner_id={planner_id} source_geo_shards={len(geo_records)} "
        f"active_geo_shards={len(active_geo_records)} routing_shards={len(route_records)} "
        f"manifest_key={planner_manifest_key} candidate_key={planner_candidate_key}",
        flush=True,
    )
    print(orjson.dumps(candidate, option=orjson.OPT_INDENT_2).decode(), flush=True)


if __name__ == "__main__":
    main()
