"""Durable B2 checkpoint primitives for planner-overlay builds."""
from __future__ import annotations

import signal
from datetime import datetime, timezone

import brotli
import orjson
from botocore.exceptions import ClientError

from b2_planner_overlay_common import (
    PLANNER_CHECKPOINT_VERSION,
    is_missing,
    sha256_hex,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PlannerCheckpointStore:
    def __init__(
        self,
        *,
        s3,
        bucket: str,
        root: str,
        config_hash: str,
        planner_id: str,
        snapshot: str,
        geo_batch_size: int,
        route_batch_size: int,
        total_geo_items: int,
    ) -> None:
        self.s3 = s3
        self.bucket = bucket
        self.root = root.rstrip("/")
        self.config_hash = config_hash
        self.planner_id = planner_id
        self.snapshot = snapshot
        self.geo_batch_size = geo_batch_size
        self.route_batch_size = route_batch_size
        self.total_geo_items = total_geo_items
        self.state_key = f"{self.root}/state.json"
        self.geo_summary_key = f"{self.root}/geo-summary.json.br"
        self.route_summary_key = f"{self.root}/route-summary.json.br"

    def _get_bytes(self, key: str) -> bytes:
        return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def _body(self, value) -> bytes:
        return brotli.compress(
            orjson.dumps(value, option=orjson.OPT_SORT_KEYS),
            quality=5,
            mode=brotli.MODE_TEXT,
        )

    def put_immutable(self, key: str, value) -> None:
        body = self._body(value)
        digest = sha256_hex(body)
        try:
            head = self.s3.head_object(Bucket=self.bucket, Key=key)
        except ClientError as error:
            if not is_missing(error):
                raise
        else:
            if int(head.get("ContentLength", -1)) != len(body):
                raise RuntimeError(f"Checkpoint length mismatch for existing object {key}.")
            actual_sha = str((head.get("Metadata") or {}).get("sha256", "")).lower()
            if actual_sha != digest:
                raise RuntimeError(f"Checkpoint SHA-256 mismatch for existing object {key}.")
            return
        self.s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType="application/json",
            ContentEncoding="br",
            CacheControl="no-store",
            Metadata={"sha256": digest},
        )

    def get(self, key: str):
        return orjson.loads(brotli.decompress(self._get_bytes(key)))

    def load_state(self) -> dict | None:
        try:
            state = orjson.loads(self._get_bytes(self.state_key))
        except ClientError as error:
            if is_missing(error):
                return None
            raise
        if int(state.get("checkpoint_version", 0)) != PLANNER_CHECKPOINT_VERSION:
            raise RuntimeError("Planner checkpoint version does not match this builder.")
        if str(state.get("config_hash") or "") != self.config_hash:
            raise RuntimeError("Planner checkpoint configuration hash mismatch.")
        if str(state.get("planner_id") or "") != self.planner_id:
            raise RuntimeError("Planner checkpoint planner id mismatch.")
        return state

    def save_state(
        self,
        *,
        stage: str,
        next_geo_index: int,
        next_route_index: int,
        total_route_items: int | None,
    ) -> dict:
        state = {
            "schema_version": 1,
            "checkpoint_version": PLANNER_CHECKPOINT_VERSION,
            "config_hash": self.config_hash,
            "planner_id": self.planner_id,
            "snapshot": self.snapshot,
            "stage": stage,
            "next_geo_index": int(next_geo_index),
            "total_geo_items": self.total_geo_items,
            "next_route_index": int(next_route_index),
            "total_route_items": None if total_route_items is None else int(total_route_items),
            "geo_batch_size": self.geo_batch_size,
            "route_batch_size": self.route_batch_size,
            "updated_at": utc_now(),
        }
        self.s3.put_object(
            Bucket=self.bucket,
            Key=self.state_key,
            Body=orjson.dumps(state, option=orjson.OPT_INDENT_2) + b"\n",
            ContentType="application/json",
            CacheControl="no-store",
        )
        return state

    def geo_pack_key(self, start: int, end: int) -> str:
        return f"{self.root}/geo-packs/{start:08d}-{end:08d}.json.br"

    def route_pack_key(self, start: int, end: int) -> str:
        return f"{self.root}/route-packs/{start:08d}-{end:08d}.json.br"


class GracefulCheckpointCancel:
    def __init__(self, root: str) -> None:
        self.root = root
        self.signal_number: int | None = None
        self.previous_handlers: dict[int, object] = {}

    def install(self) -> None:
        for signum in (signal.SIGINT, signal.SIGTERM):
            self.previous_handlers[signum] = signal.getsignal(signum)
            signal.signal(signum, self._request)

    def _request(self, signum, _frame) -> None:
        if self.signal_number is None:
            self.signal_number = int(signum)
            print(
                f"planner_checkpoint_cancel_requested signal={signum} "
                "finishing_current_safe_batch=true",
                flush=True,
            )

    def exit_if_requested(self, stage: str, cursor: int, total: int) -> None:
        if self.signal_number is None:
            return
        print(
            f"planner_checkpoint_cancel_safe stage={stage} cursor={cursor}/{total} "
            f"root={self.root}",
            flush=True,
        )
        raise SystemExit(128 + self.signal_number)

    def restore(self) -> None:
        for signum, handler in self.previous_handlers.items():
            signal.signal(signum, handler)
