#!/usr/bin/env python3
"""Build a bounded B2 query-planner overlay with resumable checkpoints."""
from __future__ import annotations

import argparse
import hashlib
import os
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import boto3
import brotli
import orjson
from botocore.client import Config
from botocore.exceptions import ClientError

from b2_planner_checkpoint import GracefulCheckpointCancel, PlannerCheckpointStore
from b2_planner_overlay_common import (
    DEFAULT_CHECKPOINT_GEO_BATCH,
    DEFAULT_CHECKPOINT_ROUTE_BATCH,
    DEFAULT_TARGET_BYTES,
    DEFAULT_TARGET_CANDIDATES,
    PLANNER_CHECKPOINT_VERSION,
    PLANNER_VERSION,
    directory_tiles,
    document_bounds,
    is_missing,
    record_identity,
    sha256_hex,
    split_documents,
    unique_records,
)
from location_search_common import b2_source_config


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument(
        "--target-candidates",
        type=int,
        default=int(
            os.getenv(
                "GLOBAL_LOCATION_PLANNER_TARGET_CANDIDATES",
                str(DEFAULT_TARGET_CANDIDATES),
            )
        ),
    )
    parser.add_argument(
        "--target-compressed-bytes",
        type=int,
        default=int(
            os.getenv("GLOBAL_LOCATION_PLANNER_TARGET_BYTES", str(DEFAULT_TARGET_BYTES))
        ),
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=int(os.getenv("GLOBAL_LOCATION_PLANNER_WORKERS", "16")),
    )
    parser.add_argument(
        "--checkpoint-geo-batch",
        type=int,
        default=int(
            os.getenv(
                "GLOBAL_LOCATION_PLANNER_CHECKPOINT_GEO_BATCH",
                str(DEFAULT_CHECKPOINT_GEO_BATCH),
            )
        ),
    )
    parser.add_argument(
        "--checkpoint-route-batch",
        type=int,
        default=int(
            os.getenv(
                "GLOBAL_LOCATION_PLANNER_CHECKPOINT_ROUTE_BATCH",
                str(DEFAULT_CHECKPOINT_ROUTE_BATCH),
            )
        ),
    )
    args = parser.parse_args()

    target_candidates = max(500, min(20_000, int(args.target_candidates)))
    target_bytes = max(128 * 1024, min(2 * 1024 * 1024, int(args.target_compressed_bytes)))
    workers = max(1, min(32, int(args.workers)))
    geo_batch_size = max(1, min(128, int(args.checkpoint_geo_batch)))
    route_batch_size = max(1, min(1000, int(args.checkpoint_route_batch)))
    planner_id = f"v{PLANNER_VERSION}-c{target_candidates}-b{target_bytes}"

    source = b2_source_config()
    base_prefix = f"{source.data_prefix}/search/schema=v1/snapshot={args.snapshot}"
    base_manifest_key = f"{base_prefix}/manifest.json"
    planner_manifest_key = f"{base_prefix}/manifest-{planner_id}.json"
    planner_candidate_key = (
        f"{source.data_prefix}/search/candidates/{args.snapshot}-{planner_id}.json"
    )
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
    directory_degrees = float(
        ((base_manifest.get("geo") or {}).get("directory") or {}).get("tile_degrees")
        or 1
    )
    if not 0.25 <= directory_degrees <= 5:
        raise RuntimeError(f"Invalid base routing tile size {directory_degrees}.")

    source_geo_fingerprint = sha256_hex(
        orjson.dumps([record_identity(record) for record in geo_records])
    )
    checkpoint_config = {
        "checkpoint_version": PLANNER_CHECKPOINT_VERSION,
        "planner_id": planner_id,
        "snapshot": args.snapshot,
        "base_manifest_sha256": base_manifest_sha,
        "source_geo_fingerprint": source_geo_fingerprint,
        "source_geo_shards": len(geo_records),
        "target_candidates": target_candidates,
        "target_compressed_bytes": target_bytes,
        "directory_degrees": directory_degrees,
        "geo_batch_size": geo_batch_size,
        "route_batch_size": route_batch_size,
    }
    checkpoint_config_hash = sha256_hex(
        orjson.dumps(checkpoint_config, option=orjson.OPT_SORT_KEYS)
    )[:16]
    checkpoint_root = (
        f"{source.data_prefix}/search/checkpoints/schema=v1/snapshot={args.snapshot}/"
        f"planner-v2/config={checkpoint_config_hash}"
    )
    checkpoint = PlannerCheckpointStore(
        s3=s3,
        bucket=source.bucket,
        root=checkpoint_root,
        config_hash=checkpoint_config_hash,
        planner_id=planner_id,
        snapshot=args.snapshot,
        geo_batch_size=geo_batch_size,
        route_batch_size=route_batch_size,
        total_geo_items=len(geo_records),
    )
    cancel = GracefulCheckpointCancel(checkpoint_root)
    cancel.install()

    routes: dict[tuple[int, int], list] = defaultdict(list)
    active_geo_records: list[dict] = []
    reused_geo_shards = 0
    split_source_geo_shards = 0
    produced_microshards = 0
    source_compressed_bytes = 0
    active_compressed_bytes = 0

    def apply_geo_result(result: dict) -> None:
        nonlocal reused_geo_shards
        nonlocal split_source_geo_shards
        nonlocal produced_microshards
        nonlocal source_compressed_bytes
        nonlocal active_compressed_bytes

        source_compressed_bytes += int(result["source_bytes"])
        if bool(result["reused"]):
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

    def process_geo(record: dict):
        key, expected_size, expected_sha = record_identity(record)
        body = get_bytes(key)
        if len(body) != expected_size or sha256_hex(body) != expected_sha:
            raise RuntimeError(f"Base geo shard integrity mismatch while planning: {key}")
        documents = orjson.loads(brotli.decompress(body))
        if not isinstance(documents, list) or not documents:
            raise RuntimeError(
                f"Base geo shard does not decode to a non-empty list: {key}"
            )
        expected_count = record.get("count")
        if expected_count is not None and int(expected_count) != len(documents):
            raise RuntimeError(f"Base geo shard count mismatch: {key}")

        source_cell = key.rsplit("/", 1)[-1].removesuffix(".json.br")
        tight_bounds = document_bounds(documents)
        if len(documents) <= target_candidates and len(body) <= target_bytes:
            return {
                "source_key": key,
                "source_bytes": len(body),
                "reused": True,
                "records": [record],
                "descriptors": [[
                    key,
                    source_cell,
                    tight_bounds["north"],
                    tight_bounds["south"],
                    tight_bounds["east"],
                    tight_bounds["west"],
                    len(documents),
                    len(body),
                ]],
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
            leaf_key = f"{planner_geo_prefix}/{token}/{index:04d}.json.br"
            leaf_record = put_immutable(
                leaf_key,
                leaf_body,
                kind="geo",
                count=len(leaf_documents),
                uncompressed_bytes=raw_bytes,
            )
            bounds = document_bounds(leaf_documents)
            output_records.append(leaf_record)
            descriptors.append([
                leaf_key,
                f"{label}:{index}",
                bounds["north"],
                bounds["south"],
                bounds["east"],
                bounds["west"],
                len(leaf_documents),
                len(leaf_body),
            ])
        return {
            "source_key": key,
            "source_bytes": len(body),
            "reused": False,
            "records": output_records,
            "descriptors": descriptors,
        }

    state = checkpoint.load_state()
    if state is None:
        state = checkpoint.save_state(
            stage="geo",
            next_geo_index=0,
            next_route_index=0,
            total_route_items=None,
        )
        print(
            f"planner_checkpoint_initialized root={checkpoint_root} "
            f"geo_batch={geo_batch_size} route_batch={route_batch_size}",
            flush=True,
        )
    else:
        print(
            "planner_checkpoint_resumed "
            f"root={checkpoint_root} stage={state.get('stage')} "
            f"geo={state.get('next_geo_index', 0)}/{len(geo_records)} "
            f"route={state.get('next_route_index', 0)}/{state.get('total_route_items')}",
            flush=True,
        )

    stage = str(state.get("stage") or "geo")
    if stage not in {"geo", "routing", "finalize", "complete"}:
        raise RuntimeError(f"Unsupported planner checkpoint stage {stage!r}.")

    routing_plan: list[list] = []

    if stage == "geo":
        next_geo_index = int(state.get("next_geo_index") or 0)
        if not 0 <= next_geo_index <= len(geo_records):
            raise RuntimeError("Planner geo checkpoint cursor is outside the source ledger.")
        if next_geo_index % geo_batch_size and next_geo_index != len(geo_records):
            raise RuntimeError("Planner geo checkpoint cursor is not on a safe batch boundary.")

        restore_start = 0
        while restore_start < next_geo_index:
            restore_end = min(restore_start + geo_batch_size, len(geo_records))
            pack_key = checkpoint.geo_pack_key(restore_start, restore_end)
            pack = checkpoint.get(pack_key)
            if int(pack.get("start", -1)) != restore_start or int(pack.get("end", -1)) != restore_end:
                raise RuntimeError(f"Planner geo checkpoint pack cursor mismatch: {pack_key}")
            results = pack.get("results") or []
            expected_source_keys = [
                str(record["key"]) for record in geo_records[restore_start:restore_end]
            ]
            actual_source_keys = [str(result.get("source_key") or "") for result in results]
            if actual_source_keys != expected_source_keys:
                raise RuntimeError(f"Planner geo checkpoint pack source order mismatch: {pack_key}")
            for result in results:
                apply_geo_result(result)
            restore_start = restore_end
            if restore_start % (geo_batch_size * 10) == 0 or restore_start == next_geo_index:
                print(
                    f"planner_checkpoint_restore stage=geo geo={restore_start}/{next_geo_index}",
                    flush=True,
                )

        with ThreadPoolExecutor(max_workers=workers) as executor:
            start = next_geo_index
            while start < len(geo_records):
                end = min(start + geo_batch_size, len(geo_records))
                futures = [
                    executor.submit(process_geo, record) for record in geo_records[start:end]
                ]
                results = [future.result() for future in as_completed(futures)]
                results.sort(key=lambda item: str(item["source_key"]))
                checkpoint.put_immutable(
                    checkpoint.geo_pack_key(start, end),
                    {"start": start, "end": end, "results": results},
                )
                for result in results:
                    apply_geo_result(result)
                start = end
                state = checkpoint.save_state(
                    stage="geo",
                    next_geo_index=start,
                    next_route_index=0,
                    total_route_items=None,
                )
                print(
                    "planner_checkpoint_saved stage=geo "
                    f"geo={start}/{len(geo_records)} reused={reused_geo_shards} "
                    f"split_sources={split_source_geo_shards} active_geo={len(active_geo_records)}",
                    flush=True,
                )
                cancel.exit_if_requested("geo", start, len(geo_records))

        active_geo_records.sort(key=lambda record: str(record["key"]))
        for (lat_index, lon_index), descriptors in sorted(routes.items()):
            descriptors.sort(key=lambda item: str(item[0]))
            routing_plan.append([lat_index, lon_index, descriptors])
        checkpoint.put_immutable(
            checkpoint.geo_summary_key,
            {
                "active_geo_records": active_geo_records,
                "routing_plan": routing_plan,
                "reused_geo_shards": reused_geo_shards,
                "split_source_geo_shards": split_source_geo_shards,
                "produced_microshards": produced_microshards,
                "source_compressed_bytes": source_compressed_bytes,
                "active_compressed_bytes": active_compressed_bytes,
            },
        )
        state = checkpoint.save_state(
            stage="routing",
            next_geo_index=len(geo_records),
            next_route_index=0,
            total_route_items=len(routing_plan),
        )
        stage = "routing"
        print(
            f"planner_checkpoint_saved stage=routing geo={len(geo_records)}/{len(geo_records)} "
            f"route=0/{len(routing_plan)}",
            flush=True,
        )
        cancel.exit_if_requested("routing", 0, len(routing_plan))
    else:
        geo_summary = checkpoint.get(checkpoint.geo_summary_key)
        active_geo_records = list(geo_summary.get("active_geo_records") or [])
        routing_plan = list(geo_summary.get("routing_plan") or [])
        reused_geo_shards = int(geo_summary.get("reused_geo_shards") or 0)
        split_source_geo_shards = int(geo_summary.get("split_source_geo_shards") or 0)
        produced_microshards = int(geo_summary.get("produced_microshards") or 0)
        source_compressed_bytes = int(geo_summary.get("source_compressed_bytes") or 0)
        active_compressed_bytes = int(geo_summary.get("active_compressed_bytes") or 0)
        if not active_geo_records or not routing_plan:
            raise RuntimeError("Planner geo summary checkpoint is empty or invalid.")
        print(
            f"planner_checkpoint_restore stage={stage} geo_summary=true "
            f"active_geo={len(active_geo_records)} routes={len(routing_plan)}",
            flush=True,
        )

    route_records: list[dict] = []

    if stage == "routing":
        next_route_index = int(state.get("next_route_index") or 0)
        if not 0 <= next_route_index <= len(routing_plan):
            raise RuntimeError("Planner routing checkpoint cursor is outside the route plan.")
        if next_route_index % route_batch_size and next_route_index != len(routing_plan):
            raise RuntimeError("Planner routing checkpoint cursor is not on a safe batch boundary.")

        restore_start = 0
        while restore_start < next_route_index:
            restore_end = min(restore_start + route_batch_size, len(routing_plan))
            pack_key = checkpoint.route_pack_key(restore_start, restore_end)
            pack = checkpoint.get(pack_key)
            if int(pack.get("start", -1)) != restore_start or int(pack.get("end", -1)) != restore_end:
                raise RuntimeError(f"Planner routing checkpoint pack cursor mismatch: {pack_key}")
            records = pack.get("records") or []
            expected_route_keys = [
                f"{planner_route_prefix}/{lat_index}/{lon_index}.json.br"
                for lat_index, lon_index, _descriptors in routing_plan[restore_start:restore_end]
            ]
            actual_route_keys = [str(record.get("key") or "") for record in records]
            if actual_route_keys != expected_route_keys:
                raise RuntimeError(f"Planner routing checkpoint pack order mismatch: {pack_key}")
            route_records.extend(records)
            restore_start = restore_end
            if restore_start % (route_batch_size * 10) == 0 or restore_start == next_route_index:
                print(
                    f"planner_checkpoint_restore stage=routing route={restore_start}/{next_route_index}",
                    flush=True,
                )

        start = next_route_index
        while start < len(routing_plan):
            end = min(start + route_batch_size, len(routing_plan))
            batch_records: list[dict] = []
            for lat_index, lon_index, descriptors in routing_plan[start:end]:
                raw = orjson.dumps(descriptors)
                body = brotli.compress(raw, quality=5, mode=brotli.MODE_TEXT)
                key = f"{planner_route_prefix}/{lat_index}/{lon_index}.json.br"
                batch_records.append(
                    put_immutable(
                        key,
                        body,
                        kind="routing",
                        count=len(descriptors),
                        uncompressed_bytes=len(raw),
                    )
                )
            checkpoint.put_immutable(
                checkpoint.route_pack_key(start, end),
                {"start": start, "end": end, "records": batch_records},
            )
            route_records.extend(batch_records)
            start = end
            state = checkpoint.save_state(
                stage="routing",
                next_geo_index=len(geo_records),
                next_route_index=start,
                total_route_items=len(routing_plan),
            )
            print(
                f"planner_checkpoint_saved stage=routing route={start}/{len(routing_plan)}",
                flush=True,
            )
            cancel.exit_if_requested("routing", start, len(routing_plan))

        route_records.sort(key=lambda record: str(record["key"]))
        checkpoint.put_immutable(
            checkpoint.route_summary_key,
            {"route_records": route_records},
        )
        state = checkpoint.save_state(
            stage="finalize",
            next_geo_index=len(geo_records),
            next_route_index=len(routing_plan),
            total_route_items=len(routing_plan),
        )
        stage = "finalize"
        print(
            f"planner_checkpoint_saved stage=finalize route={len(routing_plan)}/{len(routing_plan)}",
            flush=True,
        )
        cancel.exit_if_requested("finalize", len(routing_plan), len(routing_plan))
    else:
        route_summary = checkpoint.get(checkpoint.route_summary_key)
        route_records = list(route_summary.get("route_records") or [])
        if not route_records:
            raise RuntimeError("Planner route summary checkpoint is empty or invalid.")
        print(
            f"planner_checkpoint_restore stage={stage} route_summary=true "
            f"routing_shards={len(route_records)}",
            flush=True,
        )

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
        "checkpoint_version": PLANNER_CHECKPOINT_VERSION,
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
    checkpoint.save_state(
        stage="complete",
        next_geo_index=len(geo_records),
        next_route_index=len(routing_plan),
        total_route_items=len(routing_plan),
    )

    print(
        "planner_overlay_complete=true "
        f"planner_id={planner_id} source_geo_shards={len(geo_records)} "
        f"active_geo_shards={len(active_geo_records)} routing_shards={len(route_records)} "
        f"manifest_key={planner_manifest_key} candidate_key={planner_candidate_key} "
        f"checkpoint_root={checkpoint_root}",
        flush=True,
    )
    print(orjson.dumps(candidate, option=orjson.OPT_INDENT_2).decode(), flush=True)
    cancel.restore()


if __name__ == "__main__":
    main()
