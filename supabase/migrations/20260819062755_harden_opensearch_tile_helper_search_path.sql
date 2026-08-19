-- Pin search_path for pure Web Mercator helper functions introduced by the
-- OpenSearch heatmap/action cutover. They only use pg_catalog built-ins.

alter function public.web_mercator_tile_x_v1(double precision, integer) set search_path = pg_catalog;
alter function public.web_mercator_tile_y_v1(double precision, integer) set search_path = pg_catalog;
alter function public.web_mercator_tile_lon_v1(integer, integer) set search_path = pg_catalog;
alter function public.web_mercator_tile_lat_v1(integer, integer) set search_path = pg_catalog;
