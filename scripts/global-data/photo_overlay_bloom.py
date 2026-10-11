"""Bounded membership filter sized for a catalogue-wide search, not a single ID."""
import base64
import hashlib
import math

MIN_BITS = 1 << 18
MAX_BITS = 1 << 24
MAX_HASHES = 12
FALSE_POSITIVE_RATE = 1e-6


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
