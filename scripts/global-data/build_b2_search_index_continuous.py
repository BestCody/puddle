#!/usr/bin/env python3
"""Build the deterministic B2 search snapshot with continuous cancellation-safe checkpoints.

Unlike the coarse phase checkpoint builder, this version commits progress after each
canonical batch, H3 root, map contribution root, and emitted output shard. SIGTERM/SIGINT
request a checkpointed exit at the next safe unit boundary. Checkpoints remain in B2
until the migration workflow's post-success cleanup step removes them.
"""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import tempfile
from pathlib import Path

import boto3
import brotli
import h3
import orjson
import zstandard as zstd
from botocore.client import Config

from build_b2_search_index import (
    ArtifactWriter,
    CHECKPOINT_CONCURRENCY,
    HEX_BUCKETS,
    ZstdPartitionSpool,
    brotli_json,
    cell_bounds,
    delete_prefix,
    directory_tiles,
    finite_coordinate,
    hash_bucket,
    is_missing_object,
    load_json_object,
    point_tile,
    positive_int,
    push_top,
    put_json_object,
    sha256_hex,
    sorted_heap_documents,
    utc_now,
)
from location_search_common import (
    CANONICAL_SQL,
    b2_source_config,
    canonical_columns,
    canonical_query,
    configure_duckdb,
    create_canonical_views,
    document_from_values,
)

CONTINUOUS_CHECKPOINT_VERSION = 1
PACK_MAGIC = b"PUDDLECP1"
FILE_MAGIC = b"PUDDLEFILE1"
_CANCEL_REQUESTED = False


def request_cancel(signum, _frame) -> None:
    global _CANCEL_REQUESTED
    _CANCEL_REQUESTED = True
    print(f"continuous_checkpoint_cancel_requested signal={signum}", flush=True)


def exit_if_cancelled() -> None:
    if _CANCEL_REQUESTED:
        print("continuous_checkpoint_exit_after_durable_save", flush=True)
        raise SystemExit(130)


def canonical_query_after(con, last_id: str):
    if not last_id:
        return canonical_query(con)
    marker = "ORDER BY cast(l.id AS VARCHAR)"
    if CANONICAL_SQL.count(marker) != 1:
        raise RuntimeError("Canonical SQL ordering marker changed; refusing unsafe cursor resume.")
    base = CANONICAL_SQL.rsplit(marker, 1)[0]
    sql = base + "WHERE cast(l.id AS VARCHAR) > ?\n" + marker
    return con.execute(sql, [last_id])


def pack_key(checkpoint_root: str, stream: str, sequence: int) -> str:
    return f"{checkpoint_root}/packs/{stream}/{sequence:08d}.bin"


def file_delta_key(checkpoint_root: str, stream: str, sequence: int) -> str:
    return f"{checkpoint_root}/file-deltas/{stream}/{sequence:08d}.bin"


def map_contribution_key(checkpoint_root: str, index: int) -> str:
    return f"{checkpoint_root}/map-contributions/{index:08d}.json.zst"


def _encode_spool_pack(entries: list[tuple[dict, bytes]]) -> bytes:
    metadata = [entry for entry, _ in entries]
    metadata_raw = orjson.dumps(metadata)
    return PACK_MAGIC + len(metadata_raw).to_bytes(8, "big") + metadata_raw + b"".join(
        payload for _, payload in entries
    )


def _decode_spool_pack(body: bytes) -> tuple[list[dict], bytes]:
    if not body.startswith(PACK_MAGIC) or len(body) < len(PACK_MAGIC) + 8:
        raise RuntimeError("Checkpoint spool pack has an invalid header.")
    start = len(PACK_MAGIC)
    metadata_bytes = int.from_bytes(body[start : start + 8], "big")
    metadata_start = start + 8
    metadata_end = metadata_start + metadata_bytes
    if metadata_end > len(body):
        raise RuntimeError("Checkpoint spool pack metadata is truncated.")
    metadata = orjson.loads(body[metadata_start:metadata_end])
    if not isinstance(metadata, list):
        raise RuntimeError("Checkpoint spool pack metadata is not a list.")
    return metadata, body[metadata_end:]


def snapshot_spool_deltas(
    s3,
    bucket: str,
    checkpoint_root: str,
    stream: str,
    sequence: int,
    spools: dict[str, ZstdPartitionSpool],
    roots: dict[str, Path],
    offsets: dict[str, int],
) -> tuple[int, dict[str, int], int]:
    for spool in spools.values():
        spool.close()

    entries: list[tuple[dict, bytes]] = []
    updated = dict(offsets)
    for label, root in sorted(roots.items()):
        root.mkdir(parents=True, exist_ok=True)
        for path in sorted(root.glob("*.ndjson.zst")):
            logical_name = f"{label}/{path.name}"
            offset = int(offsets.get(logical_name, 0))
            size = path.stat().st_size
            if size < offset:
                raise RuntimeError(
                    f"Checkpoint spool file shrank: {logical_name} size={size} checkpointed={offset}."
                )
            if size == offset:
                continue
            with path.open("rb") as handle:
                handle.seek(offset)
                delta = handle.read()
            if len(delta) != size - offset:
                raise RuntimeError(f"Short read while checkpointing {logical_name}.")
            entries.append(
                (
                    {
                        "name": logical_name,
                        "offset": offset,
                        "length": len(delta),
                        "sha256": sha256_hex(delta),
                    },
                    delta,
                )
            )
            updated[logical_name] = size

    if not entries:
        return sequence, updated, 0

    next_sequence = sequence + 1
    body = _encode_spool_pack(entries)
    s3.put_object(
        Bucket=bucket,
        Key=pack_key(checkpoint_root, stream, next_sequence),
        Body=body,
        ContentType="application/octet-stream",
        CacheControl="no-store",
        Metadata={"sha256": sha256_hex(body)},
    )
    return next_sequence, updated, len(body)


