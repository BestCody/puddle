-- Puddle discovers events and locations, never people.
-- Remove legacy prototype fields and tables that implied dating or profile swiping.

alter table public.profiles drop constraint if exists dating_requires_adult;
alter table public.profiles drop column if exists social_matching_enabled;
alter table public.profiles drop column if exists dating_enabled;

drop table if exists public.matches cascade;
drop table if exists public.profile_swipes cascade;

-- Keep the legacy role column only for protected staff privileges until the admin migration.
comment on column public.profiles.role is 'Legacy privilege field for protected staff capabilities; not an attendee or organizer account type.';
