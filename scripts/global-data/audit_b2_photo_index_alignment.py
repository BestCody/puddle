#!/usr/bin/env python3
"""Audit whether the active B2 photo overlay uses active search-index IDs.

The photo overlay is intentionally published independently of the immutable
location index.  This check verifies the contract between those two artifacts
without downloading the whole catalogue: it samples overlay IDs through the
active ID shards and scans one configurable geographic window through the
active routing/geo shards.
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import json
import math
import os
import sys

import boto3
import brotli
import orjson
from botocore.client import Config
from botocore.exceptions import ClientError


def clean(value: object) -> str:
    return str(value or "").strip().strip("/")


def env_first(*names: str, default: str = "") -> str:
    for name in names:
        value = str(os.getenv(name) or "").strip()
        if value:
            return value
    return default


def missing(error: ClientError) -> bool:
    response = error.response or {}
    code = str((response.get("Error") or {}).get("Code") or "")
    status = int((response.get("ResponseMetadata") or {}).get("HTTPStatusCode") or 0)
    return code in {"404", "NoSuchKey", "NotFound"} or status == 404


def get_bytes(client, bucket: str, key: str) -> bytes:
    return client.get_object(Bucket=bucket, Key=key)["Body"].read()


def get_json(client, bucket: str, key: str):
    return orjson.loads(get_bytes(client, bucket, key))


def decode_json(client, bucket: str, key: str):
    return orjson.loads(brotli.decompress(get_bytes(client, bucket, key)))


def sha256_bucket(value: object) -> str:
    return hashlib.sha256(str(value).encode()).hexdigest()[:3]


def bloom_may_contain(identifier: str, bloom: dict | None) -> bool:
    if not bloom:
        return True
    bit_count = int(bloom["bit_count"])
    hash_count = int(bloom["hash_count"])
    bits = base64.b64decode(str(bloom["bits"]))
    digest = hashlib.sha256(identifier.encode()).digest()
    for index in range(hash_count):
        offset = (index * 4) % 29
        bit = int.from_bytes(digest[offset : offset + 4], "big") % bit_count
        if not (bits[bit >> 3] & (1 << (bit & 7))):
            return False
    return True


def longitude_ranges(west: float, east: float):
    return [(west, east)] if west <= east else [(west, 180.0), (-180.0, east)]


def directory_tiles(bounds: dict, degrees: float):
    lat_count = int(math.ceil(180 / degrees))
    lon_count = int(math.ceil(360 / degrees))
    south = max(0, min(lat_count - 1, int(math.floor((max(-90, bounds["south"]) + 90) / degrees))))
    north = max(0, min(lat_count - 1, int(math.floor((min(89.999999, bounds["north"]) + 90) / degrees))))
    for west, east in longitude_ranges(bounds["west"], bounds["east"]):
        west_index = max(0, min(lon_count - 1, int(math.floor((west + 180) / degrees))))
        east_index = max(0, min(lon_count - 1, int(math.floor((min(179.999999, east) + 180) / degrees))))
        for lat_index in range(south, north + 1):
            for lon_index in range(west_index, east_index + 1):
                yield lat_index, lon_index


def overlaps(left: dict, right: dict) -> bool:
    if left["south"] > right["north"] or right["south"] > left["north"]:
        return False
    for left_west, left_east in longitude_ranges(left["west"], left["east"]):
        for right_west, right_east in longitude_ranges(right["west"], right["east"]):
            if left_west <= right_east and right_west <= left_east:
                return True
    return False


def descriptor_parts(value) -> tuple[str, dict] | None:
    if isinstance(value, list) and len(value) >= 8:
        return str(value[0]), {
            "north": float(value[2]),
            "south": float(value[3]),
            "east": float(value[4]),
            "west": float(value[5]),
        }
    if isinstance(value, dict) and value.get("key"):
        return str(value["key"]), {
            "north": float(value["north"]),
            "south": float(value["south"]),
            "east": float(value["east"]),
            "west": float(value["west"]),
        }
    return None


def point_in_bounds(row: dict, bounds: dict) -> bool:
    try:
        latitude = float(row["latitude"])
        longitude = float(row["longitude"])
    except (KeyError, TypeError, ValueError):
        return False
    if not bounds["south"] <= latitude <= bounds["north"]:
        return False
    return any(west <= longitude <= east for west, east in longitude_ranges(bounds["west"], bounds["east"]))


def sample_overlay_ids(entries: list, sample_size: int) -> list[str]:
    ids = [str(entry[0]) for entry in entries if isinstance(entry, list) and len(entry) == 2 and str(entry[0]).strip()]
    if len(ids) <= sample_size:
        return ids
    stride = max(1, len(ids) // sample_size)
    selected = ids[::stride][:sample_size]
    if ids[0] not in selected:
        selected[0] = ids[0]
    return list(dict.fromkeys(selected))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample-size", type=int, default=100)
    parser.add_argument("--south", type=float, default=43.40)
    parser.add_argument("--north", type=float, default=43.90)
    parser.add_argument("--west", type=float, default=-79.90)
    parser.add_argument("--east", type=float, default=-78.90)
    parser.add_argument("--require-match", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.sample_size <= 1000:
        raise RuntimeError("--sample-size must be between 1 and 1000.")
    bounds = {"south": args.south, "north": args.north, "west": args.west, "east": args.east}

    bucket = env_first("B2_DATA_BUCKET_NAME", "B2_BUCKET", default="puddle-assets")
    endpoint = env_first("B2_DATA_S3_ENDPOINT", "B2_S3_ENDPOINT")
    region = env_first("B2_DATA_S3_REGION", "B2_REGION", default="us-east-005")
    key_id = env_first("B2_DATA_APPLICATION_KEY_ID", "B2_DATA_KEY_ID", "B2_KEY_ID")
    application_key = env_first("B2_DATA_APPLICATION_KEY", "B2_APPLICATION_KEY")
    prefix = clean(env_first("B2_DATA_PREFIX", default="data"))
    if not endpoint or not key_id or not application_key:
        raise RuntimeError("B2 S3 endpoint and application credentials are required.")

    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key_id,
        aws_secret_access_key=application_key,
        region_name=region,
        config=Config(retries={"max_attempts": 10, "mode": "adaptive"}, max_pool_connections=24),
    )
    active_key = f"{prefix}/search/active.json"
    active = get_json(client, bucket, active_key)
    manifest_key = clean(active.get("manifest_key"))
    manifest = get_json(client, bucket, manifest_key)
    overlay_key = f"{prefix}/search/photo-overlay-v1/active.json"
    overlay_active = get_json(client, bucket, overlay_key)
    overlay_object_key = clean(overlay_active.get("object_key"))
    overlay_payload = orjson.loads(brotli.decompress(get_bytes(client, bucket, overlay_object_key)))
    overlay_entries = overlay_payload[1] if isinstance(overlay_payload, list) and len(overlay_payload) == 2 else []
    overlay_ids = {str(entry[0]) for entry in overlay_entries if isinstance(entry, list) and len(entry) == 2}
    sampled_ids = sample_overlay_ids(overlay_entries, args.sample_size)

    id_prefix = clean(manifest["prefix"])
    id_keys = {identifier: f"{id_prefix}/id/{sha256_bucket(identifier)}.json.br" for identifier in sampled_ids}

    def inspect_id_shard(key: str):
        try:
            value = decode_json(client, bucket, key)
        except ClientError as error:
            if missing(error):
                return key, None, None
            raise
        return key, value, None

    unique_id_keys = sorted(set(id_keys.values()))
    id_values: dict[str, dict] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        for key, value, _ in pool.map(inspect_id_shard, unique_id_keys):
            if isinstance(value, dict):
                id_values[key] = value
    id_matches = [identifier for identifier, key in id_keys.items() if identifier in id_values.get(key, {})]

    directory = manifest.get("geo", {}).get("directory", {})
    tile_degrees = float(directory.get("tile_degrees") or 1)
    routing_prefix = clean(directory.get("prefix") or f"{id_prefix}/routing")
    route_keys = [f"{routing_prefix}/{lat}/{lon}.json.br" for lat, lon in directory_tiles(bounds, tile_degrees)]

    def read_optional(key: str):
        try:
            return decode_json(client, bucket, key)
        except ClientError as error:
            if missing(error):
                return None
            raise

    routes = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        for route in pool.map(read_optional, route_keys):
            if isinstance(route, list):
                routes.extend(route)
    geo_keys = set()
    for descriptor in routes:
        parts = descriptor_parts(descriptor)
        if parts and overlaps(parts[1], bounds):
            geo_keys.add(parts[0])

    def read_geo(key: str):
        return key, decode_json(client, bucket, key)

    index_ids: set[str] = set()
    geo_documents = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        for _, documents in pool.map(read_geo, sorted(geo_keys)):
            if not isinstance(documents, list):
                raise RuntimeError("Active geo object is not an array.")
            geo_documents += len(documents)
            index_ids.update(str(row.get("id")) for row in documents if isinstance(row, dict) and row.get("id") and point_in_bounds(row, bounds))

    toronto_matches = sorted(index_ids & overlay_ids)
    summary = {
        "ok": bool(id_matches or toronto_matches),
        "activeSnapshot": active.get("snapshot") or manifest.get("snapshot"),
        "activeManifestKey": manifest_key,
        "overlayObjectKey": overlay_object_key,
        "overlayPhotoCount": len(overlay_ids),
        "overlayPointerPhotoCount": int(overlay_active.get("photo_count") or 0),
        "overlaySampleCount": len(sampled_ids),
        "overlaySampleIndexMatches": len(id_matches),
        "overlaySampleIndexMatchRate": round(len(id_matches) / max(1, len(sampled_ids)), 4),
        "geographicWindow": bounds,
        "routingTiles": len(route_keys),
        "geoShardCount": len(geo_keys),
        "geoDocumentCount": geo_documents,
        "windowIndexIdCount": len(index_ids),
        "windowOverlayMatches": len(toronto_matches),
        "sampleOverlayIds": sampled_ids[:5],
        "sampleIndexIds": sorted(index_ids)[:5],
        "sampleWindowMatches": toronto_matches[:5],
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    if args.require_match and not summary["ok"]:
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)[:500]}), file=sys.stderr)
        raise