def restore_spool_packs(
    s3,
    bucket: str,
    checkpoint_root: str,
    stream: str,
    count: int,
    roots: dict[str, Path],
) -> dict[str, int]:
    for root in roots.values():
        shutil.rmtree(root, ignore_errors=True)
        root.mkdir(parents=True, exist_ok=True)

    offsets: dict[str, int] = {}
    for sequence in range(1, count + 1):
        response = s3.get_object(
            Bucket=bucket,
            Key=pack_key(checkpoint_root, stream, sequence),
        )
        body = response["Body"].read()
        expected_body_sha = str((response.get("Metadata") or {}).get("sha256") or "").lower()
        if expected_body_sha and sha256_hex(body) != expected_body_sha:
            raise RuntimeError(f"Checkpoint pack checksum mismatch stream={stream} seq={sequence}.")
        metadata, payload = _decode_spool_pack(body)
        cursor = 0
        for entry in metadata:
            logical_name = str(entry["name"])
            if "/" not in logical_name:
                raise RuntimeError(f"Invalid checkpoint logical path {logical_name!r}.")
            label, filename = logical_name.split("/", 1)
            root = roots.get(label)
            if root is None:
                raise RuntimeError(
                    f"Checkpoint pack stream={stream} references unknown root {label!r}."
                )
            length = int(entry["length"])
            offset = int(entry["offset"])
            delta = payload[cursor : cursor + length]
            cursor += length
            if len(delta) != length:
                raise RuntimeError(
                    f"Checkpoint pack payload truncated stream={stream} seq={sequence}."
                )
            if sha256_hex(delta) != str(entry["sha256"]).lower():
                raise RuntimeError(
                    f"Checkpoint delta checksum mismatch stream={stream} seq={sequence}."
                )
            target = root / filename
            current = target.stat().st_size if target.exists() else 0
            if current != offset:
                raise RuntimeError(
                    f"Checkpoint restore offset mismatch {logical_name}: current={current} expected={offset}."
                )
            with target.open("ab") as handle:
                handle.write(delta)
            offsets[logical_name] = offset + length
        if cursor != len(payload):
            raise RuntimeError(
                f"Checkpoint pack has trailing payload stream={stream} seq={sequence}."
            )
        if sequence % 100 == 0 or sequence == count:
            print(f"continuous_checkpoint_restore stream={stream} packs={sequence}/{count}", flush=True)
    return offsets


def snapshot_file_delta(
    s3,
    bucket: str,
    checkpoint_root: str,
    stream: str,
    sequence: int,
    path: Path,
    offset: int,
) -> tuple[int, int]:
    size = path.stat().st_size if path.exists() else 0
    if size < offset:
        raise RuntimeError(f"Checkpoint file shrank stream={stream}: size={size} checkpointed={offset}.")
    if size == offset:
        return sequence, offset
    with path.open("rb") as handle:
        handle.seek(offset)
        delta = handle.read()
    if len(delta) != size - offset:
        raise RuntimeError(f"Short read while checkpointing file stream={stream}.")
    next_sequence = sequence + 1
    body = (
        FILE_MAGIC
        + offset.to_bytes(8, "big")
        + len(delta).to_bytes(8, "big")
        + delta
    )
    s3.put_object(
        Bucket=bucket,
        Key=file_delta_key(checkpoint_root, stream, next_sequence),
        Body=body,
        ContentType="application/octet-stream",
        CacheControl="no-store",
        Metadata={"sha256": sha256_hex(body)},
    )
    return next_sequence, size


def restore_file_deltas(
    s3,
    bucket: str,
    checkpoint_root: str,
    stream: str,
    count: int,
    path: Path,
) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    offset = 0
    for sequence in range(1, count + 1):
        response = s3.get_object(
            Bucket=bucket,
            Key=file_delta_key(checkpoint_root, stream, sequence),
        )
        body = response["Body"].read()
        expected_sha = str((response.get("Metadata") or {}).get("sha256") or "").lower()
        if expected_sha and sha256_hex(body) != expected_sha:
            raise RuntimeError(f"Checkpoint file delta checksum mismatch stream={stream} seq={sequence}.")
        header = len(FILE_MAGIC) + 16
        if not body.startswith(FILE_MAGIC) or len(body) < header:
            raise RuntimeError(f"Invalid checkpoint file delta stream={stream} seq={sequence}.")
        saved_offset = int.from_bytes(
            body[len(FILE_MAGIC) : len(FILE_MAGIC) + 8], "big"
        )
        length = int.from_bytes(
            body[len(FILE_MAGIC) + 8 : header], "big"
        )
        delta = body[header:]
        if saved_offset != offset or len(delta) != length:
            raise RuntimeError(
                f"Checkpoint file delta offset/length mismatch stream={stream} seq={sequence}."
            )
        with path.open("ab") as handle:
            handle.write(delta)
        offset += length
    return offset


def save_state(s3, bucket: str, state_key: str, state: dict) -> None:
    state["updated_at"] = utc_now()
    put_json_object(s3, bucket, state_key, state)


