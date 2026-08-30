#!/usr/bin/env python3
"""Build a local, metadata-first manifest for bulk geotagged photo datasets.

The manifest builder never uploads media and never decodes image bytes. It
filters dataset metadata, maps candidates to the active canonical location
catalogue with a bounded spatial join, and writes only candidates that can be
processed by the canonical B2 materializer. The materializer then reads local
OSV/MSLS files (or an explicitly allowed YFCC source URL) into memory, applies
the existing JPEG/hash/claim/upload contract, and publishes searchable
references through the normal photo overlay.

The command has no implicit total-location limit. ``--max-records`` is an
explicit pilot-only bound for the source records read in one invocation.
"""
from __future__ import annotations

import argparse
import bz2
import csv
import gzip
import json
import math
import os
import re
import sqlite3
from dataclasses import dataclass, field
from itertools import chain
from pathlib import Path
from typing import Iterable, Iterator, TextIO
from urllib.parse import urlsplit, urlunsplit

import duckdb

from location_search_common import b2_source_config, configure_duckdb


CELL_DEGREES = 0.0005
EARTH_RADIUS_METERS = 6_378_008.8
MAX_SOURCE_ID_LENGTH = 300
MAX_URL_LENGTH = 4096
IMAGE_SUFFIXES = {".avif", ".jpeg", ".jpg", ".png", ".webp"}
DATASET_PRIORITY = {"msls": 0, "osv5m": 1, "yfcc100m": 2}
MAPILLARY_HOST_RE = re.compile(r"(?:[a-z0-9-]+\.)*(?:mapillary\.com|fbcdn\.net)$", re.I)
FLICKR_HOST_RE = re.compile(r"(?:[a-z0-9-]+\.)*(?:staticflickr\.com|flickr\.com)$", re.I)
HEX32_RE = re.compile(r"^[0-9a-f]{32}$", re.I)

YFCC_COLUMNS = [
    "photo_id",
    "user_id",
    "user_nickname",
    "date_taken",
    "date_uploaded",
    "capture_device",
    "title",
    "description",
    "user_tags",
    "machine_tags",
    "longitude",
    "latitude",
    "accuracy",
    "page_url",
    "download_url",
    "license_name",
    "license_url",
    "server_id",
    "farm_id",
    "secret",
    "original_secret",
    "original_extension",
    "media_type",
]
YFCC_LEADING_ROW_COLUMNS = ["row_id", *YFCC_COLUMNS]


