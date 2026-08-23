"""Pure helpers shared by the B2 planner-overlay builder."""
from __future__ import annotations

import hashlib
import math
from collections import defaultdict

import brotli
import h3
import orjson

PLANNER_VERSION = 2
PLANNER_CHECKPOINT_VERSION = 1
DEFAULT_TARGET_CANDIDATES = 4000
DEFAULT_TARGET_BYTES = 512 * 1024
DEFAULT_CHECKPOINT_GEO_BATCH = 16
DEFAULT_CHECKPOINT_ROUTE_BATCH = 100
MAX_H3_RESOLUTION = 15
MAX_RUNTIME_OBJECT_BYTES = 16 * 1024 * 1024


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def is_missing(error: Exception) -> bool:
    response = getattr(error, "response", {}) or {}
    code = str((response.get("Error") or {}).get("Code") or "")
    status = int((response.get("ResponseMetadata") or {}).get("HTTPStatusCode") or 0)
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
            raise RuntimeError(
                f"Geo document {document.get('id')} has invalid coordinates."
            ) from error
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
    south = max(
        0,
        min(
            lat_count - 1,
            int(math.floor((max(-90, bounds["south"]) + 90) / degrees)),
        ),
    )
    north_value = min(89.999999, bounds["north"])
    north = max(
        0,
        min(lat_count - 1, int(math.floor((north_value + 90) / degrees))),
    )
    for west, east in longitude_ranges(bounds["west"], bounds["east"]):
        west_index = max(
            0,
            min(lon_count - 1, int(math.floor((west + 180) / degrees))),
        )
        east_value = min(179.999999, east)
        east_index = max(
            0,
            min(lon_count - 1, int(math.floor((east_value + 180) / degrees))),
        )
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
    if compressed_bytes < 0 or len(digest) != 64 or any(
        char not in "0123456789abcdef" for char in digest
    ):
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
            groups: dict[str, list[dict]] = defaultdict(list)
            for document in ordered:
                child = h3.latlng_to_cell(
                    float(document["latitude"]),
                    float(document["longitude"]),
                    resolution + 1,
                )
                groups[child].append(document)
            if groups:
                for child in sorted(groups):
                    recurse(child, groups[child], suffix)
                return

        if len(ordered) <= 1:
            if len(body) > MAX_RUNTIME_OBJECT_BYTES:
                raise RuntimeError(
                    f"Single location {ordered[0].get('id')} produces a {len(body)}-byte geo object."
                )
            leaves.append((f"{cell}{suffix}", ordered, body, raw_bytes))
            return

        latitudes = [float(item["latitude"]) for item in ordered]
        longitudes = [float(item["longitude"]) for item in ordered]
        if max(latitudes) - min(latitudes) >= max(longitudes) - min(longitudes):
            ordered.sort(
                key=lambda item: (
                    float(item["latitude"]),
                    float(item["longitude"]),
                    str(item.get("id") or ""),
                )
            )
        else:
            ordered.sort(
                key=lambda item: (
                    float(item["longitude"]),
                    float(item["latitude"]),
                    str(item.get("id") or ""),
                )
            )
        midpoint = len(ordered) // 2
        recurse(cell, ordered[:midpoint], suffix + "a")
        recurse(cell, ordered[midpoint:], suffix + "b")

    recurse(source_cell, documents)
    return leaves