def initial_state(snapshot: str, checkpoint_config: dict) -> dict:
    return {
        "checkpoint_version": CONTINUOUS_CHECKPOINT_VERSION,
        "snapshot": snapshot,
        "config": checkpoint_config,
        "stage": "phase1-scan",
        "phase1_last_id": "",
        "phase1_pack_seq": 0,
        "id_emit_index": 0,
        "slug_emit_index": 0,
        "geo_last_id": "",
        "geo_pack_seq": 0,
        "geo_finalize_index": 0,
        "route_pack_seq": 0,
        "map_scan_index": 0,
        "map_emit_z0_index": 0,
        "map_emit_z1_index": 0,
        "routing_emit_index": 0,
        "hash_seq": 0,
        "counts_emitted": False,
        "stats": {
            "location_count": 0,
            "published_count": 0,
            "geo_location_count": 0,
            "slug_collision_groups": 0,
            "slug_collision_rewrites": 0,
            "id_shards": 0,
            "slug_shards": 0,
            "geo_shards": 0,
            "routing_shards": 0,
            "geo_map_z0_shards": 0,
            "geo_map_z1_shards": 0,
        },
        "created_at": utc_now(),
    }


def put_map_contribution(
    s3,
    bucket: str,
    checkpoint_root: str,
    index: int,
    contribution: list,
) -> None:
    raw = orjson.dumps(contribution)
    body = zstd.ZstdCompressor(level=3).compress(raw)
    s3.put_object(
        Bucket=bucket,
        Key=map_contribution_key(checkpoint_root, index),
        Body=body,
        ContentType="application/zstd",
        CacheControl="no-store",
        Metadata={"sha256": sha256_hex(body)},
    )


def load_map_heaps(s3, bucket: str, checkpoint_root: str, count: int):
    map_z0: dict[tuple[int, int], list] = {}
    map_z1: dict[tuple[int, int], list] = {}
    decoder = zstd.ZstdDecompressor()
    for index in range(1, count + 1):
        response = s3.get_object(
            Bucket=bucket,
            Key=map_contribution_key(checkpoint_root, index),
        )
        body = response["Body"].read()
        expected_sha = str((response.get("Metadata") or {}).get("sha256") or "").lower()
        if expected_sha and sha256_hex(body) != expected_sha:
            raise RuntimeError(f"Map contribution checksum mismatch index={index}.")
        contribution = orjson.loads(decoder.decompress(body))
        for zoom, lat_index, lon_index, documents in contribution:
            target = map_z0 if int(zoom) == 0 else map_z1
            heap = target.setdefault((int(lat_index), int(lon_index)), [])
            for document in documents:
                push_top(heap, document, 200)
        if index % 250 == 0 or index == count:
            print(f"continuous_checkpoint_restore stream=map-contributions roots={index}/{count}", flush=True)
    return map_z0, map_z1


