#!/usr/bin/env python3
"""Build an immutable, adaptive-H3 B2 search snapshot from canonical location Parquet."""
from __future__ import annotations

import argparse
import hashlib
import heapq
import math
import os
import shutil
import tempfile
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

import boto3
import brotli
import duckdb
import h3
import orjson
import zstandard as zstd
from botocore.client import Config

from location_search_common import (
    b2_source_config,
    canonical_columns,
    canonical_query,
    configure_duckdb,
    create_canonical_views,
    document_from_values,
)

HEX_BUCKETS = 4096


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def hash_bucket(value: object) -> str:
    return hashlib.sha256(str(value).encode()).hexdigest()[:3]


def positive_int(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, int(value)))


def finite_coordinate(value: object, minimum: float, maximum: float) -> bool:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(number) and minimum <= number <= maximum


def disambiguated_slug(slug: str, identifier: str) -> str:
    """Return a deterministic collision-only slug without changing normal slugs."""
    compact_id = str(identifier).replace('-', '').lower()
    if not compact_id:
        raise ValueError('Cannot disambiguate a slug without a location id.')
    return f'{slug}-{compact_id}'


def resolved_slug_entries(slug: str, identifiers) -> list[tuple[str, str]]:
    """Keep one stable winner on the original slug and rewrite only collision losers."""
    ordered = sorted({str(identifier) for identifier in identifiers if str(identifier)})
    if not ordered:
        return []
    entries = [(str(slug), ordered[0])]
    entries.extend((disambiguated_slug(str(slug), identifier), identifier) for identifier in ordered[1:])
    return entries


def apply_slug_override(document: dict, overrides: dict[str, str]) -> dict:
    identifier = str(document.get('id') or '')
    replacement = overrides.get(identifier)
    if replacement:
        document['slug'] = replacement
    return document


class ZstdPartitionSpool:
    """Append NDJSON to many partitions with bounded RAM and compressed on-disk frames."""

    def __init__(self, root: Path, *, buffer_bytes: int, max_buffers: int | None):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.buffer_bytes = max(4096, int(buffer_bytes))
        self.max_buffers = max_buffers
        self.buffers: OrderedDict[str, bytearray] = OrderedDict()
        self.compressor = zstd.ZstdCompressor(level=3)

    def _path(self, partition: str) -> Path:
        return self.root / f'{partition}.ndjson.zst'

    def _flush(self, partition: str) -> None:
        buffer = self.buffers.pop(partition, None)
        if not buffer:
            return
        frame = self.compressor.compress(bytes(buffer))
        with self._path(partition).open('ab') as handle:
            handle.write(frame)

    def write(self, partition: str, line: bytes) -> None:
        buffer = self.buffers.pop(partition, None)
        if buffer is None:
            if self.max_buffers and len(self.buffers) >= self.max_buffers:
                oldest = next(iter(self.buffers))
                self._flush(oldest)
            buffer = bytearray()
        buffer.extend(line)
        if not line.endswith(b'\n'):
            buffer.extend(b'\n')
        if len(buffer) >= self.buffer_bytes:
            self.buffers[partition] = buffer
            self._flush(partition)
        else:
            self.buffers[partition] = buffer

    def close(self) -> None:
        for partition in list(self.buffers):
            self._flush(partition)

    def paths(self):
        self.close()
        yield from sorted(self.root.glob('*.ndjson.zst'))

    @staticmethod
    def partition(path: Path) -> str:
        return path.name.removesuffix('.ndjson.zst')

    @staticmethod
    def lines(path: Path):
        decoder = zstd.ZstdDecompressor()
        with path.open('rb') as source, decoder.stream_reader(source) as reader:
            pending = bytearray()
            while True:
                chunk = reader.read(1024 * 1024)
                if not chunk:
                    break
                pending.extend(chunk)
                while True:
                    newline = pending.find(b'\n')
                    if newline < 0:
                        break
                    line = bytes(pending[:newline])
                    del pending[:newline + 1]
                    if line:
                        yield line
            if pending:
                yield bytes(pending)