def normalized_header(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def text_value(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def sql_text(value: object) -> str:
    return str(value or "").replace("'", "''")


def parse_float(value: object) -> float | None:
    try:
        parsed = float(str(value or "").strip())
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def valid_coordinates(latitude: float | None, longitude: float | None) -> bool:
    return (
        latitude is not None
        and longitude is not None
        and -90.0 <= latitude <= 90.0
        and -180.0 <= longitude <= 180.0
        and not (latitude == 0.0 and longitude == 0.0)
    )


def normalize_https_url(value: object, *, upgrade_http: bool = False) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = urlsplit(raw)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return None
    scheme = parsed.scheme.lower()
    if scheme == "http" and upgrade_http:
        scheme = "https"
    if scheme != "https" or not hostname or parsed.username or parsed.password:
        return None
    hostname = hostname.rstrip(".").lower()
    if ":" in hostname and not hostname.startswith("["):
        hostname = f"[{hostname}]"
    netloc = hostname if port in (None, 443) else f"{hostname}:{port}"
    normalized = urlunsplit(("https", netloc, parsed.path or "/", parsed.query, ""))
    return normalized if len(normalized) <= MAX_URL_LENGTH else None


def allowed_host(url: str | None, pattern: re.Pattern[str]) -> bool:
    if not url:
        return False
    try:
        hostname = urlsplit(url).hostname or ""
    except ValueError:
        return False
    return bool(pattern.fullmatch(hostname.lower()))


def mapillary_page_url(external_id: str) -> str:
    from urllib.parse import quote

    return f"https://www.mapillary.com/app/?pKey={quote(external_id, safe='')}&focus=photo"


def flickr_page_url(user_id: str, photo_id: str) -> str | None:
    if not user_id or not photo_id:
        return None
    from urllib.parse import quote

    return f"https://www.flickr.com/photos/{quote(user_id, safe='@._-')}/{quote(photo_id, safe='')}/"


def row_value(row: dict[str, object], *names: str) -> str:
    normalized = {normalized_header(key): value for key, value in row.items()}
    for name in names:
        value = normalized.get(normalized_header(name))
        if value is not None and str(value).strip():
            return text_value(value)
    return ""


def open_text(path: Path) -> TextIO:
    suffix = path.suffix.lower()
    if suffix == ".bz2":
        return bz2.open(path, "rt", encoding="utf-8", errors="replace", newline="")
    if suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8", errors="replace", newline="")
    return path.open("r", encoding="utf-8", errors="replace", newline="")


def named_files(root: Path, names: set[str]) -> list[Path]:
    if root.is_file():
        return [root] if root.name.lower() in names else []
    result: list[Path] = []
    for directory, _, files in os.walk(root):
        for name in files:
            if name.lower() in names:
                result.append(Path(directory) / name)
    return sorted(result)


@dataclass
class SourceStats:
    scanned: int = 0
    accepted: int = 0
    rejected: int = 0
    reasons: dict[str, int] = field(default_factory=dict)

    def reject(self, reason: str) -> None:
        self.rejected += 1
        self.reasons[reason] = self.reasons.get(reason, 0) + 1


class LocalAssetIndex:
    """Persistent basename index so millions of metadata rows avoid rglob calls."""

    def __init__(self, database: Path, root: Path):
        self.database = database
        self.root = root.resolve()
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(self.database))
        self.connection.execute("PRAGMA synchronous=NORMAL")
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS asset_index (asset_key TEXT NOT NULL, path TEXT NOT NULL, UNIQUE(asset_key, path))"
        )
        self.connection.execute("CREATE INDEX IF NOT EXISTS asset_index_key ON asset_index(asset_key)")
        self.connection.execute("CREATE TABLE IF NOT EXISTS asset_index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        stored_root = self.connection.execute(
            "SELECT value FROM asset_index_meta WHERE key='root'"
        ).fetchone()
        complete = self.connection.execute(
            "SELECT value FROM asset_index_meta WHERE key='complete'"
        ).fetchone()
        if stored_root != (str(self.root),) or complete != ("1",):
            self.connection.execute("DELETE FROM asset_index")
            self.connection.execute("DELETE FROM asset_index_meta")
            self.connection.execute(
                "INSERT INTO asset_index_meta(key,value) VALUES ('root',?),('complete','0')",
                (str(self.root),),
            )
            self.connection.commit()
            self._build()
        else:
            count = self.connection.execute("SELECT count(*) FROM asset_index").fetchone()[0]
            print(f"asset index ready: {count:,} files from {self.root}", flush=True)

    def _build(self) -> None:
        if not self.root.is_dir():
            raise RuntimeError(f"dataset image root does not exist: {self.root}")
        count = 0
        batch: list[tuple[str, str]] = []
        for directory, _, files in os.walk(self.root):
            for name in files:
                path = Path(directory) / name
                if path.suffix.lower() not in IMAGE_SUFFIXES:
                    continue
                asset_key = path.stem.strip()
                if not asset_key:
                    continue
                batch.append((asset_key, str(path.resolve())))
                if len(batch) >= 10_000:
                    self.connection.executemany(
                        "INSERT OR IGNORE INTO asset_index(asset_key,path) VALUES (?,?)", batch
                    )
                    self.connection.commit()
                    count += len(batch)
                    batch.clear()
                    if count and count % 100_000 < 10_000:
                        print(f"indexed {count:,} image paths under {self.root}", flush=True)
        if batch:
            self.connection.executemany(
                "INSERT OR IGNORE INTO asset_index(asset_key,path) VALUES (?,?)", batch
            )
        self.connection.execute("UPDATE asset_index_meta SET value='1' WHERE key='complete'")
        self.connection.commit()
        total = self.connection.execute("SELECT count(*) FROM asset_index").fetchone()[0]
        print(f"asset index built: {total:,} files from {self.root}", flush=True)

    def lookup(self, asset_key: str) -> str | None:
        row = self.connection.execute(
            "SELECT path FROM asset_index WHERE asset_key=? ORDER BY path LIMIT 1", (asset_key,)
        ).fetchone()
        return str(row[0]) if row else None

    def close(self) -> None:
        self.connection.close()


