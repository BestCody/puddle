-- Post-cutover cleanup for the retired OpenSearch serving backend.
-- This migration is intentionally shipped only after B2 production cutover and
-- rollback validation. Historical migrations remain intact as migration history.

begin;

-- Runtime code no longer reads or writes the OpenSearch credential.
drop function if exists public.get_opensearch_runtime_auth();
drop function if exists public.set_opensearch_runtime_auth(text, text);

-- Remove the encrypted credential itself without ever materializing its plaintext.
delete from vault.secrets
where name = 'puddle_opensearch_runtime_auth';

-- Keep the existing authoring state machine but remove obsolete backend wording.
create or replace function public.transition_location_status(
  target uuid,
  next_status text,
  transition_note text default null::text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  current_state text;
  allowed boolean := false;
begin
  if not public.can_manage_location(target) then
    raise exception 'Not authorized to manage this location';
  end if;

  select status
    into current_state
    from public.location_submissions
   where id = target
   for update;

  if next_status = 'published' then
    raise exception 'Canonical B2 ingestion is required before publication';
  end if;

  allowed := (current_state = 'draft' and next_status in ('pending_review', 'archived'))
    or (current_state = 'pending_review' and next_status in ('draft', 'rejected', 'suspended', 'archived'))
    or (current_state in ('rejected', 'suspended') and next_status in ('draft', 'archived'));

  if not allowed then
    raise exception 'Invalid location status transition';
  end if;

  if next_status in ('rejected', 'suspended') and not public.is_admin() then
    raise exception 'A moderator must review this transition';
  end if;

  perform set_config('puddle.allow_status_transition', 'on', true);
  perform set_config('puddle.change_source', 'status', true);
  perform set_config('puddle.change_note', coalesce(transition_note, ''), true);

  update public.location_submissions
     set status = next_status,
         status_reason = transition_note,
         archived_at = case when next_status = 'archived' then now() else archived_at end
   where id = target;

  return next_status;
end
$function$;

commit;
