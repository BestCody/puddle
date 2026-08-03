import { readFile, writeFile } from 'node:fs/promises'

const path = 'supabase/migrations/10026_r2_runtime_optimizations.sql'
let source = await readFile(path, 'utf8')

const replacements = [
  [
    "if auth.uid() is null and coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then",
    "if auth.uid() is null and coalesce(auth.role()::text,'') <> 'service_role' then"
  ],
  [
    `  if is_static_ephemeral and action_name in ('dismissed','undo') then
    return public.record_static_catalogue_action_v1(
      target_id,static_source,static_source_place_id,action_name,request_key
    );
  end if;`,
    `  if is_static_ephemeral and action_name='dismissed' then
    return public.record_static_catalogue_action_v1(
      target_id,static_source,static_source_place_id,action_name,request_key
    );
  end if;
  if is_static_ephemeral and action_name='undo' and not exists(select 1 from public.locations where id=target_id) then
    return public.record_static_catalogue_action_v1(
      target_id,static_source,static_source_place_id,action_name,request_key
    );
  end if;`
  ],
  [
    `  perform pg_advisory_xact_lock(hashtextextended(import_source||':'||source_id,0));
  select location_id into mapped_location`,
    `  perform pg_advisory_xact_lock(hashtextextended(import_source||':'||source_id,0));
  if exists(
    select 1 from public.locations location
    where location.id=target_location
      and not exists(
        select 1 from public.location_source_links link
        where link.location_id=location.id and link.source=import_source and link.source_place_id=source_id
      )
  ) then
    raise exception 'deterministic location id is already in use';
  end if;
  select location_id into mapped_location`
  ]
]

for (const [before, after] of replacements) {
  if (!source.includes(before)) throw new Error(`Migration patch marker is missing: ${before.slice(0, 80)}`)
  source = source.replace(before, after)
}

await writeFile(path, source)
console.log('Applied R2 migration correctness fixes.')
