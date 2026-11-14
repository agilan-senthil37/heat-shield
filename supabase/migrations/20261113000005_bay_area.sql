create or replace function public.load_heatshield_bundle(b jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare r jsonb;
begin
 if jsonb_array_length(b->'studies') <> 11 or jsonb_array_length(b->'areas') < 11 then
 raise exception 'Incomplete bundle'; end if;
 for r in select value from jsonb_array_elements(b->'sources') loop
 insert into public.source_catalog(id,metadata,retrieved_at) values
 (r->>'id',r,(b->>'retrieved_at')::timestamptz)
 on conflict(id) do update set metadata=excluded.metadata,retrieved_at=excluded.retrieved_at;
 end loop;
 for r in select value from jsonb_array_elements(b->'studies') loop
 insert into public.study_areas(id,name,geom) values(r->>'id',r->>'name',extensions.st_setsrid(extensions.st_geomfromgeojson((r->'geometry')::text),4326))
 on conflict(id) do update set name=excluded.name,geom=excluded.geom;
 delete from public.statistical_areas where study_id=r->>'id';
 end loop;
 for r in select value from jsonb_array_elements(b->'areas') loop
 insert into public.statistical_areas values(r->>'id',r->>'study_id',r->>'geoid',extensions.st_setsrid(extensions.st_geomfromgeojson((r->'geometry')::text),4326));
 insert into public.environmental_indicators(area_id,source_id,poverty_estimate,poverty_universe,poverty_moe,universe_moe)
 values(r->>'id','acs2024',(r->>'poverty_estimate')::numeric,(r->>'poverty_universe')::numeric,(r->>'poverty_moe')::numeric,(r->>'universe_moe')::numeric);
 insert into public.planting_areas(area_id,score) values(r->>'id',(r->>'score')::numeric);
 end loop;
end $$;
revoke all on function public.load_heatshield_bundle(jsonb) from public,anon,authenticated;
grant execute on function public.load_heatshield_bundle(jsonb) to service_role;

create view public.regional_candidates with (security_invoker=true) as select id,city as study_area,geoid,score,method,status,geometry,poverty_estimate,poverty_universe,poverty_moe,universe_moe,heat_observed_c,canopy_percent from public.heatshield_candidates;
grant select on public.regional_candidates to anon,authenticated;
