-- Local Stage 1 seed data. Supabase CLI runs this after migrations during `supabase db reset`.
insert into public.content_categories (slug,label,content_kind,icon,sort_order) values
  ('live-music','Live music','both','♫',10),
  ('food-drink','Food & drink','both','✦',20),
  ('arts-culture','Arts & culture','both','◇',30),
  ('outdoors','Outdoors','both','☀',40),
  ('sports','Sports','both','●',50),
  ('workshops','Workshops','event','✎',60),
  ('cafes','Cafés','location','☕',80),
  ('local-gems','Local gems','location','⌖',100)
on conflict (slug) do update set label=excluded.label,content_kind=excluded.content_kind,icon=excluded.icon,sort_order=excluded.sort_order,active=true;

-- The public starter locations are inserted idempotently by migration 0003 so preview,
-- staging, and local databases all receive the same initial discovery content.
