-- Immutable serving derivatives. User/account data is never stored here.
create table metadata(key text primary key, value text not null) without rowid;
create table locations(
  id text not null,
  document blob not null,
  projection blob not null
);
create table slugs(slug text not null, location_id text not null);
-- Unique lookup indexes are built once after the append-only ingest. Building
-- them row by row would turn a sequential derivative build into random I/O.
create table completed_objects(
  object_key text primary key,
  kind text not null,
  sha256 text not null,
  row_count integer not null
) without rowid;