class ArtifactWriter:
    def __init__(self, s3, bucket: str, prefix: str, hashes_path: Path):
        self.s3 = s3
        self.bucket = bucket
        self.prefix = prefix.rstrip('/')
        self.hashes_path = hashes_path
        self.hashes_handle = hashes_path.open('wb')
        self.count = 0
        self.compressed_bytes = 0

    def key(self, relative: str) -> str:
        return f'{self.prefix}/{relative.lstrip("/")}'

    def put_bytes(self, relative: str, body: bytes, *, uncompressed_bytes: int, count: int | None, kind: str, content_type: str = 'application/json') -> dict:
        key = self.key(relative)
        digest = sha256_hex(body)
        self.s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
            CacheControl='public,max-age=31536000,immutable',
            Metadata={'sha256': digest},
        )
        record = {
            'key': key,
            'sha256': digest,
            'compressed_bytes': len(body),
            'uncompressed_bytes': int(uncompressed_bytes),
            'kind': kind,
        }
        if count is not None:
            record['count'] = int(count)
        self.hashes_handle.write(orjson.dumps(record) + b'\n')
        self.count += 1
        self.compressed_bytes += len(body)
        return record

    def put_json(self, relative: str, value, *, count: int | None, kind: str, quality: int = 5) -> dict:
        raw = orjson.dumps(value)
        body = brotli.compress(raw, quality=quality, mode=brotli.MODE_TEXT)
        return self.put_bytes(relative, body, uncompressed_bytes=len(raw), count=count, kind=kind)

    def close(self) -> None:
        if not self.hashes_handle.closed:
            self.hashes_handle.flush()
            self.hashes_handle.close()


def minimal_longitude_bounds(longitudes: list[float]) -> tuple[float, float]:
    west = min(longitudes)
    east = max(longitudes)
    if east - west <= 180:
        return west, east
    shifted = [value if value >= 0 else value + 360 for value in longitudes]
    west_shifted = min(shifted)
    east_shifted = max(shifted)
    wrap = lambda value: value - 360 if value > 180 else value
    return wrap(west_shifted), wrap(east_shifted)


def cell_bounds(cell: str) -> dict:
    boundary = h3.cell_to_boundary(cell)
    latitudes = [float(item[0]) for item in boundary]
    longitudes = [float(item[1]) for item in boundary]
    west, east = minimal_longitude_bounds(longitudes)
    return {'north': max(latitudes), 'south': min(latitudes), 'east': east, 'west': west}


def longitude_ranges(west: float, east: float):
    return [(west, east)] if west <= east else [(west, 180.0), (-180.0, east)]


def directory_tiles(bounds: dict, degrees: float):
    lat_count = int(math.ceil(180 / degrees))
    lon_count = int(math.ceil(360 / degrees))
    south = max(0, min(lat_count - 1, int(math.floor((max(-90, bounds['south']) + 90) / degrees))))
    north_value = min(89.999999, bounds['north'])
    north = max(0, min(lat_count - 1, int(math.floor((north_value + 90) / degrees))))
    for west, east in longitude_ranges(bounds['west'], bounds['east']):
        west_index = max(0, min(lon_count - 1, int(math.floor((west + 180) / degrees))))
        east_value = min(179.999999, east)
        east_index = max(0, min(lon_count - 1, int(math.floor((east_value + 180) / degrees))))
        for lat_index in range(south, north + 1):
            for lon_index in range(west_index, east_index + 1):
                yield f'{lat_index}-{lon_index}'


def point_tile(latitude: float, longitude: float, degrees: float) -> tuple[int, int]:
    lat_count = int(math.ceil(180 / degrees))
    lon_count = int(math.ceil(360 / degrees))
    lat_index = max(0, min(lat_count - 1, int(math.floor((latitude + 90) / degrees))))
    lon_index = max(0, min(lon_count - 1, int(math.floor((longitude + 180) / degrees))))
    return lat_index, lon_index


def prominence(document: dict) -> float:
    return (
        (100.0 if document.get('primary_photo', {}).get('content_hash') else 0.0)
        + 10.0 * max(0.0, float(document.get('quality_score') or 0))
        + max(0.0, float(document.get('popularity_score') or 0))
    )


def push_top(heap: list, document: dict, limit: int) -> None:
    score = prominence(document)
    tie = str(document.get('id') or '')
    item = (score, tie, document)
    if len(heap) < limit:
        heapq.heappush(heap, item)
    elif (score, tie) > (heap[0][0], heap[0][1]):
        heapq.heapreplace(heap, item)


def sorted_heap_documents(heap: list) -> list[dict]:
    return [item[2] for item in sorted(heap, key=lambda item: (-item[0], item[1]))]


