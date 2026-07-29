-- Narrow profile-read policies required by Stage 4 coordination views.
-- Apply after 0009_plans_rsvps_and_collaboration.sql.

create policy "accepted friends read profiles" on public.profiles for select using (
  exists(select 1 from public.friendships f where f.state='accepted' and (
    (f.requester_id=auth.uid() and f.addressee_id=profiles.id)
    or (f.addressee_id=auth.uid() and f.requester_id=profiles.id)
  ))
);

create policy "event managers read attendee profiles" on public.profiles for select using (
  exists(select 1 from public.event_rsvps r where r.profile_id=profiles.id and (
    public.can_manage_event(r.event_id) or public.can_checkin_event(r.event_id) or public.is_admin()
  ))
);

create policy "plan members read participant profiles" on public.profiles for select using (
  exists(select 1 from public.plan_members pm where pm.profile_id=profiles.id and public.is_plan_member(pm.plan_id))
);
