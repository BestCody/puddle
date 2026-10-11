"""Exact photo membership shared by the builder and runtime reader."""
import base64
import hashlib
import uuid

def build_membership(ids: list[str]) -> dict:
    """Exact presence without per-candidate crypto or metadata shard reads."""
    values = sorted(uuid.UUID(identifier).bytes for identifier in ids)
    if len(set(values)) != len(values):
        raise ValueError('Photo membership IDs must be unique.')
    body = b''.join(values)
    return {'encoding': 'uuid128-sorted', 'ids_base64': base64.b64encode(body).decode('ascii'),
            'sha256': hashlib.sha256(body).hexdigest()}
