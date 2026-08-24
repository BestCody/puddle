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
        self.geo_resume_latest_key = f"{self.root}/geo-resume/latest.json"

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

    def geo_resume_snapshot_key(self, next_geo_index: int) -> str:
        return f"{self.root}/geo-resume/snapshots/{int(next_geo_index):08d}.json.br"

    def save_geo_resume_snapshot(self, payload: dict) -> dict:
        """Persist one materialized geo-stage resume snapshot and atomically publish its pointer."""
        next_geo_index = int(payload.get("next_geo_index") or 0)
        if next_geo_index <= 0 or next_geo_index > self.total_geo_items:
            raise RuntimeError("Geo resume snapshot cursor is outside the group list.")
        if next_geo_index % self.geo_batch_size and next_geo_index != self.total_geo_items:
            raise RuntimeError("Geo resume snapshot cursor is not on a safe batch boundary.")

        body_payload = dict(payload)
        body_payload.update(
            {
                "schema_version": 1,
                "checkpoint_version": PLANNER_CHECKPOINT_VERSION,
                "config_hash": self.config_hash,
                "planner_id": self.planner_id,
                "snapshot": self.snapshot,
                "stage": "geo",
                "next_geo_index": next_geo_index,
                "total_geo_items": self.total_geo_items,
                "geo_batch_size": self.geo_batch_size,
            }
        )
        key = self.geo_resume_snapshot_key(next_geo_index)
        body = self._body(body_payload)
        digest = sha256_hex(body)

        exists = False
        try:
            head = self.s3.head_object(Bucket=self.bucket, Key=key)
        except ClientError as error:
            if not is_missing(error):
                raise
        else:
            exists = True
            actual_size = int(head.get("ContentLength", -1))
            actual_sha = str((head.get("Metadata") or {}).get("sha256", "")).lower()
            if actual_size != len(body) or actual_sha != digest:
                raise RuntimeError(f"Geo resume snapshot differs from existing object {key}.")
        if not exists:
            self.s3.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=body,
                ContentType="application/json",
                ContentEncoding="br",
                CacheControl="no-store",
                Metadata={"sha256": digest},
            )

        pointer = {
            "schema_version": 1,
            "checkpoint_version": PLANNER_CHECKPOINT_VERSION,
            "config_hash": self.config_hash,
            "planner_id": self.planner_id,
            "snapshot": self.snapshot,
            "stage": "geo",
            "next_geo_index": next_geo_index,
            "key": key,
            "sha256": digest,
            "updated_at": utc_now(),
        }
        self.s3.put_object(
            Bucket=self.bucket,
            Key=self.geo_resume_latest_key,
            Body=orjson.dumps(pointer, option=orjson.OPT_INDENT_2) + b"\n",
            ContentType="application/json",
            CacheControl="no-store",
        )
        return pointer

    def load_latest_geo_resume(self, *, max_next_geo_index: int) -> dict | None:
        """Load the newest compatible materialized geo snapshot not ahead of durable state."""
        try:
            pointer = orjson.loads(self._get_bytes(self.geo_resume_latest_key))
        except ClientError as error:
            if is_missing(error):
                return None
            raise

        if int(pointer.get("checkpoint_version", 0)) != PLANNER_CHECKPOINT_VERSION:
            return None
        if str(pointer.get("config_hash") or "") != self.config_hash:
            return None
        if str(pointer.get("planner_id") or "") != self.planner_id:
            return None
        if str(pointer.get("snapshot") or "") != self.snapshot:
            return None
        if str(pointer.get("stage") or "") != "geo":
            return None

        next_geo_index = int(pointer.get("next_geo_index") or 0)
        if next_geo_index <= 0 or next_geo_index > int(max_next_geo_index):
            return None
        if next_geo_index > self.total_geo_items:
            return None
        if next_geo_index % self.geo_batch_size and next_geo_index != self.total_geo_items:
            return None

        key = str(pointer.get("key") or "")
        expected_sha = str(pointer.get("sha256") or "").lower()
        if not key or not expected_sha:
            return None
        body = self._get_bytes(key)
        if sha256_hex(body) != expected_sha:
            raise RuntimeError(f"Geo resume snapshot SHA-256 mismatch for {key}.")
        payload = orjson.loads(brotli.decompress(body))

        if int(payload.get("checkpoint_version", 0)) != PLANNER_CHECKPOINT_VERSION:
            raise RuntimeError("Geo resume snapshot checkpoint version mismatch.")
        if str(payload.get("config_hash") or "") != self.config_hash:
            raise RuntimeError("Geo resume snapshot configuration hash mismatch.")
        if str(payload.get("planner_id") or "") != self.planner_id:
            raise RuntimeError("Geo resume snapshot planner id mismatch.")
        if str(payload.get("snapshot") or "") != self.snapshot:
            raise RuntimeError("Geo resume snapshot source snapshot mismatch.")
        if str(payload.get("stage") or "") != "geo":
            raise RuntimeError("Geo resume snapshot stage mismatch.")
        if int(payload.get("next_geo_index") or -1) != next_geo_index:
            raise RuntimeError("Geo resume snapshot cursor mismatch.")
        return payload


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
