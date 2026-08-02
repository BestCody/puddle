-- Follow-up hardening for catalogue batch result names and malformed payloads.

create or replace function public.upsert_open_catalogue_batch_v1(
  import_source text,
  payloads jsonb
)
returns table(source_place_id text, location_id uuid, error_message text)
language plpgsql
security definer
set search_path=public
as $$
declare
  item jsonb;
  item_source_place_id text;
  item_location_id uuid;
  item_error_message text;
  item_latitude double precision;
  item_longitude double precision;
begin
  if jsonb_typeof(payloads) <> 'array' then
    raise exception 'catalogue payload must be an array';
  end if;
  if jsonb_array_length(payloads) > 200 then
    raise exception 'catalogue batch exceeds 200 records';
  end if;

  for item in select value from jsonb_array_elements(payloads) loop
    item_source_place_id := left(coalesce(item->>'source_place_id',''),240);
    item_location_id := null;
    item_error_message := null;

    begin
      if nullif(item->>'latitude','') is null or nullif(item->>'longitude','') is null then
        raise exception 'invalid place coordinates';
      end if;
      item_latitude := (item->>'latitude')::double precision;
      item_longitude := (item->>'longitude')::double precision;
      if item_latitude not between -90 and 90 or item_longitude not between -180 and 180 then
        raise exception 'invalid place coordinates';
      end if;

      item_location_id := public.upsert_open_catalogue_location_v1(import_source,item);
    exception when others then
      item_location_id := null;
      item_error_message := left(sqlerrm,500);
    end;

    source_place_id := item_source_place_id;
    location_id := item_location_id;
    error_message := item_error_message;
    return next;
  end loop;
end;
$$;

revoke all on function public.upsert_open_catalogue_batch_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_open_catalogue_batch_v1(text,jsonb) to service_role;
