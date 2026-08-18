-- Remove temporary social RPC compatibility wrappers after the application cutover to bounded v2 contracts.
-- Historical migrations stay immutable; this forward migration removes only obsolete runtime surfaces.

drop function if exists public.social_friend_search_v1(text);
drop function if exists public.pass_message_search_v1(text);
drop function if exists public.social_friends_v1();
drop function if exists public.social_conversations_v1();
drop function if exists public.social_messages_v1(uuid);

-- The next cleanup migration removes the retired shared-deck tables and their membership helper.
-- Drop read policies that depend on the membership helper or another shared-deck table first so
-- those runtime objects can be retired without CASCADE. The tables are removed immediately by 10075.
drop policy if exists date_match_decks_read on public.date_match_decks;
drop policy if exists date_match_members_read on public.date_match_members;
drop policy if exists date_match_items_read on public.date_match_items;
drop policy if exists date_match_matches_read on public.date_match_matches;
drop policy if exists date_match_room_versions_member_select on public.date_match_room_versions;
