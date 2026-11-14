create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table public.data_sources (
  id bigint generated always as identity primary key,
  name text not null,
  url text not null,
  publisher text,
  accessed_on date,
  notes text
);

create table public.candidate_sites (
  id bigint generated always as identity primary key,
  name text not null,
  location extensions.geography(Point, 4326) not null,
  external_id text unique,
  address text,
  urban_heat_effect_f numeric(6,3) check (urban_heat_effect_f >= 0),
  canopy_coverage_percent numeric(5,2) check (canopy_coverage_percent between 0 and 100),
  heat_score numeric(5,2) check (heat_score between 0 and 100),
  canopy_gap_score numeric(5,2) check (canopy_gap_score between 0 and 100),
  vulnerability_score numeric(5,2) check (vulnerability_score between 0 and 100),
  priority_score numeric(5,2) generated always as (
    case when heat_score is not null and canopy_gap_score is not null and vulnerability_score is not null
      then round(heat_score * 0.4 + canopy_gap_score * 0.35 + vulnerability_score * 0.25, 2)
      when heat_score is not null and canopy_gap_score is not null
      then round((heat_score * 0.4 + canopy_gap_score * 0.35) / 0.75, 2)
    end
  ) stored,
  heat_source_id bigint references public.data_sources(id),
  canopy_source_id bigint references public.data_sources(id),
  vulnerability_source_id bigint references public.data_sources(id),
  feasibility_status text not null default 'unverified'
    check (feasibility_status in ('unverified', 'needs_review', 'approved', 'rejected')),
  feasibility_notes text,
  site_source_id bigint references public.data_sources(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index candidate_sites_location_idx on public.candidate_sites using gist (location);
create index candidate_sites_priority_idx on public.candidate_sites (priority_score desc nulls last);

create table public.planting_projects (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.project_sites (
  project_id bigint not null references public.planting_projects(id) on delete cascade,
  site_id bigint not null references public.candidate_sites(id) on delete cascade,
  primary key (project_id, site_id)
);

create view public.candidate_site_map with (security_invoker = true) as
select id, name, address, extensions.st_y(location::extensions.geometry) as latitude,
  extensions.st_x(location::extensions.geometry) as longitude,
  urban_heat_effect_f, canopy_coverage_percent,
  heat_score, canopy_gap_score, vulnerability_score, priority_score,
  feasibility_status, feasibility_notes
from public.candidate_sites;

alter table public.data_sources enable row level security;
alter table public.candidate_sites enable row level security;
alter table public.planting_projects enable row level security;
alter table public.project_sites enable row level security;

create policy "Public can read sources" on public.data_sources for select using (true);
create policy "Public can read sites" on public.candidate_sites for select using (true);
create policy "Owners manage projects" on public.planting_projects for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners manage project sites" on public.project_sites for all to authenticated
  using (exists (select 1 from public.planting_projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.planting_projects p where p.id = project_id and p.owner_id = (select auth.uid())));