class YfccHashIndex:
    """Optional on-disk photo-id to Multimedia Commons MD5 mapping."""

    def __init__(self, database: Path, mapping: Path):
        self.database = database
        self.mapping = mapping
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(self.database))
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS yfcc_hash(photo_id TEXT PRIMARY KEY, media_hash TEXT NOT NULL)"
        )
        self.connection.execute("CREATE TABLE IF NOT EXISTS yfcc_hash_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        signature = f"{self.mapping.resolve()}:{self.mapping.stat().st_size}:{self.mapping.stat().st_mtime_ns}"
        complete = self.connection.execute(
            "SELECT value FROM yfcc_hash_meta WHERE key='signature'"
        ).fetchone()
        if complete != (signature,):
            self.connection.execute("DELETE FROM yfcc_hash")
            self.connection.execute("DELETE FROM yfcc_hash_meta")
            batch: list[tuple[str, str]] = []
            with open_text(self.mapping) as stream:
                for line in stream:
                    fields = [value for value in re.split(r"[\t, ]+", line.strip()) if value]
                    hashes = [value.lower() for value in fields if HEX32_RE.fullmatch(value)]
                    if not hashes:
                        continue
                    media_hash = hashes[0]
                    non_hash_fields = [value for value in fields if value.lower() != media_hash]
                    # Multimedia Commons lists are commonly either
                    # ``photo_id hash`` or ``line_number photo_id hash``.
                    # The photo ID is therefore the final non-hash field;
                    # never use a leading line number as the provider ID.
                    photo_id = non_hash_fields[-1] if non_hash_fields else ""
                    if not photo_id:
                        continue
                    batch.append((photo_id, media_hash))
                    if len(batch) >= 20_000:
                        self.connection.executemany(
                            "INSERT OR REPLACE INTO yfcc_hash(photo_id,media_hash) VALUES (?,?)", batch
                        )
                        self.connection.commit()
                        batch.clear()
            if batch:
                self.connection.executemany(
                    "INSERT OR REPLACE INTO yfcc_hash(photo_id,media_hash) VALUES (?,?)", batch
                )
            self.connection.execute(
                "INSERT INTO yfcc_hash_meta(key,value) VALUES ('signature',?)", (signature,)
            )
            self.connection.commit()
            count = self.connection.execute("SELECT count(*) FROM yfcc_hash").fetchone()[0]
            print(f"YFCC hash index ready: {count:,} IDs", flush=True)

    def lookup(self, photo_id: str) -> str | None:
        row = self.connection.execute(
            "SELECT media_hash FROM yfcc_hash WHERE photo_id=?", (photo_id,)
        ).fetchone()
        return str(row[0]) if row else None

    def close(self) -> None:
        self.connection.close()


def resolve_yfcc_local_path(root: Path | None, photo_id: str, media_hash: str | None) -> str | None:
    if root is None:
        return None
    candidates: list[Path] = []
    if media_hash and HEX32_RE.fullmatch(media_hash):
        bases = [root, root / "data" / "images", root / "images"]
        for base in bases:
            for suffix in IMAGE_SUFFIXES:
                candidates.append(base / media_hash[:3] / media_hash[3:6] / f"{media_hash}{suffix}")
                candidates.append(base / media_hash[:3] / media_hash[3:] / f"{media_hash}{suffix}")
    for suffix in IMAGE_SUFFIXES:
        candidates.append(root / f"{photo_id}{suffix}")
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate.resolve())
    return None


def candidate_row(
    *,
    provider: str,
    external_photo_id: str,
    image_path: str | None,
    asset_url: str,
    page_url: str,
    attribution: str,
    license_code: str,
    license_url: str,
    source_dataset: str,
    source_latitude: float,
    source_longitude: float,
    captured_at: str,
) -> dict[str, object]:
    return {
        "provider": provider,
        "external_photo_id": external_photo_id[:MAX_SOURCE_ID_LENGTH],
        "image_path": image_path,
        "asset_url": asset_url,
        "page_url": page_url,
        "attribution": attribution[:240],
        "license": license_code[:80],
        "license_url": license_url,
        "source_dataset": source_dataset,
        "dataset_priority": DATASET_PRIORITY[source_dataset],
        "source_latitude": source_latitude,
        "source_longitude": source_longitude,
        "captured_at": captured_at[:120],
    }


def iter_osv(root: Path, index: LocalAssetIndex, stats: SourceStats) -> Iterator[dict[str, object]]:
    files = named_files(root, {"train.csv", "test.csv"})
    if not files:
        raise RuntimeError(f"OSV metadata train.csv/test.csv was not found under {root}")
    for metadata in files:
        with open_text(metadata) as stream:
            reader = csv.DictReader(stream)
            for row in reader:
                stats.scanned += 1
                external_id = row_value(row, "id", "image_id", "photo_id")
                latitude = parse_float(row_value(row, "latitude", "lat"))
                longitude = parse_float(row_value(row, "longitude", "lon", "lng"))
                if not external_id or len(external_id) > MAX_SOURCE_ID_LENGTH:
                    stats.reject("missing_provider_identity")
                    continue
                if not valid_coordinates(latitude, longitude):
                    stats.reject("invalid_coordinates")
                    continue
                image_path = index.lookup(external_id)
                if not image_path:
                    stats.reject("missing_local_image")
                    continue
                page_url = mapillary_page_url(external_id)
                source_url = normalize_https_url(
                    row_value(row, "thumb_original_url", "original_url", "image_url"),
                    upgrade_http=True,
                )
                if not allowed_host(source_url, MAPILLARY_HOST_RE):
                    source_url = page_url
                creator = row_value(row, "creator_username", "username", "creator") or "Mapillary contributor"
                stats.accepted += 1
                yield candidate_row(
                    provider="mapillary",
                    external_photo_id=external_id,
                    image_path=image_path,
                    asset_url=source_url,
                    page_url=page_url,
                    attribution=f"{creator} - Mapillary - CC BY-SA 4.0",
                    license_code="CC-BY-SA-4.0",
                    license_url="https://creativecommons.org/licenses/by-sa/4.0/",
                    source_dataset="osv5m",
                    source_latitude=latitude,
                    source_longitude=longitude,
                    captured_at=row_value(row, "captured_at", "date_taken"),
                )


