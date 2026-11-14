create table public.source_catalog (
 id text primary key, metadata jsonb not null, retrieved_at timestamptz not null default now()
);
create table public.study_areas (
 id text primary key, name text not null unique,
 geom extensions.geometry(MultiPolygon,4326) not null,
 check (extensions.st_isvalid(geom) and not extensions.st_isempty(geom))
);
create table public.statistical_areas (
 id text primary key, study_id text not null references public.study_areas(id),
 geoid text not null, geom extensions.geometry(MultiPolygon,4326) not null,
 unique(study_id,geoid), check(extensions.st_isvalid(geom) and not extensions.st_isempty(geom))
);
create table public.environmental_indicators (
 area_id text primary key references public.statistical_areas(id) on delete cascade,
 source_id text not null references public.source_catalog(id),
 poverty_estimate numeric, poverty_universe numeric, poverty_moe numeric, universe_moe numeric,
 heat_observed_c numeric default null, canopy_percent numeric default null,
 updated_at timestamptz not null default now(),
 check(poverty_estimate >= 0 and poverty_universe >= poverty_estimate)
);
create table public.planting_areas (
 area_id text primary key references public.statistical_areas(id) on delete cascade,
 score numeric check(score between 0 and 100),
 method text not null default 'acs-poverty-share-v1',
 status text not null default 'screening_only' check(status='screening_only'),
 updated_at timestamptz not null default now()
);
create index study_areas_geom_idx on public.study_areas using gist(geom);
create index statistical_areas_geom_idx on public.statistical_areas using gist(geom);
create index statistical_areas_study_idx on public.statistical_areas(study_id);
create index planting_areas_score_idx on public.planting_areas(score desc nulls last);
alter table public.source_catalog enable row level security;
alter table public.study_areas enable row level security;
alter table public.statistical_areas enable row level security;
alter table public.environmental_indicators enable row level security;
alter table public.planting_areas enable row level security;
create policy public_read on public.source_catalog for select using(true);
create policy public_read on public.study_areas for select using(true);
create policy public_read on public.statistical_areas for select using(true);
create policy public_read on public.environmental_indicators for select using(true);
create policy public_read on public.planting_areas for select using(true);
revoke all on public.source_catalog,public.study_areas,public.statistical_areas,public.environmental_indicators,public.planting_areas from anon,authenticated;
grant select on public.source_catalog,public.study_areas,public.statistical_areas,public.environmental_indicators,public.planting_areas to anon,authenticated;
create view public.heatshield_candidates with (security_invoker=true) as
select a.id, s.name as city, a.geoid, p.score, p.method, p.status,
 extensions.st_asgeojson(a.geom)::jsonb as geometry,
 i.poverty_estimate,i.poverty_universe,i.poverty_moe,i.universe_moe,i.heat_observed_c,i.canopy_percent
from public.statistical_areas a join public.study_areas s on s.id=a.study_id
join public.planting_areas p on p.area_id=a.id join public.environmental_indicators i on i.area_id=a.id;
grant select on public.heatshield_candidates to anon,authenticated;
create function public.load_heatshield_bundle(b jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare r jsonb;
begin
 if jsonb_array_length(b->'studies') <> 2 or jsonb_array_length(b->'areas') < 2 then
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
