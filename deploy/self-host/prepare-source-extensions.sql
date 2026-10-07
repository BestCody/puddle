\set ON_ERROR_STOP on

-- Match the managed project's installed extensions before the rehearsal restore.
create extension if not exists postgis with schema public;
create extension if not exists vector with schema extensions;