def main() -> None:
    signal.signal(signal.SIGTERM, request_cancel)
    signal.signal(signal.SIGINT, request_cancel)

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--snapshot",
        default=os.getenv("GLOBAL_LOCATION_SNAPSHOT", ""),
        required=not bool(os.getenv("GLOBAL_LOCATION_SNAPSHOT")),
    )
    parser.add_argument(
        "--root-resolution",
        type=int,
        default=int(os.getenv("GLOBAL_LOCATION_H3_ROOT_RESOLUTION", "3")),
    )
    parser.add_argument(
        "--max-resolution",
        type=int,
        default=int(os.getenv("GLOBAL_LOCATION_H3_MAX_RESOLUTION", "10")),
    )
    parser.add_argument(
        "--target-candidates",
        type=int,
        default=int(os.getenv("GLOBAL_LOCATION_SHARD_TARGET_CANDIDATES", "20000")),
    )
    parser.add_argument(
        "--hard-candidates",
        type=int,
        default=int(os.getenv("GLOBAL_LOCATION_SHARD_HARD_CANDIDATES", "20000")),
    )
    parser.add_argument(
        "--target-compressed-bytes",
        type=int,
        default=int(
            os.getenv(
                "GLOBAL_LOCATION_SHARD_TARGET_BYTES",
                str(2 * 1024 * 1024),
            )
        ),
    )
    parser.add_argument(
        "--hard-compressed-bytes",
        type=int,
        default=int(
            os.getenv(
                "GLOBAL_LOCATION_SHARD_HARD_BYTES",
                str(2 * 1024 * 1024),
            )
        ),
    )
    parser.add_argument(
        "--directory-degrees",
        type=float,
        default=float(os.getenv("GLOBAL_LOCATION_DIRECTORY_DEGREES", "1")),
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=int(os.getenv("GLOBAL_LOCATION_BUILD_BATCH_SIZE", "10000")),
    )
    parser.add_argument("--work-dir", default=os.getenv("GLOBAL_LOCATION_SEARCH_WORK_DIR", ""))
    parser.add_argument("--no-resume", action="store_true")
    args = parser.parse_args()

    root_resolution = positive_int(args.root_resolution, 0, 14)
    max_resolution = positive_int(args.max_resolution, root_resolution, 15)
    target_candidates = positive_int(args.target_candidates, 500, 20000)
    hard_candidates = positive_int(args.hard_candidates, target_candidates, 100000)
    target_bytes = positive_int(
        args.target_compressed_bytes,
        256 * 1024,
        2 * 1024 * 1024,
    )
    hard_bytes = positive_int(
        args.hard_compressed_bytes,
        target_bytes,
        8 * 1024 * 1024,
    )
    directory_degrees = max(0.25, min(5.0, float(args.directory_degrees)))
    batch_size = positive_int(args.batch_size, 1000, 50000)

    source = b2_source_config()
    prefix = f"{source.data_prefix}/search/schema=v1/snapshot={args.snapshot}"
    work_root = (
        Path(args.work_dir)
        if args.work_dir
        else Path(tempfile.mkdtemp(prefix="puddle-b2-search-continuous-"))
    )
    remove_work_root = not args.work_dir
    work_root.mkdir(parents=True, exist_ok=True)
    print(f"work_dir={work_root}", flush=True)

    s3 = boto3.client(
        "s3",
        endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id,
        aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(
            retries={"max_attempts": 10, "mode": "adaptive"},
            max_pool_connections=64,
        ),
    )

    checkpoint_config = {
        "continuous_checkpoint_version": CONTINUOUS_CHECKPOINT_VERSION,
        "root_resolution": root_resolution,
        "max_resolution": max_resolution,
        "target_candidates": target_candidates,
        "hard_candidates": hard_candidates,
        "target_compressed_bytes": target_bytes,
        "hard_compressed_bytes": hard_bytes,
        "directory_degrees": directory_degrees,
        "batch_size": batch_size,
    }
    checkpoint_fingerprint = sha256_hex(
        orjson.dumps(checkpoint_config, option=orjson.OPT_SORT_KEYS)
    )[:16]
    checkpoint_snapshot_prefix = (
        f"{source.data_prefix}/search/checkpoints/schema=v1/snapshot={args.snapshot}"
    )
    checkpoint_root = (
        f"{checkpoint_snapshot_prefix}/continuous-v{CONTINUOUS_CHECKPOINT_VERSION}"
        f"/config={checkpoint_fingerprint}"
    )
    state_key = f"{checkpoint_root}/state.json"

    if args.no_resume:
        deleted = delete_prefix(s3, source.bucket, f"{checkpoint_root}/")
        print(f"continuous_checkpoint_reset deleted_objects={deleted}", flush=True)

    state = None if args.no_resume else load_json_object(s3, source.bucket, state_key)
    if state is None:
        state = initial_state(args.snapshot, checkpoint_config)
        save_state(s3, source.bucket, state_key, state)
        print(
            f"continuous_checkpoint_initialized root={checkpoint_root} stage={state['stage']}",
            flush=True,
        )
    else:
        if (
            int(state.get("checkpoint_version", -1))
            != CONTINUOUS_CHECKPOINT_VERSION
            or state.get("snapshot") != args.snapshot
            or state.get("config") != checkpoint_config
        ):
            raise RuntimeError("Continuous checkpoint state does not match requested build.")
        print(
            f"continuous_checkpoint_resumed root={checkpoint_root} stage={state['stage']}",
            flush=True,
        )

    if state.get("stage") == "complete":
        print(
            f"continuous_checkpoint_complete_reuse snapshot={args.snapshot} root={checkpoint_root}",
            flush=True,
        )
        if remove_work_root:
            shutil.rmtree(work_root, ignore_errors=True)
        return

    stats = state["stats"]
    hashes_path = work_root / "hashes.ndjson"
    hash_offset = restore_file_deltas(
        s3,
        source.bucket,
        checkpoint_root,
        "hashes",
        int(state.get("hash_seq", 0)),
        hashes_path,
    )
    writer = ArtifactWriter(
        s3,
        source.bucket,
        prefix,
        hashes_path,
        append=hash_offset > 0,
    )

    id_spool_root = work_root / "id-spool"
    slug_spool_root = work_root / "slug-spool"
    geo_spool_root = work_root / "geo-spool"
    route_spool_root = work_root / "route-spool"

    restored_streams: set[str] = set()
    stream_offsets: dict[str, dict[str, int]] = {}

    def ensure_phase1_spools():
        if "phase1" not in restored_streams:
            stream_offsets["phase1"] = restore_spool_packs(
                s3,
                source.bucket,
                checkpoint_root,
                "phase1",
                int(state.get("phase1_pack_seq", 0)),
                {"id": id_spool_root, "slug": slug_spool_root},
            )
            restored_streams.add("phase1")
        id_spool = ZstdPartitionSpool(
            id_spool_root,
            buffer_bytes=64 * 1024,
            max_buffers=None,
        )
        slug_spool = ZstdPartitionSpool(
            slug_spool_root,
            buffer_bytes=32 * 1024,
            max_buffers=None,
        )
        return id_spool, slug_spool

    def ensure_geo_spool():
        if "geo" not in restored_streams:
            stream_offsets["geo"] = restore_spool_packs(
                s3,
                source.bucket,
                checkpoint_root,
                "geo",
                int(state.get("geo_pack_seq", 0)),
                {"geo": geo_spool_root},
            )
            restored_streams.add("geo")
        return ZstdPartitionSpool(
            geo_spool_root,
            buffer_bytes=128 * 1024,
            max_buffers=2048,
        )

    def ensure_route_spool():
        if "route" not in restored_streams:
            stream_offsets["route"] = restore_spool_packs(
                s3,
                source.bucket,
                checkpoint_root,
                "route",
                int(state.get("route_pack_seq", 0)),
                {"route": route_spool_root},
            )
            restored_streams.add("route")
        return ZstdPartitionSpool(
            route_spool_root,
            buffer_bytes=32 * 1024,
            max_buffers=2048,
        )

    def snapshot_hashes() -> None:
        nonlocal hash_offset
        writer.flush()
        sequence, new_offset = snapshot_file_delta(
            s3,
            source.bucket,
            checkpoint_root,
            "hashes",
            int(state.get("hash_seq", 0)),
            hashes_path,
            hash_offset,
        )
        state["hash_seq"] = sequence
        hash_offset = new_offset

    def open_canonical():
        con = __import__("duckdb").connect()
        configure_duckdb(
            con,
            source,
            int(os.getenv("GLOBAL_LOCATION_BUILD_THREADS", "8")),
        )
        temp_dir = os.getenv("DUCKDB_TEMP_DIRECTORY")
        if temp_dir:
            con.execute(f"SET temp_directory='{temp_dir.replace(chr(39), chr(39) * 2)}'")
        create_canonical_views(con, args.snapshot, source)
        return con

    while True:
        stage = str(state["stage"])

        if stage == "phase1-scan":
            id_spool, slug_spool = ensure_phase1_spools()
            con = open_canonical()
            query = canonical_query_after(con, str(state.get("phase1_last_id") or ""))
            columns = canonical_columns(query)
            while True:
                rows = query.fetchmany(batch_size)
                if not rows:
                    break
                last_id = ""
                for values in rows:
                    document = document_from_values(columns, values)
                    identifier = str(document.get("id") or "")
                    if not identifier:
                        raise RuntimeError("Canonical search document is missing id.")
                    if str(document.get("status") or "") == "published":
                        stats["published_count"] += 1
                        if not finite_coordinate(
                            document.get("latitude"),
                            -90,
                            90,
                        ) or not finite_coordinate(
                            document.get("longitude"),
                            -180,
                            180,
                        ):
                            raise RuntimeError(
                                f"Published location {identifier} has invalid coordinates."
                            )
                    id_spool.write(hash_bucket(identifier), orjson.dumps(document))
                    slug = str(document.get("slug") or "").strip()
                    if slug:
                        slug_spool.write(
                            hash_bucket(slug),
                            orjson.dumps([slug, identifier]),
                        )
                    stats["location_count"] += 1
                    last_id = identifier
                    if _CANCEL_REQUESTED:
                        break

                sequence, offsets, pack_bytes = snapshot_spool_deltas(
                    s3,
                    source.bucket,
                    checkpoint_root,
                    "phase1",
                    int(state.get("phase1_pack_seq", 0)),
                    {"id": id_spool, "slug": slug_spool},
                    {"id": id_spool_root, "slug": slug_spool_root},
                    stream_offsets.get("phase1", {}),
                )
                state["phase1_pack_seq"] = sequence
                stream_offsets["phase1"] = offsets
                if last_id:
                    state["phase1_last_id"] = last_id
                save_state(s3, source.bucket, state_key, state)
                print(
                    f"continuous_checkpoint_saved stage=phase1-scan "
                    f"locations={stats['location_count']} last_id={state['phase1_last_id']} "
                    f"pack_seq={sequence} pack_bytes={pack_bytes}",
                    flush=True,
                )
                exit_if_cancelled()
            con.close()
            if stats["location_count"] <= 0:
                raise RuntimeError("Canonical snapshot produced no search documents.")
            state["stage"] = "id-emit"
            save_state(s3, source.bucket, state_key, state)
            continue

        if stage == "id-emit":
            id_spool, _ = ensure_phase1_spools()
            paths = list(id_spool.paths())
            start = int(state.get("id_emit_index", 0))
            for zero_index in range(start, len(paths)):
                path = paths[zero_index]
                bucket_name = id_spool.partition(path)
                values: dict[str, dict] = {}
                for line in id_spool.lines(path):
                    document = orjson.loads(line)
                    identifier = str(document["id"])
                    if identifier in values:
                        raise RuntimeError(f"Duplicate canonical location id {identifier}.")
                    values[identifier] = document
                writer.put_json(
                    f"id/{bucket_name}.json.br",
                    values,
                    count=len(values),
                    kind="id",
                )
                stats["id_shards"] += 1
                snapshot_hashes()
                state["id_emit_index"] = zero_index + 1
                save_state(s3, source.bucket, state_key, state)
                if (
                    state["id_emit_index"] % 100 == 0
                    or state["id_emit_index"] == len(paths)
                    or _CANCEL_REQUESTED
                ):
                    print(
                        f"continuous_checkpoint_saved stage=id-emit "
                        f"shards={state['id_emit_index']}/{len(paths)}",
                        flush=True,
                    )
                exit_if_cancelled()
            state["stage"] = "slug-emit"
            save_state(s3, source.bucket, state_key, state)
            continue

        if stage == "slug-emit":
            _, slug_spool = ensure_phase1_spools()
            paths = list(slug_spool.paths())
            start = int(state.get("slug_emit_index", 0))
            for zero_index in range(start, len(paths)):
                path = paths[zero_index]
                bucket_name = slug_spool.partition(path)
                values: dict[str, str] = {}
                for line in slug_spool.lines(path):
                    slug, identifier = orjson.loads(line)
                    existing = values.get(str(slug))
                    if existing and existing != str(identifier):
                        raise RuntimeError(
                            f"Secondary slug collision {slug!r} maps to both "
                            f"{existing} and {identifier}."
                        )
                    values[str(slug)] = str(identifier)
                writer.put_json(
                    f"slug/{bucket_name}.json.br",
                    values,
                    count=len(values),
                    kind="slug",
                )
                stats["slug_shards"] += 1
                snapshot_hashes()
                state["slug_emit_index"] = zero_index + 1
                save_state(s3, source.bucket, state_key, state)
                if (
                    state["slug_emit_index"] % 100 == 0
                    or state["slug_emit_index"] == len(paths)
                    or _CANCEL_REQUESTED
                ):
                    print(
                        f"continuous_checkpoint_saved stage=slug-emit "
                        f"shards={state['slug_emit_index']}/{len(paths)}",
                        flush=True,
                    )
                exit_if_cancelled()
            state["stage"] = "geo-scan"
            save_state(s3, source.bucket, state_key, state)
            shutil.rmtree(id_spool_root, ignore_errors=True)
            shutil.rmtree(slug_spool_root, ignore_errors=True)
            continue

        if stage == "geo-scan":
            geo_spool = ensure_geo_spool()
            con = open_canonical()
            query = canonical_query_after(con, str(state.get("geo_last_id") or ""))
            columns = canonical_columns(query)
            while True:
                rows = query.fetchmany(batch_size)
                if not rows:
                    break
                last_id = ""
                processed = 0
                for values in rows:
                    document = document_from_values(columns, values)
                    identifier = str(document.get("id") or "")
                    if not identifier:
                        raise RuntimeError("Canonical search document is missing id.")
                    lat = document.get("latitude")
                    lon = document.get("longitude")
                    if finite_coordinate(lat, -90, 90) and finite_coordinate(lon, -180, 180):
                        root_cell = h3.latlng_to_cell(
                            float(lat),
                            float(lon),
                            root_resolution,
                        )
                        geo_spool.write(root_cell, orjson.dumps(document))
                        stats["geo_location_count"] += 1
                        processed += 1
                    last_id = identifier
                    if _CANCEL_REQUESTED:
                        break

                sequence, offsets, pack_bytes = snapshot_spool_deltas(
                    s3,
                    source.bucket,
                    checkpoint_root,
                    "geo",
                    int(state.get("geo_pack_seq", 0)),
                    {"geo": geo_spool},
                    {"geo": geo_spool_root},
                    stream_offsets.get("geo", {}),
                )
                state["geo_pack_seq"] = sequence
                stream_offsets["geo"] = offsets
                if last_id:
                    state["geo_last_id"] = last_id
                save_state(s3, source.bucket, state_key, state)
                print(
                    f"continuous_checkpoint_saved stage=geo-scan "
                    f"geo_locations={stats['geo_location_count']} "
                    f"batch_geo={processed} last_id={state['geo_last_id']} "
                    f"pack_seq={sequence} pack_bytes={pack_bytes}",
                    flush=True,
                )
                exit_if_cancelled()
            con.close()
            state["stage"] = "geo-finalize"
            save_state(s3, source.bucket, state_key, state)
            continue

        if stage == "geo-finalize":
            geo_spool = ensure_geo_spool()
            route_spool = ensure_route_spool()

            def emit_leaf(
                cell: str,
                documents: list[dict],
                compressed: bytes | None = None,
                raw_bytes: int | None = None,
            ) -> None:
                if compressed is None:
                    compressed, raw_bytes = brotli_json(documents)
                if len(documents) > hard_candidates or len(compressed) > hard_bytes:
                    raise RuntimeError(
                        f"Leaf {cell} exceeds hard shard limit at H3 resolution "
                        f"{h3.get_resolution(cell)}."
                    )
                resolution = h3.get_resolution(cell)
                record = writer.put_bytes(
                    f"geo/r{resolution}/{cell}.json.br",
                    compressed,
                    uncompressed_bytes=int(raw_bytes or 0),
                    count=len(documents),
                    kind="geo",
                )
                stats["geo_shards"] += 1
                bounds = cell_bounds(cell)
                descriptor = [
                    record["key"],
                    cell,
                    bounds["north"],
                    bounds["south"],
                    bounds["east"],
                    bounds["west"],
                    len(documents),
                    len(compressed),
                ]
                encoded = orjson.dumps(descriptor)
                for tile in directory_tiles(bounds, directory_degrees):
                    route_spool.write(tile, encoded)

            def split_or_emit(cell: str, documents: list[dict]) -> None:
                resolution = h3.get_resolution(cell)
                if len(documents) > target_candidates and resolution < max_resolution:
                    children: dict[str, list[dict]] = {}
                    next_resolution = resolution + 1
                    for document in documents:
                        child = h3.latlng_to_cell(
                            float(document["latitude"]),
                            float(document["longitude"]),
                            next_resolution,
                        )
                        children.setdefault(child, []).append(document)
                    for child, child_documents in children.items():
                        split_or_emit(child, child_documents)
                    return
                compressed, raw_bytes = brotli_json(documents)
                if len(compressed) > target_bytes and resolution < max_resolution:
                    children: dict[str, list[dict]] = {}
                    next_resolution = resolution + 1
                    for document in documents:
                        child = h3.latlng_to_cell(
                            float(document["latitude"]),
                            float(document["longitude"]),
                            next_resolution,
                        )
                        children.setdefault(child, []).append(document)
                    for child, child_documents in children.items():
                        split_or_emit(child, child_documents)
                    return
                emit_leaf(cell, documents, compressed, raw_bytes)

            paths = list(geo_spool.paths())
            start = int(state.get("geo_finalize_index", 0))
            for zero_index in range(start, len(paths)):
                path = paths[zero_index]
                root_cell = geo_spool.partition(path)
                documents = [orjson.loads(line) for line in geo_spool.lines(path)]
                split_or_emit(root_cell, documents)
                snapshot_hashes()
                sequence, offsets, pack_bytes = snapshot_spool_deltas(
                    s3,
                    source.bucket,
                    checkpoint_root,
                    "route",
                    int(state.get("route_pack_seq", 0)),
                    {"route": route_spool},
                    {"route": route_spool_root},
                    stream_offsets.get("route", {}),
                )
                state["route_pack_seq"] = sequence
                stream_offsets["route"] = offsets
                state["geo_finalize_index"] = zero_index + 1
                save_state(s3, source.bucket, state_key, state)
                if (
                    state["geo_finalize_index"] % 25 == 0
                    or state["geo_finalize_index"] == len(paths)
                    or _CANCEL_REQUESTED
                ):
                    print(
                        f"continuous_checkpoint_saved stage=geo-finalize "
                        f"roots={state['geo_finalize_index']}/{len(paths)} "
                        f"geo_shards={stats['geo_shards']} route_pack_bytes={pack_bytes}",
                        flush=True,
                    )
                exit_if_cancelled()
            state["stage"] = "map-scan"
            save_state(s3, source.bucket, state_key, state)
            continue

        if stage == "map-scan":
            geo_spool = ensure_geo_spool()
            map_z0, map_z1 = load_map_heaps(
                s3,
                source.bucket,
                checkpoint_root,
                int(state.get("map_scan_index", 0)),
            )
            paths = list(geo_spool.paths())
            start = int(state.get("map_scan_index", 0))
            for zero_index in range(start, len(paths)):
                path = paths[zero_index]
                local_z0: dict[tuple[int, int], list] = {}
                local_z1: dict[tuple[int, int], list] = {}
                for line in geo_spool.lines(path):
                    document = orjson.loads(line)
                    if str(document.get("status") or "") != "published":
                        continue
                    lat = float(document["latitude"])
                    lon = float(document["longitude"])
                    key0 = point_tile(lat, lon, 30.0)
                    key1 = point_tile(lat, lon, 10.0)
                    push_top(local_z0.setdefault(key0, []), document, 200)
                    push_top(local_z1.setdefault(key1, []), document, 200)

                contribution: list = []
                for (lat_index, lon_index), heap in sorted(local_z0.items()):
                    documents = sorted_heap_documents(heap)
                    contribution.append([0, lat_index, lon_index, documents])
                    target = map_z0.setdefault((lat_index, lon_index), [])
                    for document in documents:
                        push_top(target, document, 200)
                for (lat_index, lon_index), heap in sorted(local_z1.items()):
                    documents = sorted_heap_documents(heap)
                    contribution.append([1, lat_index, lon_index, documents])
                    target = map_z1.setdefault((lat_index, lon_index), [])
                    for document in documents:
                        push_top(target, document, 200)

                root_index = zero_index + 1
                put_map_contribution(
                    s3,
                    source.bucket,
                    checkpoint_root,
                    root_index,
                    contribution,
                )
                state["map_scan_index"] = root_index
                save_state(s3, source.bucket, state_key, state)
                if (
                    root_index % 25 == 0
                    or root_index == len(paths)
                    or _CANCEL_REQUESTED
                ):
                    print(
                        f"continuous_checkpoint_saved stage=map-scan "
                        f"roots={root_index}/{len(paths)}",
                        flush=True,
                    )
                exit_if_cancelled()
            state["stage"] = "map-emit-z0"
            save_state(s3, source.bucket, state_key, state)
            continue

        if stage in {"map-emit-z0", "map-emit-z1"}:
            map_z0, map_z1 = load_map_heaps(
                s3,
                source.bucket,
                checkpoint_root,
                int(state.get("map_scan_index", 0)),
            )
            if stage == "map-emit-z0":
                items = sorted(map_z0.items())
                start = int(state.get("map_emit_z0_index", 0))
                for zero_index in range(start, len(items)):
                    (lat_index, lon_index), heap = items[zero_index]
                    documents = sorted_heap_documents(heap)
                    writer.put_json(
                        f"geo-map/z0/{lat_index}/{lon_index}.json.br",
                        documents,
                        count=len(documents),
                        kind="geo-map-z0",
                    )
                    stats["geo_map_z0_shards"] += 1
                    snapshot_hashes()
                    state["map_emit_z0_index"] = zero_index + 1
                    save_state(s3, source.bucket, state_key, state)
                    exit_if_cancelled()
                state["stage"] = "map-emit-z1"
                save_state(s3, source.bucket, state_key, state)
                continue

            items = sorted(map_z1.items())
            start = int(state.get("map_emit_z1_index", 0))
            for zero_index in range(start, len(items)):
                (lat_index, lon_index), heap = items[zero_index]
                documents = sorted_heap_documents(heap)
                writer.put_json(
                    f"geo-map/z1/{lat_index}/{lon_index}.json.br",
                    documents,
                    count=len(documents),
                    kind="geo-map-z1",
                )
                stats["geo_map_z1_shards"] += 1
                snapshot_hashes()
                state["map_emit_z1_index"] = zero_index + 1
                save_state(s3, source.bucket, state_key, state)
                exit_if_cancelled()
            state["stage"] = "routing-emit"
            save_state(s3, source.bucket, state_key, state)
            continue

        if stage == "routing-emit":
            route_spool = ensure_route_spool()
            paths = list(route_spool.paths())
            start = int(state.get("routing_emit_index", 0))
            for zero_index in range(start, len(paths)):
                path = paths[zero_index]
                partition = route_spool.partition(path)
                lat_index, lon_index = partition.split("-", 1)
                descriptors = [orjson.loads(line) for line in route_spool.lines(path)]
                descriptors.sort(key=lambda item: item[0])
                writer.put_json(
                    f"routing/{lat_index}/{lon_index}.json.br",
                    descriptors,
                    count=len(descriptors),
                    kind="routing",
                )
                stats["routing_shards"] += 1
                snapshot_hashes()
                state["routing_emit_index"] = zero_index + 1
                save_state(s3, source.bucket, state_key, state)
                if (
                    state["routing_emit_index"] % 100 == 0
                    or state["routing_emit_index"] == len(paths)
                    or _CANCEL_REQUESTED
                ):
                    print(
                        f"continuous_checkpoint_saved stage=routing-emit "
                        f"shards={state['routing_emit_index']}/{len(paths)}",
                        flush=True,
                    )
                exit_if_cancelled()
            state["stage"] = "finalize"
            save_state(s3, source.bucket, state_key, state)
            continue

        if stage == "finalize":
            if not bool(state.get("counts_emitted")):
                counts = {
                    **stats,
                    "schema_version": 1,
                    "snapshot": args.snapshot,
                    "generated_at": utc_now(),
                }
                writer.put_json(
                    "validation/counts.json.br",
                    counts,
                    count=None,
                    kind="validation-counts",
                )
                snapshot_hashes()
                state["counts_emitted"] = True
                save_state(s3, source.bucket, state_key, state)
                exit_if_cancelled()

            writer.close()
            hash_lines = [line for line in hashes_path.read_bytes().splitlines() if line]
            hashes_raw = b"[" + b",".join(hash_lines) + b"]"
            hashes_body = brotli.compress(
                hashes_raw,
                quality=5,
                mode=brotli.MODE_TEXT,
            )
            hashes_key = f"{prefix}/validation/hashes.json.br"
            hashes_digest = sha256_hex(hashes_body)
            s3.put_object(
                Bucket=source.bucket,
                Key=hashes_key,
                Body=hashes_body,
                ContentType="application/json",
                CacheControl="public,max-age=31536000,immutable",
                Metadata={"sha256": hashes_digest},
            )

            manifest = {
                "schema_version": 1,
                "snapshot": args.snapshot,
                "source_snapshot": args.snapshot,
                "built_at": utc_now(),
                "prefix": prefix,
                "location_count": stats["location_count"],
                "published_count": stats["published_count"],
                "geo_location_count": stats["geo_location_count"],
                "slug_collision_groups": stats["slug_collision_groups"],
                "slug_collision_rewrites": stats["slug_collision_rewrites"],
                "shard_counts": {
                    key: value
                    for key, value in stats.items()
                    if key.endswith("_shards")
                },
                "geo": {
                    "root_resolution": root_resolution,
                    "max_resolution": max_resolution,
                    "target_candidates": target_candidates,
                    "hard_candidates": hard_candidates,
                    "target_compressed_bytes": target_bytes,
                    "hard_compressed_bytes": hard_bytes,
                    "directory": {
                        "tile_degrees": directory_degrees,
                        "prefix": f"{prefix}/routing",
                    },
                },
                "geo_map": {
                    "z0": {
                        "max_zoom_exclusive": 5,
                        "tile_degrees": 30,
                        "prefix": f"{prefix}/geo-map/z0",
                    },
                    "z1": {
                        "max_zoom_exclusive": 8,
                        "tile_degrees": 10,
                        "prefix": f"{prefix}/geo-map/z1",
                    },
                },
                "id": {
                    "bucket_count": HEX_BUCKETS,
                    "hash": "sha256-first-3-hex",
                },
                "slug": {
                    "bucket_count": HEX_BUCKETS,
                    "hash": "sha256-first-3-hex",
                    "value": "location_id",
                },
                "validation": {
                    "counts_key": f"{prefix}/validation/counts.json.br",
                    "hashes_key": hashes_key,
                    "hashes_sha256": hashes_digest,
                    "artifact_count": len(hash_lines),
                },
            }
            manifest_raw = orjson.dumps(
                manifest,
                option=orjson.OPT_INDENT_2,
            ) + b"\n"
            manifest_key = f"{prefix}/manifest.json"
            s3.put_object(
                Bucket=source.bucket,
                Key=manifest_key,
                Body=manifest_raw,
                ContentType="application/json",
                CacheControl="public,max-age=31536000,immutable",
                Metadata={"sha256": sha256_hex(manifest_raw)},
            )
            candidate = {
                "schema_version": 1,
                "snapshot": args.snapshot,
                "manifest_key": manifest_key,
                "location_count": stats["location_count"],
                "built_at": manifest["built_at"],
            }
            s3.put_object(
                Bucket=source.bucket,
                Key=f"{source.data_prefix}/search/candidates/{args.snapshot}.json",
                Body=orjson.dumps(
                    candidate,
                    option=orjson.OPT_INDENT_2,
                ) + b"\n",
                ContentType="application/json",
                CacheControl="no-store",
            )
            state["stage"] = "complete"
            state["completed_at"] = utc_now()
            save_state(s3, source.bucket, state_key, state)
            print(orjson.dumps(candidate, option=orjson.OPT_INDENT_2).decode(), flush=True)
            print(
                f"continuous_checkpoint_retained_until_gate_success root={checkpoint_root}",
                flush=True,
            )
            if remove_work_root:
                shutil.rmtree(work_root, ignore_errors=True)
            return

        raise RuntimeError(f"Unknown continuous checkpoint stage: {stage}")


if __name__ == "__main__":
    main()