def iter_msls(root: Path, index: LocalAssetIndex, stats: SourceStats) -> Iterator[dict[str, object]]:
    files = named_files(root, {"raw.csv"})
    if not files:
        raise RuntimeError(f"MSLS raw.csv files were not found under {root}")
    for metadata in files:
        image_root = metadata.parent / "images"
        city = metadata.parent.parent.name
        with open_text(metadata) as stream:
            reader = csv.DictReader(stream)
            for row in reader:
                stats.scanned += 1
                external_id = row_value(row, "key", "image_id", "id")
                latitude = parse_float(row_value(row, "lat", "latitude"))
                longitude = parse_float(row_value(row, "lon", "longitude", "lng"))
                if not external_id or len(external_id) > MAX_SOURCE_ID_LENGTH:
                    stats.reject("missing_provider_identity")
                    continue
                if not valid_coordinates(latitude, longitude):
                    stats.reject("invalid_coordinates")
                    continue
                image_path = None
                for suffix in IMAGE_SUFFIXES:
                    direct = image_root / f"{external_id}{suffix}"
                    if direct.is_file():
                        image_path = str(direct.resolve())
                        break
                image_path = image_path or index.lookup(external_id)
                if not image_path:
                    stats.reject("missing_local_image")
                    continue
                page_url = mapillary_page_url(external_id)
                stats.accepted += 1
                yield candidate_row(
                    provider="mapillary",
                    external_photo_id=external_id,
                    image_path=image_path,
                    asset_url=page_url,
                    page_url=page_url,
                    attribution="Mapillary contributor - Mapillary - CC BY-SA 4.0",
                    license_code="CC-BY-SA-4.0",
                    license_url="https://creativecommons.org/licenses/by-sa/4.0/",
                    source_dataset="msls",
                    source_latitude=latitude,
                    source_longitude=longitude,
                    captured_at=row_value(row, "captured_at", "date_taken"),
                )


def yfcc_license(row: dict[str, object]) -> tuple[str, str] | None:
    name = row_value(row, "license_name", "license", "licensename").lower()
    raw_url = row_value(row, "license_url", "licenseurl")
    url = normalize_https_url(raw_url, upgrade_http=True)
    combined = f"{name} {url or ''}".lower()
    if any(token in combined for token in ("noncommercial", "non-commercial", "/nc", "no derivatives", "no-derivatives", "/nd", "by-nc", "by-nd")):
        return None
    if "public domain" in combined or "publicdomain/zero" in combined or "cc0" in combined or "/zero/" in combined:
        return "CC0-1.0", "https://creativecommons.org/publicdomain/zero/1.0/"
    match = re.search(r"/licenses/(by-sa|by)/([^/?#]+)", url or "", re.I)
    if match:
        family = match.group(1).lower()
        version = match.group(2)
        if family == "by-sa":
            return f"CC-BY-SA-{version}", f"https://creativecommons.org/licenses/by-sa/{version}/"
        return f"CC-BY-{version}", f"https://creativecommons.org/licenses/by/{version}/"
    if "attribution-sharealike" in combined or "cc by-sa" in combined or "cc-by-sa" in combined:
        return "CC-BY-SA-4.0", "https://creativecommons.org/licenses/by-sa/4.0/"
    if re.search(r"\bcc[- ]?by\b|attribution license", name) and "sharealike" not in name:
        return "CC-BY-4.0", "https://creativecommons.org/licenses/by/4.0/"
    return None


