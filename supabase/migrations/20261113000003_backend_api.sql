-- Read models for the map, site details, and project selections.
create view public.candidate_site_details with (security_invoker = true) as
select c.id, c.external_id, c.name, c.address,
  extensions.st_y(c.location::extensions.geometry) as latitude,
  extensions.st_x(c.location::extensions.geometry) as longitude,
  c.urban_heat_effect_f, c.canopy_coverage_percent,
  c.heat_score, c.canopy_gap_score, c.vulnerability_score, c.priority_score,
  c.feasibility_status, c.feasibility_notes,
  c.created_at, c.updated_at,
  s.url as site_source_url, h.url as heat_source_url,
  t.url as canopy_source_url, v.url as vulnerability_source_url
from public.candidate_sites c
left join public.data_sources s on s.id = c.site_source_id
left join public.data_sources h on h.id = c.heat_source_id
left join public.data_sources t on t.id = c.canopy_source_id
left join public.data_sources v on v.id = c.vulnerability_source_id;

create view public.project_site_details with (security_invoker = true) as
select ps.project_id, d.*
from public.project_sites ps
join public.candidate_site_details d on d.id = ps.site_id;

-- A bounded map query avoids downloading the entire candidate inventory.
create function public.candidate_sites_in_bbox(
  min_lon double precision, min_lat double precision,
  max_lon double precision, max_lat double precision,
  min_priority numeric default 0,
  result_limit integer default 100,
  result_offset integer default 0
)
returns setof public.candidate_site_details
language sql stable security invoker
set search_path = ''
as $$
  select d.*
  from public.candidate_sites c
  join public.candidate_site_details d on d.id = c.id
  where min_lon between -180 and 180 and max_lon between -180 and 180
    and min_lat between -90 and 90 and max_lat between -90 and 90
    and min_lon < max_lon and min_lat < max_lat
    and extensions.st_intersects(
      c.location::extensions.geometry,
      extensions.st_makeenvelope(min_lon, min_lat, max_lon, max_lat, 4326)
    )
    and c.priority_score >= greatest(0, least(100, coalesce(min_priority, 0)))
  order by c.priority_score desc nulls last, c.id
  limit greatest(0, least(coalesce(result_limit, 100), 500))
  offset greatest(0, coalesce(result_offset, 0));
$$;

create function public.set_site_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger candidate_sites_updated_at
before update on public.candidate_sites
for each row execute function public.set_site_updated_at();

create index project_sites_site_idx on public.project_sites (site_id);
create index planting_projects_owner_idx on public.planting_projects (owner_id);

-- GIS inventory changes are made only through privileged import credentials.
revoke all on public.data_sources, public.candidate_sites from anon, authenticated;
grant select on public.data_sources, public.candidate_sites to anon, authenticated;
grant select on public.candidate_site_map, public.candidate_site_details to anon, authenticated;
grant execute on function public.candidate_sites_in_bbox(double precision, double precision, double precision, double precision, numeric, integer, integer) to anon, authenticated;
grant select, insert, update, delete on public.planting_projects, public.project_sites to authenticated;
grant select on public.project_site_details to authenticated;
revoke all on public.planting_projects, public.project_sites, public.project_site_details from anon;
