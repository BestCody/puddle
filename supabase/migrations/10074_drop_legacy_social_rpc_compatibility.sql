-- Remove temporary social RPC compatibility wrappers after the application cutover to bounded v2 contracts.
-- Historical migrations stay immutable; this forward migration removes only obsolete runtime surfaces.

drop function if exists public.social_friend_search_v1(text);
drop function if exists public.pass_message_search_v1(text);
drop function if exists public.social_friends_v1();
drop function if exists public.social_conversations_v1();
drop function if exists public.social_messages_v1(uuid);

-- The next cleanup migration removes the retired shared-deck tables and their membership helper.
-- Drop only the read policies that directly depend on is_date_match_member(uuid) first so the helper
-- can be retired without CASCADE. The tables themselves are removed immediately by migration 10075.
drop policy if exists date_match_decks_read on public.date_match_decks;
drop policy if exists date_match_members_read on public.date_match_members;
drop policy if exists date_match_items_read on public.date_match_items;
drop policy if exists date_match_matches_read on public.date_match_matches;