def brotli_json(value, quality: int = 5) -> tuple[bytes, int]:
    raw = orjson.dumps(value)
    return brotli.compress(raw, quality=quality, mode=brotli.MODE_TEXT), len(raw)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', default=os.getenv('GLOBAL_LOCATION_SNAPSHOT', datetime.now(timezone.utc).date().isoformat()))
    parser.add_argument('--root-resolution', type=int, default=int(os.getenv('GLOBAL_LOCATION_H3_ROOT_RESOLUTION', '5')))
    parser.add_argument('--max-resolution', type=int, default=int(os.getenv('GLOBAL_LOCATION_H3_MAX_RESOLUTION', '10')))
    parser.add_argument('--target-candidates', type=int, default=int(os.getenv('GLOBAL_LOCATION_SHARD_TARGET_CANDIDATES', '6000')))
    parser.add_argument('--hard-candidates', type=int, default=int(os.getenv('GLOBAL_LOCATION_SHARD_HARD_CANDIDATES', '20000')))
    parser.add_argument('--target-compressed-bytes', type=int, default=int(os.getenv('GLOBAL_LOCATION_SHARD_TARGET_BYTES', str(768 * 1024))))
    parser.add_argument('--hard-compressed-bytes', type=int, default=int(os.getenv('GLOBAL_LOCATION_SHARD_HARD_BYTES', str(2 * 1024 * 1024))))
    parser.add_argument('--directory-degrees', type=float, default=float(os.getenv('GLOBAL_LOCATION_DIRECTORY_DEGREES', '1')))
    parser.add_argument('--batch-size', type=int, default=int(os.getenv('GLOBAL_LOCATION_BUILD_BATCH_SIZE', '10000')))
    parser.add_argument('--work-dir', default=os.getenv('GLOBAL_LOCATION_SEARCH_WORK_DIR', ''))
    args = parser.parse_args()

    root_resolution = positive_int(args.root_resolution, 0, 14)
    max_resolution = positive_int(args.max_resolution, root_resolution, 15)
    target_candidates = positive_int(args.target_candidates, 500, 20000)
    hard_candidates = positive_int(args.hard_candidates, target_candidates, 100000)
    target_bytes = positive_int(args.target_compressed_bytes, 256 * 1024, 2 * 1024 * 1024)
    hard_bytes = positive_int(args.hard_compressed_bytes, target_bytes, 8 * 1024 * 1024)
    directory_degrees = max(0.25, min(5.0, float(args.directory_degrees)))
    batch_size = positive_int(args.batch_size, 1000, 50000)

    source = b2_source_config()
    prefix = f'{source.data_prefix}/search/schema=v1/snapshot={args.snapshot}'
    work_root = Path(args.work_dir) if args.work_dir else Path(tempfile.mkdtemp(prefix='puddle-b2-search-'))
    remove_work_root = not args.work_dir
    work_root.mkdir(parents=True, exist_ok=True)
    print(f'work_dir={work_root}', flush=True)

    s3 = boto3.client(
        's3',
        endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id,
        aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(retries={'max_attempts': 10, 'mode': 'adaptive'}, max_pool_connections=32),
    )
    hashes_path = work_root / 'hashes.ndjson'
    writer = ArtifactWriter(s3, source.bucket, prefix, hashes_path)
    con = duckdb.connect()
    configure_duckdb(con, source, int(os.getenv('GLOBAL_LOCATION_BUILD_THREADS', '8')))
    if os.getenv('DUCKDB_TEMP_DIRECTORY'):
        escaped_temp = os.getenv('DUCKDB_TEMP_DIRECTORY').replace("'", "''")
        con.execute(f"SET temp_directory='{escaped_temp}'")
    create_canonical_views(con, args.snapshot, source)

    stats = {
        'location_count': 0,
        'published_count': 0,
        'geo_location_count': 0,
        'slug_collision_groups': 0,
        'slug_collision_rewrites': 0,
        'id_shards': 0,
        'slug_shards': 0,
        'geo_shards': 0,
        'routing_shards': 0,
        'geo_map_z0_shards': 0,
        'geo_map_z1_shards': 0,
    }

    # Phase 1: external hash partition by ID and lightweight slug references.
    id_spool_root = work_root / 'id-spool'
    id_spool = ZstdPartitionSpool(id_spool_root, buffer_bytes=64 * 1024, max_buffers=None)
    raw_slug_spool_root = work_root / 'slug-raw-spool'
    raw_slug_spool = ZstdPartitionSpool(raw_slug_spool_root, buffer_bytes=32 * 1024, max_buffers=None)
    query = canonical_query(con)
    columns = canonical_columns(query)
    while True:
        rows = query.fetchmany(batch_size)
        if not rows:
            break
        for values in rows:
            document = document_from_values(columns, values)
            identifier = str(document.get('id') or '')
            if not identifier:
                raise RuntimeError('Canonical search document is missing id.')
            if str(document.get('status') or '') == 'published':
                stats['published_count'] += 1
                if not finite_coordinate(document.get('latitude'), -90, 90) or not finite_coordinate(document.get('longitude'), -180, 180):
                    raise RuntimeError(f'Published location {identifier} has invalid coordinates.')
            id_spool.write(hash_bucket(identifier), orjson.dumps(document))
            slug = str(document.get('slug') or '').strip()
            if slug:
                raw_slug_spool.write(hash_bucket(slug), orjson.dumps([slug, identifier]))
            stats['location_count'] += 1
        print(f"hydration_spooled={stats['location_count']}", flush=True)
    id_spool.close()
    raw_slug_spool.close()
    if stats['location_count'] <= 0:
        raise RuntimeError('Canonical snapshot produced no search documents.')

    # Resolve collisions before emitting any document-bearing shard. Only collision losers
    # are retained in memory, so memory is O(number of collisions), not O(location_count).
    slug_overrides: dict[str, str] = {}
    final_slug_spool_root = work_root / 'slug-final-spool'
    final_slug_spool = ZstdPartitionSpool(final_slug_spool_root, buffer_bytes=32 * 1024, max_buffers=None)
    for path in raw_slug_spool.paths():
        groups: dict[str, set[str]] = {}
        for line in raw_slug_spool.lines(path):
            slug, identifier = orjson.loads(line)
            groups.setdefault(str(slug), set()).add(str(identifier))
        for slug, identifiers in groups.items():
            entries = resolved_slug_entries(slug, identifiers)
            if len(entries) > 1:
                stats['slug_collision_groups'] += 1
                stats['slug_collision_rewrites'] += len(entries) - 1
                print(f'slug_collision={slug!r} ids={sorted(identifiers)}', flush=True)
            for resolved_slug, identifier in entries:
                if resolved_slug != slug:
                    slug_overrides[identifier] = resolved_slug
                final_slug_spool.write(hash_bucket(resolved_slug), orjson.dumps([resolved_slug, identifier]))
        path.unlink()
    shutil.rmtree(raw_slug_spool_root, ignore_errors=True)
    final_slug_spool.close()

    # Emit hydration shards after collision resolution so ID documents expose the same slug
    # as slug lookup and geo search documents.
    for path in id_spool.paths():
        bucket = id_spool.partition(path)
        values: dict[str, dict] = {}
        for line in id_spool.lines(path):
            document = apply_slug_override(orjson.loads(line), slug_overrides)
            identifier = str(document['id'])
            if identifier in values:
                raise RuntimeError(f'Duplicate canonical location id {identifier}.')
            values[identifier] = document
        writer.put_json(f'id/{bucket}.json.br', values, count=len(values), kind='id')
        stats['id_shards'] += 1
        path.unlink()
    shutil.rmtree(id_spool_root, ignore_errors=True)

    for path in final_slug_spool.paths():
        bucket = final_slug_spool.partition(path)
        values: dict[str, str] = {}
        for line in final_slug_spool.lines(path):
            slug, identifier = orjson.loads(line)
            existing = values.get(slug)
            if existing and existing != identifier:
                raise RuntimeError(f'Secondary slug collision {slug!r} maps to both {existing} and {identifier}.')
            values[slug] = identifier
        writer.put_json(f'slug/{bucket}.json.br', values, count=len(values), kind='slug')
        stats['slug_shards'] += 1
        path.unlink()
    shutil.rmtree(final_slug_spool_root, ignore_errors=True)

    # Phase 2: re-stream canonical documents once for geography. This halves peak temp-disk usage versus dual full spools.
    geo_spool_root = work_root / 'geo-spool'
    geo_spool = ZstdPartitionSpool(geo_spool_root, buffer_bytes=128 * 1024, max_buffers=2048)
    map_z0: dict[tuple[int, int], list] = {}
    map_z1: dict[tuple[int, int], list] = {}
    query = canonical_query(con)
    columns = canonical_columns(query)
    processed = 0
    while True:
        rows = query.fetchmany(batch_size)
        if not rows:
            break
        for values in rows:
            document = apply_slug_override(document_from_values(columns, values), slug_overrides)
            lat = document.get('latitude')
            lon = document.get('longitude')
            if not finite_coordinate(lat, -90, 90) or not finite_coordinate(lon, -180, 180):
                continue
            lat = float(lat)
            lon = float(lon)
            root_cell = h3.latlng_to_cell(lat, lon, root_resolution)
            geo_spool.write(root_cell, orjson.dumps(document))
            stats['geo_location_count'] += 1
            if str(document.get('status') or '') == 'published':
                key0 = point_tile(lat, lon, 30.0)
                key1 = point_tile(lat, lon, 10.0)
                heap0 = map_z0.setdefault(key0, [])
                heap1 = map_z1.setdefault(key1, [])
                push_top(heap0, document, 200)
                push_top(heap1, document, 200)
            processed += 1
        print(f'geo_spooled={processed}', flush=True)
    geo_spool.close()

    route_spool_root = work_root / 'route-spool'
    route_spool = ZstdPartitionSpool(route_spool_root, buffer_bytes=32 * 1024, max_buffers=2048)

    def emit_leaf(cell: str, documents: list[dict], compressed: bytes | None = None, raw_bytes: int | None = None) -> None:
        nonlocal writer
        if compressed is None:
            compressed, raw_bytes = brotli_json(documents)
        if len(documents) > hard_candidates or len(compressed) > hard_bytes:
            raise RuntimeError(f'Leaf {cell} exceeds hard shard limit at H3 resolution {h3.get_resolution(cell)}.')
        resolution = h3.get_resolution(cell)
        relative = f'geo/r{resolution}/{cell}.json.br'
        record = writer.put_bytes(relative, compressed, uncompressed_bytes=int(raw_bytes or 0), count=len(documents), kind='geo')
        stats['geo_shards'] += 1
        bounds = cell_bounds(cell)
        descriptor = [record['key'], cell, bounds['north'], bounds['south'], bounds['east'], bounds['west'], len(documents), len(compressed)]
        encoded = orjson.dumps(descriptor)
        for tile in directory_tiles(bounds, directory_degrees):
            route_spool.write(tile, encoded)

    def split_or_emit(cell: str, documents: list[dict]) -> None:
        resolution = h3.get_resolution(cell)
        if len(documents) > target_candidates and resolution < max_resolution:
            children: dict[str, list[dict]] = {}
            next_resolution = resolution + 1
            for document in documents:
                child = h3.latlng_to_cell(float(document['latitude']), float(document['longitude']), next_resolution)
                children.setdefault(child, []).append(document)
            for child, child_documents in children.items():
                split_or_emit(child, child_documents)
            return
        compressed, raw_bytes = brotli_json(documents)
        if len(compressed) > target_bytes and resolution < max_resolution:
            children: dict[str, list[dict]] = {}
            next_resolution = resolution + 1
            for document in documents:
                child = h3.latlng_to_cell(float(document['latitude']), float(document['longitude']), next_resolution)
                children.setdefault(child, []).append(document)
            for child, child_documents in children.items():
                split_or_emit(child, child_documents)
            return
        emit_leaf(cell, documents, compressed, raw_bytes)

    for path in geo_spool.paths():
        root_cell = geo_spool.partition(path)
        documents = [orjson.loads(line) for line in geo_spool.lines(path)]
        split_or_emit(root_cell, documents)
        path.unlink()
    shutil.rmtree(geo_spool_root, ignore_errors=True)
    route_spool.close()

    for path in route_spool.paths():
        partition = route_spool.partition(path)
        lat_index, lon_index = partition.split('-', 1)
        descriptors = [orjson.loads(line) for line in route_spool.lines(path)]
        descriptors.sort(key=lambda item: item[0])
        writer.put_json(f'routing/{lat_index}/{lon_index}.json.br', descriptors, count=len(descriptors), kind='routing')
        stats['routing_shards'] += 1
        path.unlink()
    shutil.rmtree(route_spool_root, ignore_errors=True)

    for (lat_index, lon_index), heap in sorted(map_z0.items()):
        documents = sorted_heap_documents(heap)
        writer.put_json(f'geo-map/z0/{lat_index}/{lon_index}.json.br', documents, count=len(documents), kind='geo-map-z0')
        stats['geo_map_z0_shards'] += 1
    for (lat_index, lon_index), heap in sorted(map_z1.items()):
        documents = sorted_heap_documents(heap)
        writer.put_json(f'geo-map/z1/{lat_index}/{lon_index}.json.br', documents, count=len(documents), kind='geo-map-z1')
        stats['geo_map_z1_shards'] += 1

    counts = {
        **stats,
        'schema_version': 1,
        'snapshot': args.snapshot,
        'generated_at': utc_now(),
    }
    writer.put_json('validation/counts.json.br', counts, count=None, kind='validation-counts')
    writer.close()

    # Hash ledger is intentionally outside its own ledger to avoid self-reference.
    hash_lines = [line for line in hashes_path.read_bytes().splitlines() if line]
    hashes_raw = b'[' + b','.join(hash_lines) + b']'
    hashes_body = brotli.compress(hashes_raw, quality=5, mode=brotli.MODE_TEXT)
    hashes_key = f'{prefix}/validation/hashes.json.br'
    hashes_digest = sha256_hex(hashes_body)
    s3.put_object(
        Bucket=source.bucket,
        Key=hashes_key,
        Body=hashes_body,
        ContentType='application/json',
        CacheControl='public,max-age=31536000,immutable',
        Metadata={'sha256': hashes_digest},
    )

    manifest = {
        'schema_version': 1,
        'snapshot': args.snapshot,
        'source_snapshot': args.snapshot,
        'built_at': utc_now(),
        'prefix': prefix,
        'location_count': stats['location_count'],
        'published_count': stats['published_count'],
        'geo_location_count': stats['geo_location_count'],
        'slug_collision_groups': stats['slug_collision_groups'],
        'slug_collision_rewrites': stats['slug_collision_rewrites'],
        'shard_counts': {key: value for key, value in stats.items() if key.endswith('_shards')},
        'geo': {
            'root_resolution': root_resolution,
            'max_resolution': max_resolution,
            'target_candidates': target_candidates,
            'hard_candidates': hard_candidates,
            'target_compressed_bytes': target_bytes,
            'hard_compressed_bytes': hard_bytes,
            'directory': {'tile_degrees': directory_degrees, 'prefix': f'{prefix}/routing'},
        },
        'geo_map': {
            'z0': {'max_zoom_exclusive': 5, 'tile_degrees': 30, 'prefix': f'{prefix}/geo-map/z0'},
            'z1': {'max_zoom_exclusive': 8, 'tile_degrees': 10, 'prefix': f'{prefix}/geo-map/z1'},
        },
        'id': {'bucket_count': HEX_BUCKETS, 'hash': 'sha256-first-3-hex'},
        'slug': {'bucket_count': HEX_BUCKETS, 'hash': 'sha256-first-3-hex', 'value': 'location_id'},
        'validation': {
            'counts_key': f'{prefix}/validation/counts.json.br',
            'hashes_key': hashes_key,
            'hashes_sha256': hashes_digest,
            'artifact_count': len(hash_lines),
        },
    }
    manifest_raw = orjson.dumps(manifest, option=orjson.OPT_INDENT_2) + b'\n'
    manifest_key = f'{prefix}/manifest.json'
    s3.put_object(
        Bucket=source.bucket,
        Key=manifest_key,
        Body=manifest_raw,
        ContentType='application/json',
        CacheControl='public,max-age=31536000,immutable',
        Metadata={'sha256': sha256_hex(manifest_raw)},
    )
    candidate = {
        'schema_version': 1,
        'snapshot': args.snapshot,
        'manifest_key': manifest_key,
        'location_count': stats['location_count'],
        'built_at': manifest['built_at'],
    }
    s3.put_object(
        Bucket=source.bucket,
        Key=f'{source.data_prefix}/search/candidates/{args.snapshot}.json',
        Body=orjson.dumps(candidate, option=orjson.OPT_INDENT_2) + b'\n',
        ContentType='application/json',
        CacheControl='no-store',
    )
    print(orjson.dumps(candidate, option=orjson.OPT_INDENT_2).decode(), flush=True)

    con.close()
    if remove_work_root:
        shutil.rmtree(work_root, ignore_errors=True)


if __name__ == '__main__':
    main()
