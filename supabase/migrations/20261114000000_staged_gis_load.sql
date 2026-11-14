-- Detailed footprint geometry is too large for one monolithic JSON RPC payload.
-- The Python loader COPYs individual records to a transaction-local staging table.
create function public.load_heatshield_staged() returns void
language plpgsql security invoker set search_path='' as $$
begin
 if (select count(*) from pg_temp.heatshield_load_stage where kind='study') <> 11
    or (select count(*) from pg_temp.heatshield_load_stage where kind='area') < 11 then
   raise exception 'Incomplete regional staging data';
 end if;
 insert into public.source_catalog(id,metadata,retrieved_at)
 select payload->>'id',payload,(payload->>'loaded_retrieval_at')::timestamptz
 from pg_temp.heatshield_load_stage where kind='source'
 on conflict(id) do update set metadata=excluded.metadata,retrieved_at=excluded.retrieved_at;
 insert into public.study_areas(id,name,geom)
 select payload->>'id',payload->>'name',extensions.st_setsrid(extensions.st_geomfromgeojson((payload->'geometry')::text),4326)
 from pg_temp.heatshield_load_stage where kind='study'
 on conflict(id) do update set name=excluded.name,geom=excluded.geom;
 delete from public.statistical_areas
 where study_id in (select payload->>'id' from pg_temp.heatshield_load_stage where kind='study');
 insert into public.statistical_areas(id,study_id,geoid,geom)
 select payload->>'id',payload->>'study_id',payload->>'geoid',
 extensions.st_setsrid(extensions.st_geomfromgeojson((payload->'geometry')::text),4326)
 from pg_temp.heatshield_load_stage where kind='area';
 insert into public.environmental_indicators(area_id,source_id,poverty_estimate,poverty_universe,poverty_moe,universe_moe,canopy_percent,surface_temperature_c,environmental_metadata)
 select payload->>'id','acs2024',(payload->>'poverty_estimate')::numeric,
 (payload->>'poverty_universe')::numeric,(payload->>'poverty_moe')::numeric,(payload->>'universe_moe')::numeric,
 (payload->'environment'->>'canopy_percent')::numeric,(payload->'environment'->>'surface_temperature_c')::numeric,
 coalesce(payload->'environment','{}'::jsonb)
 from pg_temp.heatshield_load_stage where kind='area';
 insert into public.planting_areas(area_id,score,method,screening_geom)
 select payload->>'id',(payload->>'score')::numeric,coalesce(payload->>'score_method','acs-poverty-share-v1'),
 case when payload->'screening_geometry' is not null and payload->'screening_geometry'<>'null'::jsonb
 then extensions.st_setsrid(extensions.st_geomfromgeojson((payload->'screening_geometry')::text),4326) else null end
 from pg_temp.heatshield_load_stage where kind='area';
end $$;
revoke all on function public.load_heatshield_staged() from public,anon,authenticated;
grant execute on function public.load_heatshield_staged() to service_role;
