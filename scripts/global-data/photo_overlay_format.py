"""Bounded photo membership and immutable shard identity shared by the builder."""
import base64
import hashlib
import math
import uuid

DEFAULT_BUCKET_COUNT = 4096
MAX_BUCKET_COUNT = 4096


def valid_bucket_count(value: int) -> bool:
    return 2 <= value <= MAX_BUCKET_COUNT and value & (value - 1) == 0


def photo_bucket(identifier: str, bucket_count: int) -> str:
    if not valid_bucket_count(bucket_count):
        raise ValueError('Photo bucket count must be a power of two between 2 and 4096.')
    digest = hashlib.sha256(str(identifier).encode()).digest()
    # Existing small overlays partitioned on the first byte. Larger overlays
    # extend that window without changing the identity of those published keys.
    window = digest[0] if bucket_count <= 256 else int.from_bytes(digest[:2], 'big')
    width = max(2, math.ceil(math.log2(bucket_count) / 4))
    return f'{window & (bucket_count - 1):0{width}x}'


def build_membership(ids: list[str]) -> dict:
    """Exact presence without per-candidate crypto or metadata shard reads."""
    values = sorted(uuid.UUID(identifier).bytes for identifier in ids)
    if len(set(values)) != len(values):
        raise ValueError('Photo membership IDs must be unique.')
    body = b''.join(values)
    return {'encoding': 'uuid128-sorted', 'ids_base64': base64.b64encode(body).decode('ascii'),
            'sha256': hashlib.sha256(body).hexdigest()}
