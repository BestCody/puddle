-- Storage files cannot be removed by a foreign-key cascade. Preserve their
-- keys in the same transaction that deletes media_assets, then remove bytes
-- through the Storage API outside the database transaction.
create table public.media_object_deletion_jobs (
  id bigint generated always as identity primary key,
  bucket_id text not null check (bucket_id in ('puddle-public-media', 'puddle-private-media', 'puddle-quarantine')),
  object_path text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'error')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

create index media_object_deletion_jobs_due_idx
  on public.media_object_deletion_jobs(next_attempt_at, created_at)
  where status in ('pending', 'error');

alter table public.media_object_deletion_jobs enable row level security;
revoke all on public.media_object_deletion_jobs from public, anon, authenticated;
revoke all on sequence public.media_object_deletion_jobs_id_seq from public, anon, authenticated;
grant select, insert, update, delete on public.media_object_deletion_jobs to service_role;
grant usage, select on sequence public.media_object_deletion_jobs_id_seq to service_role;

create function public.queue_deleted_media_object_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.media_object_deletion_jobs(bucket_id, object_path)
  values (old.bucket_id, old.object_path)
  on conflict (bucket_id, object_path) do nothing;
  return old;
end
$$;

create trigger queue_deleted_media_object
  after delete on public.media_assets
  for each row execute function public.queue_deleted_media_object_v1();

create function public.claim_media_object_deletion_jobs_v1(batch_size integer default 25)
returns table(id bigint, bucket_id text, object_path text, claim_attempt integer)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
  return query
    with claimed as (
      select j.id
      from public.media_object_deletion_jobs j
      where (j.status in ('pending', 'error') and j.next_attempt_at <= now())
         or (j.status = 'processing' and coalesce(j.locked_at, j.created_at) < now() - interval '30 minutes')
      order by j.created_at
      limit greatest(1, least(coalesce(batch_size, 25), 100))
      for update skip locked
    )
    update public.media_object_deletion_jobs j
       set status = 'processing', attempts = j.attempts + 1, locked_at = now(), last_error = null
      from claimed c
     where j.id = c.id
    returning j.id, j.bucket_id, j.object_path, j.attempts;
end
$$;

create function public.complete_media_object_deletion_job_v1(target_job bigint, expected_attempt integer, succeeded boolean, failure_reason text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
  if succeeded then
    delete from public.media_object_deletion_jobs
     where id = target_job and status = 'processing' and attempts = expected_attempt;
  else
    update public.media_object_deletion_jobs
       set status = 'error',
           next_attempt_at = now() + make_interval(mins => least(1440, greatest(5, attempts * attempts * 5))),
           last_error = left(coalesce(failure_reason, 'Storage removal failed'), 200)
     where id = target_job and status = 'processing' and attempts = expected_attempt;
  end if;
  return found;
end
$$;

revoke all on function public.queue_deleted_media_object_v1() from public, anon, authenticated;
revoke all on function public.claim_media_object_deletion_jobs_v1(integer) from public, anon, authenticated;
revoke all on function public.complete_media_object_deletion_job_v1(bigint,integer,boolean,text) from public, anon, authenticated;
grant execute on function public.claim_media_object_deletion_jobs_v1(integer) to service_role;
grant execute on function public.complete_media_object_deletion_job_v1(bigint,integer,boolean,text) to service_role;
