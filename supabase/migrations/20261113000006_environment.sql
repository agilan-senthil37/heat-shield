-- Satellite-derived environmental estimates and conservative screening masks.
-- Existing heat_observed_c remains NULL: surface temperature is a different quantity.
alter table public.environmental_indicators add column environmental_metadata jsonb not null default '{}'::jsonb;
alter table public.environmental_indicators add column surface_temperature_c numeric check(surface_temperature_c between -50 and 90);
alter table public.planting_areas add column screening_geom extensions.geometry(MultiPolygon,4326);
alter table public.planting_areas add constraint screening_geom_valid check(screening_geom is null or extensions.st_isvalid(screening_geom));
create index planting_areas_screening_idx on public.planting_areas using gist(screening_geom);

alter function public.load_heatshield_bundle(jsonb) rename to load_heatshield_bundle_base;
create function public.load_heatshield_bundle(b jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare r jsonb;
begin
 perform public.load_heatshield_bundle_base(b);
 for r in select value from jsonb_array_elements(b->'areas') loop
   update public.environmental_indicators set
     canopy_percent=(r->'environment'->>'canopy_percent')::numeric,
     surface_temperature_c=(r->'environment'->>'surface_temperature_c')::numeric,
     environmental_metadata=coalesce(r->'environment','{}'::jsonb)
   where area_id=r->>'id';
   update public.planting_areas set method=coalesce(r->>'score_method','acs-poverty-share-v1'),
     screening_geom=case when r->'screening_geometry' is not null and r->'screening_geometry'<>'null'::jsonb
       then extensions.st_setsrid(extensions.st_geomfromgeojson((r->'screening_geometry')::text),4326) else null end
   where area_id=r->>'id';
 end loop;
end $$;
revoke all on function public.load_heatshield_bundle(jsonb) from public,anon,authenticated;
grant execute on function public.load_heatshield_bundle(jsonb) to service_role;
create view public.environmental_candidates with(security_invoker=true) as
select c.*,i.surface_temperature_c,i.environmental_metadata,
  extensions.st_asgeojson(p.screening_geom)::jsonb as screening_geometry
from public.regional_candidates c
join public.environmental_indicators i on i.area_id=c.id
join public.planting_areas p on p.area_id=c.id;
grant select on public.environmental_candidates to anon,authenticated;
