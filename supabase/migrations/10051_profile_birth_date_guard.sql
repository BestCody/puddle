-- Enforce the same birth-date rules at the database boundary that onboarding
-- applies in the application: real date values are already guaranteed by the
-- date type; profiles with a birth date must be 13–120 years old and cannot be
-- dated in the future.

create or replace function public.enforce_profile_birth_date_v1()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  years_old integer;
begin
  if new.birth_date is null then
    return new;
  end if;

  if new.birth_date > current_date then
    raise exception 'Birth date cannot be in the future.' using errcode = '22007';
  end if;

  years_old := extract(year from age(current_date, new.birth_date))::integer;
  if years_old < 13 then
    raise exception 'Puddle accounts require users to be at least 13.' using errcode = '23514';
  end if;
  if years_old > 120 then
    raise exception 'Birth date is outside the supported range.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_birth_date_guard_v1 on public.profiles;
create trigger profiles_birth_date_guard_v1
before insert or update of birth_date on public.profiles
for each row execute function public.enforce_profile_birth_date_v1();
