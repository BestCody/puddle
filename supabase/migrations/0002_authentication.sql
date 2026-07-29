-- Authentication, onboarding, profile lifecycle, and security-event support.
-- Apply after 0001_puddle_core.sql.

alter table public.profiles add column if not exists interests text[] not null default '{}';
alter table public.profiles add column if not exists onboarding_completed_at timestamptz;
alter table public.profiles add column if not exists notification_preferences jsonb not null default '{"product":true,"social":true,"event_reminders":true,"marketing":false}'::jsonb;
alter table public.profiles alter column display_name set default 'Puddle person';

create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles(id) on delete cascade,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.account_deletion_requests (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz,
  completed_at timestamptz
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1), 'Puddle person')
  )
  on conflict (id) do nothing;
  insert into public.security_events (profile_id, event_type, metadata)
  values (new.id, 'account_created', jsonb_build_object('provider', coalesce(new.raw_app_meta_data->>'provider', 'email')));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.profiles (id, display_name)
select id, coalesce(nullif(trim(raw_user_meta_data->>'display_name'), ''), split_part(email, '@', 1), 'Puddle person')
from auth.users
on conflict (id) do nothing;

alter table public.security_events enable row level security;
alter table public.account_deletion_requests enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles self insert') then
    create policy "profiles self insert" on public.profiles for insert with check (id=auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='security_events' and policyname='security events self read') then
    create policy "security events self read" on public.security_events for select using (profile_id=auth.uid() or public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='security_events' and policyname='security events self insert') then
    create policy "security events self insert" on public.security_events for insert with check (profile_id=auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='account_deletion_requests' and policyname='deletion requests self manage') then
    create policy "deletion requests self manage" on public.account_deletion_requests for all using (profile_id=auth.uid() or public.is_admin()) with check (profile_id=auth.uid() or public.is_admin());
  end if;
end $$;
