# Bulk photo dataset import

Puddle can import OSV-5M, Mapillary Street-level Sequences (MSLS), and
YFCC100M through one canonical path. The import is metadata-first and has no
implicit total-location cap.

## Pipeline

1. Extract OSV-5M and MSLS on the Legion's local SSD. Keep the extracted data
   outside OneDrive to avoid sync contention. YFCC100M can be processed later
   from its metadata plus local Multimedia Commons media, or with the explicit
   remote-media option.
2. `build_bulk_photo_manifest.py` streams metadata, rejects records without
   coordinates, an approved license, a provider identity, or usable media,
   spatially maps the remainder to the active B2 location snapshot, and writes
   a local Parquet manifest. It does not read image bytes or upload anything.
3. `materialize_photo_candidates.py --bulk-manifest ...` reads each staged
   image into memory, validates and normalizes it to canonical JPEG, computes
   SHA-256 and perceptual hashes, reserves the provider/source identity, and
   claims exact/near-duplicate identity in Supabase.
4. Only a claimed image is uploaded to the content-addressed B2 key
   `media/photos/by-sha256/<first-two>/<sha256>.jpg`. The claim is finalized
   only after B2 size and metadata verification.
5. The materializer appends the location/photo metadata. Run the normal photo
   overlay publisher afterward to create the compact searchable reference.

OSV-5M and MSLS both use provider `mapillary`, preserving provider-level
deduplication when the same Mapillary asset occurs in both datasets. YFCC100M
uses provider `yfcc100m` (registry code `4`). The database migration extends
the provider registry and adds a recovery lookup for a worker crash between
claim finalization and metadata append.

The manifest builder requires DuckDB. The materializer uses the repository's
existing Python image and B2 dependencies. A local setup can install the
minimum packages with:

```powershell
python -m pip install duckdb boto3 pillow brotli orjson urllib3
```

## Pilot

Use an explicit record bound only for a pilot. It is not used by the full run.

```powershell
python scripts/global-data/build_bulk_photo_manifest.py `
  --snapshot 2026-08-28 `
  --osv-root D:\puddle-data\osv5m `
  --msls-root D:\puddle-data\msls `
  --countries CA `
  --max-records 5000 `
  --output D:\puddle-data\photo-pilot.parquet `
  --report D:\puddle-data\photo-pilot.report.json

python scripts/global-data/materialize_photo_candidates.py `
  --snapshot 2026-08-28 `
  --countries CA `
  --max-locations 100 `
  --bulk-manifest D:\puddle-data\photo-pilot.parquet

python scripts/global-data/build_b2_photo_search_overlay.py --snapshot 2026-08-28
python scripts/global-data/verify_photo_pilot.py --snapshot 2026-08-28
```

The pilot must pass before the full import. The pilot bounds are explicit
commands, not production defaults.

## Full resumable import

After the pilot and the `20260828120000_bulk_photo_provider.sql` migration are
applied, build the manifest without `--max-records`, then omit
`--max-locations` from the materializer:

```powershell
python scripts/global-data/build_bulk_photo_manifest.py `
  --snapshot 2026-08-28 `
  --osv-root D:\puddle-data\osv5m `
  --msls-root D:\puddle-data\msls `
  --output D:\puddle-data\photo-bulk.parquet

python scripts/global-data/materialize_photo_candidates.py `
  --snapshot 2026-08-28 `
  --bulk-manifest D:\puddle-data\photo-bulk.parquet

python scripts/global-data/build_b2_photo_search_overlay.py --snapshot 2026-08-28
```

The materializer's runtime budget is a resumability boundary, not a dataset
cap. Candidate leases, provider/source identity, content hashes, and canonical
B2 keys let a later run continue without reaccepting already materialized
assets. The overlay is rebuilt after each completed materializer run so only
verified canonical B2 objects become searchable.

## YFCC100M

YFCC100M's core download is metadata; the original media is a separate
collection and some records no longer have an available file. For a local-only
run, provide `--yfcc-media-root` (and `--yfcc-hash-map` when the files are
stored by Multimedia Commons MD5 path). To permit approved Flickr image URLs
for records without a staged file, add `--allow-yfcc-remote`; this moves the
download to the Legion and still keeps the same local normalization and B2
claim gate.

Only CC0, public-domain, CC BY, and CC BY-SA records are accepted. NC and ND
licenses are rejected because Puddle transforms the bytes into an optimized
canonical JPEG. Attribution and the original license URL are retained in the
metadata written to B2.

Dataset references: [OSV-5M](https://github.com/gastruc/osv5m),
[MSLS](https://github.com/mapillary/mapillary_sls), and the
[YFCC100M core dataset](https://multimediacommons.wordpress.com/yfcc100m-core-dataset/).