def yfcc_mapping(values: list[str]) -> dict[str, object]:
    if len(values) == len(YFCC_COLUMNS):
        return dict(zip(YFCC_COLUMNS, values))
    if len(values) == len(YFCC_LEADING_ROW_COLUMNS):
        return dict(zip(YFCC_LEADING_ROW_COLUMNS, values))
    raise ValueError(
        f"unsupported YFCC metadata row width {len(values)}; expected "
        f"{len(YFCC_COLUMNS)} or {len(YFCC_LEADING_ROW_COLUMNS)} columns"
    )


def looks_like_yfcc_header(values: list[str]) -> bool:
    normalized = {normalized_header(value) for value in values}
    return bool(normalized & {"photoid", "mediaidentifier", "downloadurl", "licensename"})


def iter_yfcc(
    metadata: Path,
    media_root: Path | None,
    hash_index: YfccHashIndex | None,
    allow_remote: bool,
    stats: SourceStats,
) -> Iterator[dict[str, object]]:
    with open_text(metadata) as stream:
        reader = csv.reader(stream, delimiter="\t")
        try:
            first = next(reader)
        except StopIteration:
            return
        header: list[str] | None = first if looks_like_yfcc_header(first) else None
        rows: Iterable[list[str]] = reader if header else chain((first,), reader)
        for values in rows:
            row = (
                {header[index]: values[index] if index < len(values) else "" for index in range(len(header))}
                if header is not None
                else yfcc_mapping(values)
            )
            stats.scanned += 1
            photo_id = row_value(row, "photo_id", "photoid", "media_identifier", "media_id", "id")
            marker = row_value(row, "media_type", "marker", "photo_video_marker", "type").lower()
            if marker and marker not in {"0", "photo", "image", "still"}:
                stats.reject("not_a_photo")
                continue
            latitude = parse_float(row_value(row, "latitude", "lat"))
            longitude = parse_float(row_value(row, "longitude", "lon", "lng"))
            if not photo_id or len(photo_id) > MAX_SOURCE_ID_LENGTH:
                stats.reject("missing_provider_identity")
                continue
            if not valid_coordinates(latitude, longitude):
                stats.reject("invalid_coordinates")
                continue
            license_info = yfcc_license(row)
            if not license_info:
                stats.reject("unacceptable_license")
                continue
            license_code, license_url = license_info
            download_url = normalize_https_url(row_value(row, "download_url", "image_url", "media_url"), upgrade_http=True)
            if not allowed_host(download_url, FLICKR_HOST_RE):
                download_url = None
            user_id = row_value(row, "user_id", "uid", "user_nsid", "owner_id")
            page_url = normalize_https_url(row_value(row, "page_url", "photo_page_url", "media_page_url"), upgrade_http=True)
            page_url = page_url or flickr_page_url(user_id, photo_id)
            if not page_url:
                stats.reject("missing_source_url")
                continue
            media_hash = hash_index.lookup(photo_id) if hash_index else None
            image_path = resolve_yfcc_local_path(media_root, photo_id, media_hash)
            if not image_path and not (allow_remote and download_url):
                stats.reject("missing_local_media")
                continue
            asset_url = download_url or page_url
            nickname = row_value(row, "user_nickname", "unickname", "nickname", "user_id", "uid") or "Flickr contributor"
            stats.accepted += 1
            yield candidate_row(
                provider="yfcc100m",
                external_photo_id=photo_id,
                image_path=image_path,
                asset_url=asset_url,
                page_url=page_url,
                attribution=f"{nickname} - Flickr - {license_code}",
                license_code=license_code,
                license_url=license_url,
                source_dataset="yfcc100m",
                source_latitude=latitude,
                source_longitude=longitude,
                captured_at=row_value(row, "date_taken", "captured_at"),
            )


def describe_columns(con: duckdb.DuckDBPyConnection, uri: str) -> set[str]:
    try:
        return {
            str(row[0]).lower()
            for row in con.execute(
                f"DESCRIBE SELECT * FROM read_parquet('{sql_text(uri)}', union_by_name=true, hive_partitioning=true)"
            ).fetchall()
        }
    except Exception as error:
        raise RuntimeError(f"could not read location Parquet metadata from {uri}: {error}") from error


def first_column(columns: set[str], *names: str) -> str | None:
    for name in names:
        if name.lower() in columns:
            return name.lower()
    return None


