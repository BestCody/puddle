"""Exact photo membership shared by the builder and runtime reader."""
import uuid


def membership_bytes(ids: list[str]) -> bytes:
    """Sorted, unique 16-byte location IDs for exact presence checks.

    Overlay v3 publishes these bytes as their own content-addressed object, so
    the active pointer stays small however many locations have photos.
    """
    values = sorted(uuid.UUID(identifier).bytes for identifier in ids)
    if len(set(values)) != len(values):
        raise ValueError('Photo membership IDs must be unique.')
    return b''.join(values)


def membership_object_key(data_prefix: str, sha256: str) -> str:
    return f'{data_prefix}/search/photo-overlay-v1/membership/{sha256}.uuid128'
