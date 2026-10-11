"""Native immutable keyed projections for the existing self-hosted catalogue."""
import hashlib
import json
import os
import sqlite3
import tempfile
import re
import time
from contextlib import closing
from pathlib import Path


def catalogue_identity(manifest_key: str, ledger_sha: str) -> str:
    return hashlib.sha256(f'{manifest_key}:{ledger_sha}'.encode()).hexdigest()


def metadata(db, values):
    db.executemany('insert into metadata values(?,?)', ((key, str(value)) for key, value in values.items()))


def validate_slug_targets(db):
    # ORDER BY enables a sorted merge with the existing ID index, rather than
    # one random ID-index lookup for each of the ~30 million slug rows.
    if db.execute('select location_id from slugs except select id from locations order by 1 limit 1').fetchone():
        raise RuntimeError('Catalogue index contains a dangling slug.')


def write_photo_index(entries, manifest_key: str, directory: str) -> dict:
    root = Path(directory)
    if not root.is_absolute() or not root.is_dir():
        raise RuntimeError('Indexed data directory must be an existing absolute directory.')
    canonical = sorted(entries, key=lambda entry: entry[0])
    identity = hashlib.sha256(manifest_key.encode() + b'\n' + json.dumps(canonical, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    target = root / f'photos-{identity}.sqlite'
    if target.exists():
        with closing(sqlite3.connect(f'file:{target}?mode=ro', uri=True)) as existing:
            values = dict(existing.execute('select key,value from metadata'))
        if values.get('complete') != '1' or values.get('schema_version') != '1' or values.get('kind') != 'photos' or values.get('data_sha256') != identity or values.get('source_manifest_key') != manifest_key or values.get('photo_count') != str(len(canonical)):
            raise RuntimeError('Existing immutable photo index differs.')
        return {'schema_version': 1, 'data_sha256': identity}
    handle, name = tempfile.mkstemp(prefix='.photos-', suffix='.sqlite', dir=root)
    os.close(handle)
    staged = Path(name)
    try:
        with closing(sqlite3.connect(staged)) as db, db:
            db.executescript('create table metadata(key text primary key,value text not null) without rowid; create table photos(location_id text primary key,photo text not null) without rowid;')
            db.executemany('insert into photos values(?,?)', ((identifier, json.dumps(photo, separators=(',', ':'), ensure_ascii=False)) for identifier, photo in canonical))
            metadata(db, {'schema_version': 1, 'complete': 1, 'kind': 'photos', 'data_sha256': identity,
                          'source_manifest_key': manifest_key, 'photo_count': len(canonical)})
            if db.execute('pragma quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('Photo index integrity check failed.')
        staged.chmod(0o644)
        os.replace(staged, target)
    finally:
        staged.unlink(missing_ok=True)
    return {'schema_version': 1, 'data_sha256': identity}


def prune_inactive_photo_indices(directory: str, active_identity: str):
    """Retire only our inactive metadata derivatives, after the maximum reader TTL.

    This never removes catalogue files or photo bytes. The grace period lets
    requests using a cached previous pointer open their immutable metadata file.
    """
    root = Path(directory)
    if not root.is_absolute() or root.resolve() == Path(root.anchor) or not re.fullmatch(r'[a-f0-9]{64}', active_identity):
        raise RuntimeError('Photo index cleanup requires a dedicated directory and active identity.')
    for candidate in root.glob('photos-*.sqlite'):
        match = re.fullmatch(r'photos-([a-f0-9]{64})\.sqlite', candidate.name)
        if not match or match[1] == active_identity or candidate.is_symlink() or time.time() - candidate.stat().st_mtime < 15 * 60:
            continue
        try:
            with closing(sqlite3.connect(f'file:{candidate}?mode=ro', uri=True)) as db:
                values = dict(db.execute('select key,value from metadata'))
        except sqlite3.DatabaseError:
            continue # An unknown/corrupt file is not safe to delete as our cache.
        if values.get('kind') == 'photos' and values.get('complete') == '1' and values.get('data_sha256') == match[1]:
            candidate.unlink()