def prepare_locations(
    con: duckdb.DuckDBPyConnection,
    locations_uri: str,
    countries: set[str],
) -> None:
    columns = describe_columns(con, locations_uri)
    id_column = first_column(columns, "id", "location_id")
    latitude_column = first_column(columns, "latitude", "lat")
    longitude_column = first_column(columns, "longitude", "lon", "lng")
    country_column = first_column(columns, "country_code", "country")
    category_column = first_column(columns, "category", "kind")
    if not id_column or not latitude_column or not longitude_column:
        raise RuntimeError(
            f"locations Parquet must expose id, latitude, and longitude; found {sorted(columns)}"
        )
    country_expr = f"upper(trim(cast({country_column} AS VARCHAR)))" if country_column else "NULL::VARCHAR"
    category_expr = f"lower(trim(cast({category_column} AS VARCHAR)))" if category_column else "NULL::VARCHAR"
    country_filter = ""
    if countries:
        values = ",".join(f"'{sql_text(value)}'" for value in sorted(countries))
        country_filter = f"AND {country_expr} IN ({values})"
    con.execute(
        f"""
CREATE TEMP TABLE bulk_locations AS
SELECT
  cast({id_column} AS VARCHAR) AS location_id,
  cast({latitude_column} AS DOUBLE) AS latitude,
  cast({longitude_column} AS DOUBLE) AS longitude,
  {country_expr} AS country_code,
  {category_expr} AS category,
  floor((cast({latitude_column} AS DOUBLE) + 90.0) / {CELL_DEGREES})::BIGINT AS cell_lat,
  floor((cast({longitude_column} AS DOUBLE) + 180.0) / {CELL_DEGREES})::BIGINT AS cell_lon
FROM read_parquet('{sql_text(locations_uri)}', union_by_name=true, hive_partitioning=true)
WHERE cast({latitude_column} AS DOUBLE) BETWEEN -90.0 AND 90.0
  AND cast({longitude_column} AS DOUBLE) BETWEEN -180.0 AND 180.0
  AND {country_expr} IS NOT NULL
  {country_filter}
"""
    )
    count = con.execute("SELECT count(*) FROM bulk_locations").fetchone()[0]
    if not count:
        raise RuntimeError("the location snapshot contains no eligible locations for the requested countries")
    print(f"location join table ready: {count:,} eligible locations", flush=True)


