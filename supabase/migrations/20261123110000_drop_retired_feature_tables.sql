-- Drop 33 tables left behind by retired features (event ticketing, payouts
-- and Stripe Connect, plan polls and stops, live location sharing, host follows,
-- close friends, message reactions and media, recommendation experiments,
-- account-signal and audit tables nothing writes) and the 43 functions that
-- only they used.
--
-- Checked against production on 2026-11-23: no live table holds a foreign key
-- into these tables; nothing in app/, lib/, components/, scripts/ or the SQL
-- tests CI runs references them; 30 are empty. The non-empty ones
-- (content_categories 10 rows, recommendation_ranking_configs 2,
-- payment_configuration 1) were exported on the server before this ran.
-- Tables the service-role moderation backend uses (moderation_actions, reports,
-- system_notices, linked_account_signals) and google_places_sku_monthly_usage,
-- which location_architecture_integrity.sql requires, are kept.

drop table if exists
  public.abuse_risk_signals, public.account_deletion_requests, public.audit_logs,
  public.content_categories, public.context_arrival_statuses,
  public.ephemeral_location_points, public.event_checkins, public.friend_close_friends,
  public.host_follows, public.inventory_reservations, public.ledger_entries,
  public.ledger_journals, public.location_access_logs, public.message_media,
  public.message_reactions, public.payment_configuration, public.plan_availability,
  public.plan_messages, public.plan_poll_options, public.plan_polls, public.plan_stops,
  public.plan_votes, public.promo_redemptions, public.recommendation_eligibility_logs,
  public.recommendation_metrics, public.recommendation_ranking_configs,
  public.reconciliation_items, public.reconciliation_runs, public.shared_meeting_points,
  public.stripe_connected_accounts, public.stripe_webhook_events,
  public.ticket_checkin_events, public.ticket_transfers
  cascade;

-- Function bodies are not dependency-tracked, so drop every overload by name.
do $$
declare
  target regprocedure;
begin
  for target in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'accept_ticket_transfer_v1', 'activate_recommendation_ranking_v1',
        'add_plan_stop_v1', 'apply_stripe_refund_update_v1', 'archive_ticket_tier_v1',
        'attach_checkout_session_v1', 'block_profile_v1', 'cancel_order_reservation_v1',
        'cancel_ticket_transfer_v1', 'check_in_attendee_v1', 'check_in_ticket_v1',
        'claim_stripe_webhook_events_v1', 'complete_stripe_webhook_event_v1',
        'event_checkin_dashboard_v1', 'event_ticketing_dashboard_v1',
        'expire_location_shares_v1', 'expire_ticket_reservations_v1',
        'expire_ticket_transfers_v1', 'follow_host_v1', 'fulfill_paid_order_v1',
        'order_checkout_payload_v1', 'public_ticket_tiers_v1', 'react_message_v1',
        'record_abuse_risk_signal_v1', 'record_stripe_dispute_v1',
        'record_stripe_payout_v1', 'remove_friend_v1', 'request_event_publication',
        'request_order_refund_v1', 'request_ticket_transfer_v1',
        'reserve_paid_order_v1', 'reverse_ticket_checkin_v1',
        'run_stage5_reconciliation_v1', 'send_host_announcement_v1',
        'set_arrival_status_v1', 'set_close_friend_v1', 'set_paid_ticketing_v1',
        'set_shared_meeting_point_v1', 'social_block_profile_v1',
        'social_remove_friend_v1', 'start_location_share_v1', 'stop_location_share_v1',
        'view_location_share_v1'
      ])
  loop
    execute format('drop function %s', target);
  end loop;
end
$$;
