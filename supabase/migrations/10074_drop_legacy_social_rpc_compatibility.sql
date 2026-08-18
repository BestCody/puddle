-- Remove temporary social RPC compatibility wrappers after the application cutover to bounded v2 contracts.
-- Historical migrations stay immutable; this forward migration removes only the obsolete runtime surface.

drop function if exists public.social_friend_search_v1(text);
drop function if exists public.pass_message_search_v1(text);
drop function if exists public.social_friends_v1();
drop function if exists public.social_conversations_v1();
drop function if exists public.social_messages_v1(uuid);