def insert_candidates(con: duckdb.DuckDBPyConnection, candidates: Iterable[dict[str, object]], max_records: int | None) -> tuple[int, int]:
    con.execute(
        """
CREATE TEMP TABLE source_candidates(
  provider VARCHAR,
  external_photo_id VARCHAR,
  image_path VARCHAR,
  asset_url VARCHAR,
  page_url VARCHAR,
  attribution VARCHAR,
  license VARCHAR,
  license_url VARCHAR,
  source_dataset VARCHAR,
  dataset_priority INTEGER,
  source_latitude DOUBLE,
  source_longitude DOUBLE,
  captured_at VARCHAR
)
"""
    )
    accepted = 0
    inserted = 0
    batch: list[tuple[object, ...]] = []
    for row in candidates:
        if max_records is not None and inserted >= max_records:
            break
        accepted += 1
        batch.append(
            tuple(
                row[key]
                for key in (
                    "provider",
                    "external_photo_id",
                    "image_path",
                    "asset_url",
                    "page_url",
                    "attribution",
                    "license",
                    "license_url",
                    "source_dataset",
                    "dataset_priority",
                    "source_latitude",
                    "source_longitude",
                    "captured_at",
                )
            )
        )
        inserted += 1
        if len(batch) >= 10_000:
            con.executemany("INSERT INTO source_candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
            batch.clear()
        if inserted and inserted % 100_000 == 0:
            print(f"accepted {inserted:,} source candidates", flush=True)
    if batch:
        con.executemany("INSERT INTO source_candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
    return accepted, inserted


def build_manifest(
    con: duckdb.DuckDBPyConnection,
    output: Path,
    max_distance_m: float,
    max_candidates_per_location: int,
    neighbor_cells: int,
) -> int:
    con.execute(
        f"""
CREATE TEMP TABLE bulk_photo_manifest AS
WITH provider_dedup AS (
  SELECT *
  FROM (
    SELECT c.*,
      row_number() OVER (
        PARTITION BY provider,external_photo_id
        ORDER BY dataset_priority,source_dataset,coalesce(image_path,''),asset_url
      ) AS identity_rank
    FROM source_candidates c
  ) ranked
  WHERE identity_rank=1
),
url_dedup AS (
  SELECT *
  FROM (
    SELECT c.*,
      row_number() OVER (
        PARTITION BY asset_url
        ORDER BY dataset_priority,provider,external_photo_id
      ) AS source_rank
    FROM provider_dedup c
  ) ranked
  WHERE source_rank=1
),
matched AS (
  SELECT
    upper(trim(l.country_code)) AS country_code,
    l.location_id,
    c.provider,
    c.external_photo_id,
    c.image_path,
    c.asset_url,
    c.page_url,
    c.attribution,
    c.license,
    c.license_url,
    c.source_dataset,
    c.dataset_priority,
    c.source_latitude,
    c.source_longitude,
    c.captured_at,
    {EARTH_RADIUS_METERS} * 2.0 * asin(sqrt(
      pow(sin(radians(l.latitude-c.source_latitude)/2.0),2.0)
      + cos(radians(l.latitude))*cos(radians(c.source_latitude))
        * pow(sin(radians(least(abs(l.longitude-c.source_longitude),360.0-abs(l.longitude-c.source_longitude)))/2.0),2.0)
    )) AS distance_m
  FROM url_dedup c
  JOIN bulk_locations l
    ON l.cell_lat BETWEEN floor((c.source_latitude+90.0)/{CELL_DEGREES})-{neighbor_cells}
                       AND floor((c.source_latitude+90.0)/{CELL_DEGREES})+{neighbor_cells}
   AND l.cell_lon BETWEEN floor((c.source_longitude+180.0)/{CELL_DEGREES})-{neighbor_cells}
                       AND floor((c.source_longitude+180.0)/{CELL_DEGREES})+{neighbor_cells}
),
within_radius AS (
  SELECT * FROM matched WHERE distance_m <= {max_distance_m}
),
ranked AS (
  SELECT *,
    row_number() OVER (
      PARTITION BY location_id
      ORDER BY
        CASE provider WHEN 'mapillary' THEN 0 WHEN 'yfcc100m' THEN 1 ELSE 2 END,
        distance_m,
        dataset_priority,
        external_photo_id
    ) AS candidate_rank
  FROM within_radius
)
SELECT
  country_code,location_id,provider,external_photo_id,image_path,asset_url,page_url,
  attribution,license,license_url,source_dataset,dataset_priority,
  source_latitude,source_longitude,distance_m,-distance_m AS rank_score,captured_at,
  candidate_rank
FROM ranked
WHERE candidate_rank <= {max_candidates_per_location}
"""
    )
    count = int(con.execute("SELECT count(*) FROM bulk_photo_manifest").fetchone()[0])
    output.parent.mkdir(parents=True, exist_ok=True)
    escaped_output = sql_text(str(output.resolve()))
    con.execute(
        f"COPY (SELECT * FROM bulk_photo_manifest ORDER BY country_code,location_id,candidate_rank) TO '{escaped_output}' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 100000)"
    )
    return count


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--snapshot", required=True, help="Active canonical location snapshot date (YYYY-MM-DD).")
    command.add_argument("--locations-uri", default="", help="Local Parquet path/glob or B2 s3:// location snapshot.")
    command.add_argument("--output", required=True, help="Local Parquet manifest path.")
    command.add_argument("--osv-root", default="", help="Extracted OSV-5M dataset root.")
    command.add_argument("--msls-root", default="", help="Extracted MSLS dataset root.")
    command.add_argument("--yfcc-metadata", default="", help="YFCC100M metadata TSV/BZ2 path.")
    command.add_argument("--yfcc-media-root", default="", help="Optional local Multimedia Commons media root.")
    command.add_argument("--yfcc-hash-map", default="", help="Optional YFCC photo-id to media-MD5 mapping file.")
    command.add_argument("--allow-yfcc-remote", action="store_true", help="Allow approved Flickr URLs when YFCC media is not staged locally.")
    command.add_argument("--countries", default="", help="Comma-separated destination ISO country codes; empty means all.")
    command.add_argument("--max-distance-m", type=float, default=45.0, help="Maximum photo-to-location distance in meters.")
    command.add_argument("--max-candidates-per-location", type=int, default=9, help="Candidate fallback rows retained per location.")
    command.add_argument("--max-records", type=int, default=None, help="Explicit pilot bound on accepted source records; omit for the full resumable run.")
    command.add_argument("--threads", type=int, default=int(os.getenv("GLOBAL_BULK_MANIFEST_THREADS", "8")))
    command.add_argument("--work-db", default="", help="Optional local DuckDB work database; defaults beside the output.")
    command.add_argument("--report", default="", help="Optional JSON report path.")
    return command


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", args.snapshot):
        raise SystemExit("--snapshot must be an ISO date (YYYY-MM-DD)")
    if args.max_distance_m <= 0 or args.max_distance_m > 1_000:
        raise SystemExit("--max-distance-m must be between 0 and 1000")
    if args.max_candidates_per_location < 1 or args.max_candidates_per_location > 64:
        raise SystemExit("--max-candidates-per-location must be between 1 and 64")
    if args.max_records is not None and args.max_records < 1:
        raise SystemExit("--max-records must be positive when supplied")
    dataset_args = [args.osv_root, args.msls_root, args.yfcc_metadata]
    if not any(str(value).strip() for value in dataset_args):
        raise SystemExit("at least one of --osv-root, --msls-root, or --yfcc-metadata is required")

    output = Path(args.output).expanduser().resolve()
    locations_uri = str(args.locations_uri or "").strip()
    if not locations_uri:
        source = b2_source_config()
        locations_uri = (
            f"s3://{source.bucket}/{source.data_prefix}/normalized/schema=v1/"
            f"snapshot={args.snapshot}/country_code=*/locations.parquet"
        )
    countries = {value.strip().upper() for value in str(args.countries).split(",") if value.strip()}
    if any(not re.fullmatch(r"[A-Z]{2}", value) for value in countries):
        raise SystemExit("--countries must contain ISO alpha-2 codes")

    work_db = Path(args.work_db).expanduser().resolve() if args.work_db else output.with_suffix(".duckdb")
    con = duckdb.connect(str(work_db))
    con.execute(f"SET threads TO {max(1, min(32, int(args.threads)))}")
    if locations_uri.lower().startswith("s3://"):
        configure_duckdb(con, b2_source_config(), max(1, min(32, int(args.threads))))

    indexes: list[LocalAssetIndex] = []
    hash_index: YfccHashIndex | None = None
    stats: dict[str, SourceStats] = {}
    try:
        prepare_locations(con, locations_uri, countries)

        source_iterators: list[Iterator[dict[str, object]]] = []
        if args.osv_root:
            root = Path(args.osv_root).expanduser().resolve()
            index = LocalAssetIndex(work_db.with_name(f"{work_db.stem}.osv-assets.sqlite"), root / "images")
            indexes.append(index)
            stats["osv5m"] = SourceStats()
            source_iterators.append(iter_osv(root, index, stats["osv5m"]))
        if args.msls_root:
            root = Path(args.msls_root).expanduser().resolve()
            index = LocalAssetIndex(work_db.with_name(f"{work_db.stem}.msls-assets.sqlite"), root)
            indexes.append(index)
            stats["msls"] = SourceStats()
            source_iterators.append(iter_msls(root, index, stats["msls"]))
        if args.yfcc_metadata:
            metadata = Path(args.yfcc_metadata).expanduser().resolve()
            if not metadata.is_file():
                raise RuntimeError(f"YFCC metadata file does not exist: {metadata}")
            media_root = Path(args.yfcc_media_root).expanduser().resolve() if args.yfcc_media_root else None
            if media_root and not media_root.is_dir():
                raise RuntimeError(f"YFCC media root does not exist: {media_root}")
            if args.yfcc_hash_map:
                mapping = Path(args.yfcc_hash_map).expanduser().resolve()
                if not mapping.is_file():
                    raise RuntimeError(f"YFCC hash map does not exist: {mapping}")
                hash_index = YfccHashIndex(work_db.with_name(f"{work_db.stem}.yfcc-hashes.sqlite"), mapping)
            stats["yfcc100m"] = SourceStats()
            source_iterators.append(
                iter_yfcc(metadata, media_root, hash_index, bool(args.allow_yfcc_remote), stats["yfcc100m"])
            )

        # The adapters are streamed into DuckDB; image bytes are not read here.
        all_candidates = (row for iterator in source_iterators for row in iterator)
        accepted, inserted = insert_candidates(con, all_candidates, args.max_records)
        if not inserted:
            summary = {name: vars(value) for name, value in stats.items()}
            raise RuntimeError(f"no usable source candidates were produced: {json.dumps(summary, sort_keys=True)}")
        neighbor_cells = max(1, math.ceil(args.max_distance_m / (CELL_DEGREES * 111_320.0)) + 1)
        manifest_count = build_manifest(
            con,
            output,
            args.max_distance_m,
            args.max_candidates_per_location,
            neighbor_cells,
        )
        report = {
            "snapshot": args.snapshot,
            "locationsUri": locations_uri,
            "output": str(output),
            "countries": sorted(countries),
            "sourceRecordsAccepted": accepted,
            "sourceRecordsInserted": inserted,
            "manifestRows": manifest_count,
            "manifestLocations": int(con.execute("SELECT count(DISTINCT location_id) FROM bulk_photo_manifest").fetchone()[0]),
            "maxDistanceMeters": args.max_distance_m,
            "maxCandidatesPerLocation": args.max_candidates_per_location,
            "maxRecords": args.max_records,
            "sources": {name: vars(value) for name, value in stats.items()},
        }
        if args.report:
            report_path = Path(args.report).expanduser().resolve()
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2, sort_keys=True), flush=True)
        return 0
    finally:
        if hash_index:
            hash_index.close()
        for index in indexes:
            index.close()
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())
