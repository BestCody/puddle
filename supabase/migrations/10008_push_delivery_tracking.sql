alter table public.app_notifications
  add column if not exists push_delivered_at timestamptz,
  add column if not exists push_attempts integer not null default 0 check (push_attempts between 0 and 100),
  add column if not exists push_last_error text;

create index if not exists app_notifications_push_pending_idx
  on public.app_notifications(created_at)
  where push_delivered_at is null;
