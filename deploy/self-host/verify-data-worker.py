"""Safe, offline import/ABI preflight for the non-root global-data worker."""

import importlib
import sys

if sys.version_info[:2] != (3, 13):
    raise SystemExit("The Puddle data worker requires Python 3.13")

for name in (
    "boto3", "botocore", "brotli", "duckdb", "h3", "mapbox_vector_tile",
    "orjson", "PIL", "urllib3", "zstandard",
):
    importlib.import_module(name)

import duckdb
import h3
from PIL import Image

assert duckdb.sql("select 42").fetchone() == (42,)
assert h3.is_valid_cell(h3.latlng_to_cell(43.65, -79.38, 8))
assert Image.new("RGB", (1, 1)).size == (1, 1)

print("Non-root Python 3.13 global-data worker imports and native libraries passed.")
