#!/usr/bin/env python3
"""Pack a fine-grained B2 planner overlay into fewer physical geo objects.

The source planner keeps small, spatially-tight leaves for routing precision. This
builder groups nearby leaves that came from the same original source shard into
larger physical B2 objects while preserving one routing descriptor per fine leaf.
At runtime descriptors for the same physical object deduplicate by key, so query
fanout falls without reverting to coarse bounding boxes.
"""
from __future__ import annotations

import argparse
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
    PLANNER_CHECKPOINT_VERSION,
    PLANNER_VERSION,
    brotli_json,
    directory_tiles,
    document_bounds,
    is_missing,
    record_identity,
    sha256_hex,
    unique_records,
)
from location_search_common import b2_source_config


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--source-planner-id", default=os.getenv("GLOBAL_LOCATION_SOURCE_PLANNER_ID", "v2-c4000-b524288"))
    parser.add_argument("--planner-id", default=os.getenv("GLOBAL_LOCATION_PLANNER_ID", "v2-pack-c12000-b1572864"))
    parser.add_argument("--target-candidates", type=int, default=int(os.getenv("GLOBAL_LOCATION_PLANNER_TARGET_CANDIDATES", "12000")))
    parser.add_argument("--target-compressed-bytes", type=int, default=int(os.getenv("GLOBAL_LOCATION_PLANNER_TARGET_BYTES", str(1536 * 1024))))
    parser.add_argument("--workers", type=int, default=int(os.getenv("GLOBAL_LOCATION_PLANNER_WORKERS", "16")))
    parser.add_argument("--checkpoint-geo-batch", type=int, default=int(os.getenv("GLOBAL_LOCATION_PLANNER_CHECKPOINT_GEO_BATCH", str(DEFAULT_CHECKPOINT_GEO_BATCH))))
    parser.add_argument("--checkpoint-route-batch", type=int, default=int(os.getenv("GLOBAL_LOCATION_PLANNER_CHECKPOINT_ROUTE_BATCH", str(DEFAULT_CHECKPOINT_ROUTE_BATCH))))
    args = parser.parse_args()

    source_planner_id = str(args.source_planner_id).strip()
    planner_id = str(args.planner_id).strip()
    if not source_planner_id or not planner_id:
        raise RuntimeError("Source and destination planner ids are required.")
    if source_planner_id == planner_id:
        raise RuntimeError("Packed planner id must differ from the source planner id.")

    target_candidates = max(4000, min(20_000, int(args.target_candidates)))
    target_bytes = max(512 * 1024, min(4 * 1024 * 1024, int(args.target_compressed_bytes)))
    workers = max(1, min(32, int(args.workers)))
    geo_batch_size = max(1, min(128, int(args.checkpoint_geo_batch)))
    route_batch_size = max(1, min(1000, int(args.checkpoint_route_batch)))

    source = b2_source_config()
    base_prefix = f"{source.data_prefix}/search/schema=v1/snapshot={args.snapshot}"
    source_manifest_key = f"{base_prefix}/manifest-{source_planner_id}.json"
    planner_manifest_key = f"{base_prefix}/manifest-{planner_id}.json"
    planner_candidate_key = f"{source.data_prefix}/search/candidates/{args.snapshot}-{planner_id}.json"
    planner_geo_prefix = f"{base_prefix}/geo-{planner_id}"
    planner_route_prefix = f"{base_prefix}/routing-{planner_id}"
    planner_counts_key = f"{base_prefix}/validation/counts-{planner_id}.json.br"
    planner_hashes_key = f"{base_prefix}/validation/hashes-{planner_id}.json.br"
    source_micro_prefix = f"{base_prefix}/geo-{source_planner_id}/"

    s3 = boto3.client(
        "s3",
        endpoint_url=source.endpoint_url,
        aws_access_key_id=source.key_id,
        aws_secret_access_key=source.application_key,
        region_name=source.region,
        config=Config(retries={"max_attempts": 10, "mode": "adaptive"}, max_pool_connections=max(32, workers * 2)),
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

    def put_immutable(key: str, body: bytes, *, kind: str, count: int | None, uncompressed_bytes: int, content_type: str = "application/json") -> dict:
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
                raise RuntimeError(f"Immutable packed planner artifact differs: {key}")
            record = {"key": key, "sha256": digest, "compressed_bytes": len(body), "uncompressed_bytes": int(uncompressed_bytes), "kind": kind}
            if count is not None:
                record["count"] = int(count)
            return record

        s3.put_object(Bucket=source.bucket, Key=key, Body=body, ContentType=content_type, CacheControl="public,max-age=31536000,immutable", Metadata={"sha256": digest})
        record = {"key": key, "sha256": digest, "compressed_bytes": len(body), "uncompressed_bytes": int(uncompressed_bytes), "kind": kind}
        if count is not None:
            record["count"] = int(count)
        return record

    source_manifest_body = get_bytes(source_manifest_key)
    source_manifest_sha = sha256_hex(source_manifest_body)
    source_manifest = orjson.loads(source_manifest_body)
    if int(source_manifest.get("schema_version", 0)) != 1:
        raise RuntimeError("Packed planner requires search schema version 1.")
    if str(source_manifest.get("snapshot") or "") != args.snapshot:
        raise RuntimeError("Source planner snapshot mismatch.")
    source_planner = source_manifest.get("planner") or {}
    if str(source_planner.get("id") or "") != source_planner_id:
        raise RuntimeError("Source planner manifest id mismatch.")
    if source_planner.get("tight_document_bounds") is not True:
        raise RuntimeError("Source planner must provide tight document bounds.")

    existing_manifest = get_optional_json(planner_manifest_key)
    if existing_manifest is not None:
        planner = existing_manifest.get("planner") or {}
        if (
            int(planner.get("version", 0)) != PLANNER_VERSION
            or str(planner.get("source_planner_id") or "") != source_planner_id
            or str(planner.get("source_manifest_sha256") or "") != source_manifest_sha
            or int(planner.get("target_candidates", -1)) != target_candidates
            or int(planner.get("target_compressed_bytes", -1)) != target_bytes
            or planner.get("packed_leaf_routing") is not True
        ):
            raise RuntimeError(f"Existing packed planner manifest {planner_manifest_key} does not match requested configuration.")
        candidate = {"schema_version": 1, "snapshot": args.snapshot, "manifest_key": planner_manifest_key, "location_count": int(existing_manifest["location_count"]), "built_at": existing_manifest.get("built_at"), "planner_id": planner_id}
        s3.put_object(Bucket=source.bucket, Key=planner_candidate_key, Body=orjson.dumps(candidate, option=orjson.OPT_INDENT_2) + b"\n", ContentType="application/json", CacheControl="no-store")
        print(f"planner_pack_reused=true planner_id={planner_id} manifest_key={planner_manifest_key}", flush=True)
        print(orjson.dumps(candidate, option=orjson.OPT_INDENT_2).decode(), flush=True)
        return

    validation = source_manifest.get("validation") or {}
    source_hashes_body = get_bytes(str(validation["hashes_key"]))
    if sha256_hex(source_hashes_body) != str(validation.get("hashes_sha256") or ""):
        raise RuntimeError("Source planner hash ledger checksum mismatch.")
    source_records = unique_records(orjson.loads(brotli.decompress(source_hashes_body)))
    source_geo_records = sorted((record for record in source_records if record.get("kind") == "geo"), key=lambda record: str(record["key"]))
    if not source_geo_records:
        raise RuntimeError("Source planner contains no geo shards.")

    shared_records = [record for record in source_records if record.get("kind") not in {"geo", "routing", "validation-counts"}]
    source_counts_body = get_bytes(str(validation["counts_key"]))
    source_counts = orjson.loads(brotli.decompress(source_counts_body))
    directory_degrees = float(((source_manifest.get("geo") or {}).get("directory") or {}).get("tile_degrees") or 1)
    if not 0.25 <= directory_degrees <= 5:
        raise RuntimeError(f"Invalid source routing tile size {directory_degrees}.")

    grouped: dict[str, list[dict]] = defaultdict(list)
    for record in source_geo_records:
        key = str(record["key"])
        if key.startswith(source_micro_prefix):
            token = key[len(source_micro_prefix):].split("/", 1)[0]
            grouped[f"micro:{token}"].append(record)
        else:
            grouped[f"base:{key}"].append(record)
    groups = [(group_id, sorted(records, key=lambda item: str(item["key"]))) for group_id, records in sorted(grouped.items())]

    source_geo_fingerprint = sha256_hex(orjson.dumps([record_identity(record) for record in source_geo_records]))
    checkpoint_config = {
        "checkpoint_version": PLANNER_CHECKPOINT_VERSION,
        "planner_id": planner_id,
        "snapshot": args.snapshot,
        "source_planner_id": source_planner_id,
        "source_manifest_sha256": source_manifest_sha,
        "source_geo_fingerprint": source_geo_fingerprint,
        "source_geo_shards": len(source_geo_records),
        "source_groups": len(groups),
        "target_candidates": target_candidates,
        "target_compressed_bytes": target_bytes,
        "directory_degrees": directory_degrees,
        "geo_batch_size": geo_batch_size,
        "route_batch_size": route_batch_size,
    }
    checkpoint_config_hash = sha256_hex(orjson.dumps(checkpoint_config, option=orjson.OPT_SORT_KEYS))[:16]
    checkpoint_root = f"{source.data_prefix}/search/checkpoints/schema=v1/snapshot={args.snapshot}/planner-pack-v1/config={checkpoint_config_hash}"
    checkpoint = PlannerCheckpointStore(s3=s3, bucket=source.bucket, root=checkpoint_root, config_hash=checkpoint_config_hash, planner_id=planner_id, snapshot=args.snapshot, geo_batch_size=geo_batch_size, route_batch_size=route_batch_size, total_geo_items=len(groups))
    cancel = GracefulCheckpointCancel(checkpoint_root)
    cancel.install()

    routes: dict[tuple[int, int], list] = defaultdict(list)
    active_geo_records: list[dict] = []
    reused_source_objects = 0
    packed_source_groups = 0
    produced_pack_objects = 0
    source_compressed_bytes = 0
    active_compressed_bytes = 0
    routing_leaf_descriptors = 0

    def apply_group_result(result: dict) -> None:
        nonlocal reused_source_objects, packed_source_groups, produced_pack_objects, source_compressed_bytes, active_compressed_bytes, routing_leaf_descriptors
        source_compressed_bytes += int(result["source_bytes"])
        reused_source_objects += int(result.get("reused_objects") or 0)
        packed_source_groups += int(result.get("packed_groups") or 0)
        produced_pack_objects += int(result.get("produced_packs") or 0)
        for record in result["records"]:
            active_geo_records.append(record)
            active_compressed_bytes += int(record["compressed_bytes"])
        for descriptor in result["descriptors"]:
            routing_leaf_descriptors += 1
            bounds = {"north": float(descriptor[2]), "south": float(descriptor[3]), "east": float(descriptor[4]), "west": float(descriptor[5])}
            for tile in directory_tiles(bounds, directory_degrees):
                routes[tile].append(descriptor)

    def process_group(item: tuple[str, list[dict]]) -> dict:
        group_id, records = item
        leaf_infos: list[dict] = []
        total_source_bytes = 0
        for record in records:
            key, expected_size, expected_sha = record_identity(record)
            body = get_bytes(key)
            if len(body) != expected_size or sha256_hex(body) != expected_sha:
                raise RuntimeError(f"Source geo integrity mismatch while packing: {key}")
            documents = orjson.loads(brotli.decompress(body))
            if not isinstance(documents, list) or not documents:
                raise RuntimeError(f"Source geo shard is empty or invalid: {key}")
            expected_count = record.get("count")
            if expected_count is not None and int(expected_count) != len(documents):
                raise RuntimeError(f"Source geo shard count mismatch: {key}")
            leaf_infos.append({"key": key, "record": record, "documents": documents, "bounds": document_bounds(documents)})
            total_source_bytes += len(body)

        if group_id.startswith("base:"):
            if len(leaf_infos) != 1:
                raise RuntimeError(f"Base geo group unexpectedly contains {len(leaf_infos)} objects: {group_id}")
            leaf = leaf_infos[0]
            record = leaf["record"]
            return {
                "group_id": group_id,
                "source_bytes": total_source_bytes,
                "reused_objects": 1,
                "packed_groups": 0,
                "produced_packs": 0,
                "records": [record],
                "descriptors": [[leaf["key"], leaf["key"].rsplit("/", 1)[-1].removesuffix(".json.br"), leaf["bounds"]["north"], leaf["bounds"]["south"], leaf["bounds"]["east"], leaf["bounds"]["west"], int(record.get("count") or len(leaf["documents"])), int(record["compressed_bytes"])]],
            }

        token = group_id.split(":", 1)[1]
        packs: list[list[dict]] = []
        current: list[dict] = []

        def encoded(values: list[dict]):
            documents: list[dict] = []
            for value in values:
                documents.extend(value["documents"])
            return brotli_json(documents)

        for leaf in leaf_infos:
            candidate = current + [leaf]
            ordered, body, _raw_bytes = encoded(candidate)
            if current and (len(ordered) > target_candidates or len(body) > target_bytes):
                packs.append(current)
                current = [leaf]
            else:
                current = candidate
        if current:
            packs.append(current)

        output_records: list[dict] = []
        descriptors: list[list] = []
        for pack_index, pack_leaves in enumerate(packs):
            pack_documents, pack_body, pack_raw_bytes = encoded(pack_leaves)
            if len(pack_documents) > target_candidates or len(pack_body) > target_bytes:
                raise RuntimeError(f"Packed geo object exceeds configured target for {group_id}: candidates={len(pack_documents)} bytes={len(pack_body)}")
            pack_key = f"{planner_geo_prefix}/{token}/{pack_index:04d}.json.br"
            pack_record = put_immutable(pack_key, pack_body, kind="geo", count=len(pack_documents), uncompressed_bytes=pack_raw_bytes)
            output_records.append(pack_record)
            for leaf_index, leaf in enumerate(pack_leaves):
                bounds = leaf["bounds"]
                descriptors.append([pack_key, f"{token}:{pack_index}:{leaf_index}", bounds["north"], bounds["south"], bounds["east"], bounds["west"], len(pack_documents), len(pack_body)])

        return {"group_id": group_id, "source_bytes": total_source_bytes, "reused_objects": 0, "packed_groups": 1, "produced_packs": len(output_records), "records": output_records, "descriptors": descriptors}

    state = checkpoint.load_state()
    if state is None:
        state = checkpoint.save_state(stage="geo", next_geo_index=0, next_route_index=0, total_route_items=None)
        print(f"planner_pack_checkpoint_initialized root={checkpoint_root} groups={len(groups)} geo_batch={geo_batch_size} route_batch={route_batch_size}", flush=True)
    else:
        print(f"planner_pack_checkpoint_resumed root={checkpoint_root} stage={state.get('stage')} groups={state.get('next_geo_index', 0)}/{len(groups)} route={state.get('next_route_index', 0)}/{state.get('total_route_items')}", flush=True)

    stage = str(state.get("stage") or "geo")
    if stage not in {"geo", "routing", "finalize", "complete"}:
        raise RuntimeError(f"Unsupported packed planner checkpoint stage {stage!r}.")

    routing_plan: list[list] = []
    if stage == "geo":
        next_geo_index = int(state.get("next_geo_index") or 0)
        if not 0 <= next_geo_index <= len(groups):
            raise RuntimeError("Packed planner geo checkpoint cursor is outside the group list.")
        if next_geo_index % geo_batch_size and next_geo_index != len(groups):
            raise RuntimeError("Packed planner geo checkpoint cursor is not on a safe batch boundary.")

        restore_start = 0
        while restore_start < next_geo_index:
            restore_end = min(restore_start + geo_batch_size, len(groups))
            pack_key = checkpoint.geo_pack_key(restore_start, restore_end)
            checkpoint_pack = checkpoint.get(pack_key)
            results = checkpoint_pack.get("results") or []
            expected_ids = [group_id for group_id, _records in groups[restore_start:restore_end]]
            actual_ids = [str(result.get("group_id") or "") for result in results]
            if int(checkpoint_pack.get("start", -1)) != restore_start or int(checkpoint_pack.get("end", -1)) != restore_end or actual_ids != expected_ids:
                raise RuntimeError(f"Packed planner checkpoint mismatch: {pack_key}")
            for result in results:
                apply_group_result(result)
            restore_start = restore_end
            if restore_start % (geo_batch_size * 10) == 0 or restore_start == next_geo_index:
                print(f"planner_pack_checkpoint_restore stage=geo groups={restore_start}/{next_geo_index}", flush=True)

        with ThreadPoolExecutor(max_workers=workers) as executor:
            start = next_geo_index
            while start < len(groups):
                end = min(start + geo_batch_size, len(groups))
                futures = [executor.submit(process_group, item) for item in groups[start:end]]
                results = [future.result() for future in as_completed(futures)]
                by_id = {str(result["group_id"]): result for result in results}
                ordered_results = [by_id[group_id] for group_id, _records in groups[start:end]]
                checkpoint.put_immutable(checkpoint.geo_pack_key(start, end), {"start": start, "end": end, "results": ordered_results})
                for result in ordered_results:
                    apply_group_result(result)
                start = end
                state = checkpoint.save_state(stage="geo", next_geo_index=start, next_route_index=0, total_route_items=None)
                print(f"planner_pack_checkpoint_saved stage=geo groups={start}/{len(groups)} active_geo={len(active_geo_records)} packs={produced_pack_objects} reused={reused_source_objects}", flush=True)
                cancel.exit_if_requested("geo", start, len(groups))

        active_geo_records.sort(key=lambda record: str(record["key"]))
        for (lat_index, lon_index), descriptors in sorted(routes.items()):
            descriptors.sort(key=lambda item: (str(item[0]), str(item[1])))
            routing_plan.append([lat_index, lon_index, descriptors])
        checkpoint.put_immutable(checkpoint.geo_summary_key, {"active_geo_records": active_geo_records, "routing_plan": routing_plan, "reused_source_objects": reused_source_objects, "packed_source_groups": packed_source_groups, "produced_pack_objects": produced_pack_objects, "source_compressed_bytes": source_compressed_bytes, "active_compressed_bytes": active_compressed_bytes, "routing_leaf_descriptors": routing_leaf_descriptors})
        state = checkpoint.save_state(stage="routing", next_geo_index=len(groups), next_route_index=0, total_route_items=len(routing_plan))
        stage = "routing"
        print(f"planner_pack_checkpoint_saved stage=routing groups={len(groups)}/{len(groups)} route=0/{len(routing_plan)}", flush=True)
        cancel.exit_if_requested("routing", 0, len(routing_plan))
    else:
        geo_summary = checkpoint.get(checkpoint.geo_summary_key)
        active_geo_records = list(geo_summary.get("active_geo_records") or [])
        routing_plan = list(geo_summary.get("routing_plan") or [])
        reused_source_objects = int(geo_summary.get("reused_source_objects") or 0)
        packed_source_groups = int(geo_summary.get("packed_source_groups") or 0)
        produced_pack_objects = int(geo_summary.get("produced_pack_objects") or 0)
        source_compressed_bytes = int(geo_summary.get("source_compressed_bytes") or 0)
        active_compressed_bytes = int(geo_summary.get("active_compressed_bytes") or 0)
        routing_leaf_descriptors = int(geo_summary.get("routing_leaf_descriptors") or 0)
        if not active_geo_records or not routing_plan:
            raise RuntimeError("Packed planner geo summary checkpoint is empty or invalid.")
        print(f"planner_pack_checkpoint_restore stage={stage} geo_summary=true active_geo={len(active_geo_records)} routes={len(routing_plan)}", flush=True)

    route_records: list[dict] = []
    if stage == "routing":
        next_route_index = int(state.get("next_route_index") or 0)
        if not 0 <= next_route_index <= len(routing_plan):
            raise RuntimeError("Packed planner routing checkpoint cursor is outside the route plan.")
        if next_route_index % route_batch_size and next_route_index != len(routing_plan):
            raise RuntimeError("Packed planner routing checkpoint cursor is not on a safe batch boundary.")

        restore_start = 0
        while restore_start < next_route_index:
            restore_end = min(restore_start + route_batch_size, len(routing_plan))
            pack_key = checkpoint.route_pack_key(restore_start, restore_end)
            checkpoint_pack = checkpoint.get(pack_key)
            records = checkpoint_pack.get("records") or []
            expected_route_keys = [f"{planner_route_prefix}/{lat_index}/{lon_index}.json.br" for lat_index, lon_index, _descriptors in routing_plan[restore_start:restore_end]]
            actual_route_keys = [str(record.get("key") or "") for record in records]
            if int(checkpoint_pack.get("start", -1)) != restore_start or int(checkpoint_pack.get("end", -1)) != restore_end or actual_route_keys != expected_route_keys:
                raise RuntimeError(f"Packed planner routing checkpoint mismatch: {pack_key}")
            route_records.extend(records)
            restore_start = restore_end
            if restore_start % (route_batch_size * 10) == 0 or restore_start == next_route_index:
                print(f"planner_pack_checkpoint_restore stage=routing route={restore_start}/{next_route_index}", flush=True)

        start = next_route_index
        while start < len(routing_plan):
            end = min(start + route_batch_size, len(routing_plan))
            batch_records: list[dict] = []
            for lat_index, lon_index, descriptors in routing_plan[start:end]:
                raw = orjson.dumps(descriptors)
                body = brotli.compress(raw, quality=5, mode=brotli.MODE_TEXT)
                key = f"{planner_route_prefix}/{lat_index}/{lon_index}.json.br"
                batch_records.append(put_immutable(key, body, kind="routing", count=len(descriptors), uncompressed_bytes=len(raw)))
            checkpoint.put_immutable(checkpoint.route_pack_key(start, end), {"start": start, "end": end, "records": batch_records})
            route_records.extend(batch_records)
            start = end
            state = checkpoint.save_state(stage="routing", next_geo_index=len(groups), next_route_index=start, total_route_items=len(routing_plan))
            print(f"planner_pack_checkpoint_saved stage=routing route={start}/{len(routing_plan)}", flush=True)
            cancel.exit_if_requested("routing", start, len(routing_plan))

        route_records.sort(key=lambda record: str(record["key"]))
        checkpoint.put_immutable(checkpoint.route_summary_key, {"route_records": route_records})
        state = checkpoint.save_state(stage="finalize", next_geo_index=len(groups), next_route_index=len(routing_plan), total_route_items=len(routing_plan))
        stage = "finalize"
        print(f"planner_pack_checkpoint_saved stage=finalize route={len(routing_plan)}/{len(routing_plan)}", flush=True)
        cancel.exit_if_requested("finalize", len(routing_plan), len(routing_plan))
    else:
        route_summary = checkpoint.get(checkpoint.route_summary_key)
        route_records = list(route_summary.get("route_records") or [])
        if not route_records:
            raise RuntimeError("Packed planner route summary checkpoint is empty or invalid.")
        print(f"planner_pack_checkpoint_restore stage={stage} route_summary=true routing_shards={len(route_records)}", flush=True)

    counts = dict(source_counts)
    counts["geo_shards"] = len(active_geo_records)
    counts["routing_shards"] = len(route_records)
    counts["planner_version"] = PLANNER_VERSION
    counts["planner_id"] = planner_id
    counts["routing_leaf_descriptors"] = routing_leaf_descriptors
    counts_raw = orjson.dumps(counts)
    counts_body = brotli.compress(counts_raw, quality=5, mode=brotli.MODE_TEXT)
    counts_record = put_immutable(planner_counts_key, counts_body, kind="validation-counts", count=None, uncompressed_bytes=len(counts_raw))

    active_records = unique_records(shared_records + active_geo_records + route_records + [counts_record])
    active_records.sort(key=lambda record: str(record["key"]))
    hashes_raw = orjson.dumps(active_records)
    hashes_body = brotli.compress(hashes_raw, quality=5, mode=brotli.MODE_TEXT)
    hashes_digest = sha256_hex(hashes_body)
    put_immutable(planner_hashes_key, hashes_body, kind="validation-hashes", count=len(active_records), uncompressed_bytes=len(hashes_raw))

    manifest = dict(source_manifest)
    manifest["built_at"] = utc_now()
    manifest["planner"] = {
        "version": PLANNER_VERSION,
        "id": planner_id,
        "source_planner_id": source_planner_id,
        "source_manifest_key": source_manifest_key,
        "source_manifest_sha256": source_manifest_sha,
        "target_candidates": target_candidates,
        "target_compressed_bytes": target_bytes,
        "tight_document_bounds": True,
        "packed_leaf_routing": True,
        "source_geo_shards": len(source_geo_records),
        "source_groups": len(groups),
        "reused_source_objects": reused_source_objects,
        "packed_source_groups": packed_source_groups,
        "active_geo_shards": len(active_geo_records),
        "new_pack_objects": produced_pack_objects,
        "routing_leaf_descriptors": routing_leaf_descriptors,
        "source_geo_compressed_bytes": source_compressed_bytes,
        "active_geo_compressed_bytes": active_compressed_bytes,
        "checkpoint_version": PLANNER_CHECKPOINT_VERSION,
    }
    manifest["shard_counts"] = dict(source_manifest.get("shard_counts") or {})
    manifest["shard_counts"]["geo_shards"] = len(active_geo_records)
    manifest["shard_counts"]["routing_shards"] = len(route_records)
    manifest["geo"] = dict(source_manifest.get("geo") or {})
    manifest["geo"]["directory"] = {"tile_degrees": directory_degrees, "prefix": planner_route_prefix}
    manifest["geo"]["planner_target_candidates"] = target_candidates
    manifest["geo"]["planner_target_compressed_bytes"] = target_bytes
    manifest["geo"]["tight_document_bounds"] = True
    manifest["geo"]["packed_leaf_routing"] = True
    manifest["validation"] = {"counts_key": planner_counts_key, "hashes_key": planner_hashes_key, "hashes_sha256": hashes_digest, "artifact_count": len(active_records)}

    manifest_body = orjson.dumps(manifest, option=orjson.OPT_INDENT_2) + b"\n"
    put_immutable(planner_manifest_key, manifest_body, kind="manifest", count=None, uncompressed_bytes=len(manifest_body), content_type="application/json")

    candidate = {"schema_version": 1, "snapshot": args.snapshot, "manifest_key": planner_manifest_key, "location_count": int(manifest["location_count"]), "built_at": manifest["built_at"], "planner_id": planner_id}
    s3.put_object(Bucket=source.bucket, Key=planner_candidate_key, Body=orjson.dumps(candidate, option=orjson.OPT_INDENT_2) + b"\n", ContentType="application/json", CacheControl="no-store")
    checkpoint.save_state(stage="complete", next_geo_index=len(groups), next_route_index=len(routing_plan), total_route_items=len(routing_plan))
    print(f"planner_pack_complete=true planner_id={planner_id} source_planner_id={source_planner_id} source_geo_shards={len(source_geo_records)} active_geo_shards={len(active_geo_records)} routing_shards={len(route_records)} manifest_key={planner_manifest_key} candidate_key={planner_candidate_key} checkpoint_root={checkpoint_root}", flush=True)
    print(orjson.dumps(candidate, option=orjson.OPT_INDENT_2).decode(), flush=True)
    cancel.restore()


if __name__ == "__main__":
    main()
