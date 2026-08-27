#!/usr/bin/env python3
"""Publish the current canonical B2 photo references for runtime search.

Photo materialization writes append-only metadata under the active location
snapshot. The immutable location search snapshot is intentionally not rewritten
for every hourly enrichment pass, so this compact, content-addressed derivative
bridges the two datasets. A no-store pointer is replaced only after the immutable
payload has been uploaded and checked.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import os
import re
from datetime import datetime, timezone

import boto3
import brotli
import duckdb
import orjson
from botocore.client import Config
from botocore.exceptions import ClientError

from location_search_common import b2_source_config, clean_prefix, configure_duckdb, first_env


OVERLAY_VERSION = 1
BLOOM_BITS = 1 << 21
BLOOM_HASHES = 7
SNAPSHOT_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_hex(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def is_missing(error: ClientError) -> bool:
    code = str(error.response.get("Error", {}).get("Code") or "")
    status = int(error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") or 0)
    return code in {"404", "NoSuchKey", "NotFound"} or status == 404


def snapshot_argument(value: str) -> str:
    value = str(value or "").strip()
    if not SNAPSHOT_RE.fullmatch(value):
        raise argparse.ArgumentTypeError("snapshot must be an ISO date (YYYY-MM-DD)")
    return value


def sql_text(value: object) -> str:
    return str(value or "").replace("'", "''")


def list_keys(client, bucket: str, prefix: str) -> list[str]:
    paginator = client.get_paginator("list_objects_v2")
    keys: list[str] = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix.rstrip("/") + "/"):
        keys.extend(
            str(item.get("Key") or "")
            for item in page.get("Contents", [])
            if str(item.get("Key") or "").endswith(".parquet")
        )
    return sorted(keys)


def media_source_config(source):
    """Resolve the media bucket independently from the data bucket.

    Most deployments share one B2 bucket, but the serving path is allowed to
    use a separately scoped media key. The overlay must validate against the
    bucket that actually serves immutable photo bytes.
    """
    endpoint_url = first_env("B2_MEDIA_S3_ENDPOINT", default=source.endpoint_url).rstrip("/")
    return {
        "bucket": first_env("B2_MEDIA_BUCKET_NAME", "B2_DATA_BUCKET_NAME", default=source.bucket),
        "endpoint_url": endpoint_url,
        "key_id": first_env(
            "B2_MEDIA_KEY_ID",
            "B2_MEDIA_APPLICATION_KEY_ID",
            "B2_DATA_KEY_ID",
            "B2_DATA_APPLICATION_KEY_ID",
            default=source.key_id,
        ),
        "application_key": first_env(
            "B2_MEDIA_APPLICATION_KEY",
            "B2_DATA_APPLICATION_KEY",
            default=source.application_key,
        ),
        "region": first_env("B2_MEDIA_S3_REGION", "B2_DATA_S3_REGION", default=source.region),
        "prefix": clean_prefix(first_env("B2_MEDIA_OPEN_PHOTO_PREFIX", default="media/photos/by-sha256")),
    }


def list_canonical_media_hashes(client, bucket: str, prefix: str) -> set[str]:
    """List only content-addressed objects that can be served by open-photo."""
    pattern = re.compile(r"^" + re.escape(prefix) + r"/([0-9a-f]{2})/([0-9a-f]{64})\.jpg$")
    hashes: set[str] = set()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix.rstrip("/") + "/"):
        for item in page.get("Contents", []):
            match = pattern.fullmatch(str(item.get("Key") or ""))
            if match and match.group(1) == match.group(2)[:2]:
                hashes.add(match.group(2))
    return hashes


def columns_for(con, glob: str) -> dict[str, str]:
    try:
        return {
            str(row[0]).lower(): str(row[0])
            for row in con.execute(
                f"DESCRIBE SELECT * FROM read_parquet('{sql_text(glob)}', union_by_name=true, hive_partitioning=true)"
            ).fetchall()
        }
    except Exception:
        return {}


def column(columns: dict[str, str], name: str, sql_type: str) -> str:
    actual = columns.get(name.lower())
    if not actual:
        return f"NULL::{sql_type} AS {name}"
    quoted = '"' + actual.replace('"', '""') + '"'
    return f"cast({quoted} AS {sql_type}) AS {name}"


def add_photo_source(con, glob: str, columns: dict[str, str], source: str) -> bool:
    if not {"location_id", "content_hash"}.issubset(columns):
        return False
    projection = [
        column(columns, "location_id", "VARCHAR"),
        f"lower(trim({column(columns, 'content_hash', 'VARCHAR').removesuffix(' AS content_hash')})) AS content_hash",
        column(columns, "provider", "VARCHAR"),
        column(columns, "attribution", "VARCHAR"),
        column(columns, "attribution_url", "VARCHAR"),
        column(columns, "license", "VARCHAR"),
        column(columns, "width", "INTEGER"),
        column(columns, "height", "INTEGER"),
        column(columns, "verified_at", "VARCHAR"),
        f"'{sql_text(source)}' AS source",
    ]
    con.execute(
        "INSERT INTO photo_rows SELECT "
        + ",".join(projection)
        + f" FROM read_parquet('{sql_text(glob)}', union_by_name=true, hive_partitioning=true)"
    )
    return True


def add_exclusion_source(con, glob: str, columns: dict[str, str]) -> bool:
    if not {"location_id", "content_hash"}.issubset(columns):
        return False
    projection = [
        column(columns, "location_id", "VARCHAR"),
        f"lower(trim({column(columns, 'content_hash', 'VARCHAR').removesuffix(' AS content_hash')})) AS content_hash",
    ]
    con.execute(
        "INSERT INTO photo_exclusions SELECT "
        + ",".join(projection)
        + f" FROM read_parquet('{sql_text(glob)}', union_by_name=true, hive_partitioning=true)"
    )
    return True


def bloom_filter(ids: list[str]) -> str:
    bits = bytearray(BLOOM_BITS // 8)
    for identifier in ids:
        digest = hashlib.sha256(identifier.encode()).digest()
        for index in range(BLOOM_HASHES):
            offset = (index * 4) % 29
            bit = int.from_bytes(digest[offset : offset + 4], "big") % BLOOM_BITS
            bits[bit >> 3] |= 1 << (bit & 7)
    return base64.b64encode(bytes(bits)).decode("ascii")


parser = argparse.ArgumentParser()
parser.add_argument("--snapshot", required=True, type=snapshot_argument)
parser.add_argument("--max-compressed-bytes", type=int, default=int(os.getenv("GLOBAL_LOCATION_PHOTO_OVERLAY_MAX_BYTES", str(12 * 1024 * 1024))))
args = parser.parse_args()

source = b2_source_config()
if args.max_compressed_bytes < 64 * 1024 or args.max_compressed_bytes > 32 * 1024 * 1024:
    raise RuntimeError("--max-compressed-bytes must be between 65536 and 33554432.")

client = boto3.client(
    "s3",
    endpoint_url=source.endpoint_url,
    aws_access_key_id=source.key_id,
    aws_secret_access_key=source.application_key,
    region_name=source.region,
    config=Config(retries={"max_attempts": 10, "mode": "adaptive"}),
)
media = media_source_config(source)
if not media["endpoint_url"] or not media["key_id"] or not media["application_key"] or not media["prefix"]:
    raise RuntimeError("B2 media endpoint, credentials, and photo prefix are required.")
media_client = boto3.client(
    "s3",
    endpoint_url=media["endpoint_url"],
    aws_access_key_id=media["key_id"],
    aws_secret_access_key=media["application_key"],
    region_name=media["region"],
    config=Config(retries={"max_attempts": 10, "mode": "adaptive"}),
)

active_key = f"{source.data_prefix}/search/active.json"
active_body = client.get_object(Bucket=source.bucket, Key=active_key)["Body"].read()
active = orjson.loads(active_body)
manifest_key = str(active.get("manifest_key") or "").strip()
if not manifest_key:
    raise RuntimeError("Active B2 search pointer does not contain a manifest key.")
manifest_body = client.get_object(Bucket=source.bucket, Key=manifest_key)["Body"].read()
manifest = orjson.loads(manifest_body)
if int(manifest.get("schema_version") or 0) != 1 or str(manifest.get("snapshot") or "") != args.snapshot:
    raise RuntimeError("Photo overlay snapshot does not match the active B2 search manifest.")

normalized_prefix = f"{source.data_prefix}/normalized/schema=v1/snapshot={args.snapshot}"
enriched_prefix = f"{source.data_prefix}/enrichment/photo_metadata/snapshot={args.snapshot}"
exclusion_prefix = f"{source.data_prefix}/enrichment/photo_exclusions/snapshot={args.snapshot}"
normalized_keys = list_keys(client, source.bucket, normalized_prefix)
enriched_keys = list_keys(client, source.bucket, enriched_prefix)
exclusion_keys = list_keys(client, source.bucket, exclusion_prefix)
normalized_files = [key for key in normalized_keys if key.endswith("/photo_metadata.parquet")]

con = duckdb.connect()
configure_duckdb(con, source, int(os.getenv("GLOBAL_LOCATION_PHOTO_OVERLAY_THREADS", "8")))
con.execute(
    """
    CREATE TEMP TABLE photo_rows(
      location_id VARCHAR,
      content_hash VARCHAR,
      provider VARCHAR,
      attribution VARCHAR,
      attribution_url VARCHAR,
      license VARCHAR,
      width INTEGER,
      height INTEGER,
      verified_at VARCHAR,
      source VARCHAR
    )
    """
)
con.execute("CREATE TEMP TABLE photo_exclusions(location_id VARCHAR, content_hash VARCHAR)")

compatible_sources = 0
incompatible_files = 0
for name, keys, prefix in (
    ("normalized", normalized_files, normalized_prefix),
    ("enriched", enriched_keys, enriched_prefix),
):
    if not keys:
        continue
    glob = f"s3://{source.bucket}/{prefix}/country_code=*/*.parquet"
    columns = columns_for(con, glob)
    if add_photo_source(con, glob, columns, name):
        compatible_sources += 1
    else:
        incompatible_files += len(keys)

if exclusion_keys:
    exclusion_glob = f"s3://{source.bucket}/{exclusion_prefix}/*.parquet"
    exclusion_columns = columns_for(con, exclusion_glob)
    if not add_exclusion_source(con, exclusion_glob, exclusion_columns):
        raise RuntimeError("Photo exclusion metadata exists but has no compatible identity columns.")

if (normalized_files or enriched_keys) and compatible_sources == 0:
    raise RuntimeError(
        f"Photo metadata exists but no compatible source was found; files={len(normalized_files) + len(enriched_keys)}"
    )

canonical_media_hashes = list_canonical_media_hashes(media_client, media["bucket"], media["prefix"])
if (normalized_files or enriched_keys) and not canonical_media_hashes:
    raise RuntimeError("Photo metadata exists but no canonical B2 media objects were found; refusing to publish an empty overlay.")
con.execute("CREATE TEMP TABLE canonical_media_hashes(content_hash VARCHAR PRIMARY KEY)")
con.executemany("INSERT INTO canonical_media_hashes VALUES (?)", [(value,) for value in sorted(canonical_media_hashes)])

rows = con.execute(
    """
    WITH ranked AS (
      SELECT
        trim(cast(p.location_id AS VARCHAR)) AS location_id,
        lower(trim(cast(p.content_hash AS VARCHAR))) AS content_hash,
        nullif(trim(cast(p.provider AS VARCHAR)), '') AS provider,
        nullif(trim(cast(p.attribution AS VARCHAR)), '') AS attribution,
        nullif(trim(cast(p.attribution_url AS VARCHAR)), '') AS attribution_url,
        nullif(trim(cast(p.license AS VARCHAR)), '') AS license,
        try_cast(p.width AS INTEGER) AS width,
        try_cast(p.height AS INTEGER) AS height,
        row_number() OVER (
          PARTITION BY trim(cast(p.location_id AS VARCHAR))
          ORDER BY coalesce(try_cast(p.verified_at AS TIMESTAMP), TIMESTAMP '1970-01-01') DESC,
                   coalesce(cast(p.provider AS VARCHAR), ''),
                   lower(trim(cast(p.content_hash AS VARCHAR)))
        ) AS rn
      FROM photo_rows p
      JOIN canonical_media_hashes m
        ON m.content_hash=lower(trim(cast(p.content_hash AS VARCHAR)))
      WHERE trim(cast(p.location_id AS VARCHAR)) <> ''
        AND regexp_full_match(lower(trim(cast(p.content_hash AS VARCHAR))), '[0-9a-f]{64}')
        AND NOT EXISTS (
          SELECT 1 FROM photo_exclusions x
          WHERE trim(cast(x.location_id AS VARCHAR)) = trim(cast(p.location_id AS VARCHAR))
            AND lower(trim(cast(x.content_hash AS VARCHAR))) = lower(trim(cast(p.content_hash AS VARCHAR)))
        )
    )
    SELECT location_id,content_hash,provider,attribution,attribution_url,license,width,height
    FROM ranked
    WHERE rn=1
    ORDER BY location_id
    """
).fetchall()
missing_media_references = int(
    con.execute(
        """
        SELECT count(*) FROM (
          SELECT DISTINCT trim(cast(p.location_id AS VARCHAR)), lower(trim(cast(p.content_hash AS VARCHAR)))
          FROM photo_rows p
          WHERE trim(cast(p.location_id AS VARCHAR)) <> ''
            AND regexp_full_match(lower(trim(cast(p.content_hash AS VARCHAR))), '[0-9a-f]{64}')
            AND NOT EXISTS (
              SELECT 1 FROM canonical_media_hashes m
              WHERE m.content_hash=lower(trim(cast(p.content_hash AS VARCHAR)))
            )
        )
        """
    ).fetchone()[0]
)
con.close()

entries = []
for row in rows:
    location_id, content_hash, provider, attribution, attribution_url, license_code, width, height = row
    if not HASH_RE.fullmatch(str(content_hash or "")):
        raise RuntimeError(f"Photo overlay selected an invalid hash for {location_id}.")
    entries.append([
        str(location_id),
        [
            str(content_hash).lower(),
            provider,
            attribution,
            attribution_url,
            license_code,
            width,
            height,
        ],
    ])

raw = orjson.dumps([OVERLAY_VERSION, entries])
compressed = brotli.compress(raw, quality=5, mode=brotli.MODE_TEXT)
if len(compressed) > args.max_compressed_bytes:
    raise RuntimeError(
        f"Photo overlay is {len(compressed)} compressed bytes, above the configured {args.max_compressed_bytes}; "
        "increase the explicit overlay budget or shard the overlay before publishing."
    )

digest = sha256_hex(compressed)
overlay_prefix = f"{source.data_prefix}/search/schema=v1/snapshot={args.snapshot}/photo-overlay-v1/sha256={digest}"
object_key = f"{overlay_prefix}/photos.json.br"
try:
    head = client.head_object(Bucket=source.bucket, Key=object_key)
except ClientError as error:
    if not is_missing(error):
        raise
    client.put_object(
        Bucket=source.bucket,
        Key=object_key,
        Body=compressed,
        ContentType="application/json",
        CacheControl="public,max-age=31536000,immutable",
        Metadata={
            "sha256": digest,
            "overlay-version": str(OVERLAY_VERSION),
            "photo-count": str(len(entries)),
        },
    )
else:
    metadata = {str(key).lower(): str(value) for key, value in (head.get("Metadata") or {}).items()}
    if int(head.get("ContentLength") or -1) != len(compressed) or metadata.get("sha256") != digest:
        raise RuntimeError(f"Existing immutable photo overlay differs: {object_key}")

pointer = {
    "schema_version": 1,
    "overlay_version": OVERLAY_VERSION,
    "source_snapshot": args.snapshot,
    "source_manifest_key": manifest_key,
    "source_manifest_sha256": sha256_hex(manifest_body),
    "object_key": object_key,
    "object_sha256": digest,
    "photo_count": len(entries),
    "raw_bytes": len(raw),
    "compressed_bytes": len(compressed),
    "bloom": {
        "bit_count": BLOOM_BITS,
        "hash_count": BLOOM_HASHES,
        "bits": bloom_filter([entry[0] for entry in entries]),
    },
    "generated_at": utc_now(),
}
pointer_key = f"{source.data_prefix}/search/photo-overlay-v1/active.json"
client.put_object(
    Bucket=source.bucket,
    Key=pointer_key,
    Body=orjson.dumps(pointer, option=orjson.OPT_SORT_KEYS | orjson.OPT_INDENT_2) + b"\n",
    ContentType="application/json",
    CacheControl="no-store",
)
print(
    f"photo_overlay_published=true snapshot={args.snapshot} photos={len(entries)} "
    f"raw_bytes={len(raw)} compressed_bytes={len(compressed)} incompatible_files={incompatible_files} "
    f"missing_media_references={missing_media_references} "
    f"object_key={object_key} pointer_key={pointer_key}",
    flush=True,
)
