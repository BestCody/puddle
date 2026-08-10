-- Add Google Places Autocomplete Requests as the fourth capped no-cost
-- verification tier after Text Search Pro, Place Details Pro, and Place
-- Details Essentials. The existing service-role-only ledger remains the
-- single source of truth for worker-side hard caps.

alter table public.google_places_sku_monthly_usage
  drop constraint if exists google_places_sku_monthly_usage_sku_check;

alter table public.google_places_sku_monthly_usage
  add constraint google_places_sku_monthly_usage_sku_check
  check (sku in (
    'text_search_pro',
    'place_details_pro',
    'place_details_essentials',
    'autocomplete_requests'
  ));

create or replace function public.reserve_google_places_free_sku_v1(target_sku text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  current_month date := date_trunc('month',now() at time zone 'UTC')::date;
  hard_limit integer;
  used integer;
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  hard_limit := case target_sku
    when 'text_search_pro' then 5000
    when 'place_details_pro' then 5000
    when 'place_details_essentials' then 10000
    when 'autocomplete_requests' then 10000
    else null
  end;
  if hard_limit is null then raise exception 'unsupported Google Places SKU'; end if;

  insert into public.google_places_sku_monthly_usage(month_start,sku)
  values(current_month,target_sku)
  on conflict(month_start,sku) do nothing;

  select requests_used into used
  from public.google_places_sku_monthly_usage
  where month_start=current_month and sku=target_sku
  for update;

  if used>=hard_limit then
    return jsonb_build_object(
      'allowed',false,'sku',target_sku,'monthStart',current_month,
      'used',used,'limit',hard_limit,'remaining',0
    );
  end if;

  update public.google_places_sku_monthly_usage
  set requests_used=requests_used+1,updated_at=now()
  where month_start=current_month and sku=target_sku;

  return jsonb_build_object(
    'allowed',true,'sku',target_sku,'monthStart',current_month,
    'used',used+1,'limit',hard_limit,'remaining',hard_limit-used-1
  );
end;
$$;

create or replace function public.release_google_places_free_sku_v1(target_sku text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  current_month date := date_trunc('month',now() at time zone 'UTC')::date;
  used integer;
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  if target_sku not in ('text_search_pro','place_details_pro','place_details_essentials','autocomplete_requests') then
    raise exception 'unsupported Google Places SKU';
  end if;

  update public.google_places_sku_monthly_usage
  set requests_used=greatest(0,requests_used-1),updated_at=now()
  where month_start=current_month and sku=target_sku
  returning requests_used into used;

  return jsonb_build_object('released',used is not null,'sku',target_sku,'used',coalesce(used,0));
end;
$$;

create or replace function public.google_places_free_sku_usage_v1()
returns table(sku text, requests_used integer, monthly_limit integer, remaining integer)
language sql
stable
security definer
set search_path=public
as $$
  select limits.sku,
    coalesce(usage.requests_used,0)::integer,
    limits.monthly_limit,
    greatest(0,limits.monthly_limit-coalesce(usage.requests_used,0))::integer
  from (values
    ('text_search_pro'::text,5000::integer),
    ('place_details_pro'::text,5000::integer),
    ('place_details_essentials'::text,10000::integer),
    ('autocomplete_requests'::text,10000::integer)
  ) limits(sku,monthly_limit)
  left join public.google_places_sku_monthly_usage usage
    on usage.sku=limits.sku
   and usage.month_start=date_trunc('month',now() at time zone 'UTC')::date
  where coalesce(auth.role()::text,'')='service_role';
$$;

revoke all on function public.reserve_google_places_free_sku_v1(text) from public,anon,authenticated;
revoke all on function public.release_google_places_free_sku_v1(text) from public,anon,authenticated;
revoke all on function public.google_places_free_sku_usage_v1() from public,anon,authenticated;
grant execute on function public.reserve_google_places_free_sku_v1(text) to service_role;
grant execute on function public.release_google_places_free_sku_v1(text) to service_role;
grant execute on function public.google_places_free_sku_usage_v1() to service_role;
