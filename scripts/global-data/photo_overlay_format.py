"""Bounded photo membership and immutable shard identity shared by the builder."""
import base64
import hashlib
import math

MIN_BITS = 1 << 18
MAX_BITS = 1 << 24
MAX_HASHES = 12
FALSE_POSITIVE_RATE = 1e-6
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


def bloom_parameters(count: int) -> tuple[int, int]:
    size = max(1, count)
    required = math.ceil(-size * math.log(FALSE_POSITIVE_RATE) / math.log(2) ** 2)
    bit_count = min(MAX_BITS, max(MIN_BITS, 1 << (required - 1).bit_length()))
    hash_count = min(MAX_HASHES, max(1, round(bit_count / size * math.log(2))))
    return bit_count, hash_count


def build_bloom(ids: list[str]) -> dict:
    bit_count, hash_count = bloom_parameters(len(ids))
    bits = bytearray(bit_count // 8)
    for identifier in ids:
        digest = hashlib.sha256(identifier.encode()).digest()
        for index in range(hash_count):
            offset = (index * 4) % 29
            bit = int.from_bytes(digest[offset:offset + 4], 'big') % bit_count
            bits[bit >> 3] |= 1 << (bit & 7)
    return {'bit_count': bit_count, 'hash_count': hash_count, 'bits': base64.b64encode(bits).decode('ascii')}
