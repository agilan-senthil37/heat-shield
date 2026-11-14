-- Additive backend integration for regional screening areas.
-- Deliberately does not alter the legacy planting_projects/project_sites tables.
create table public.heatshield_proposals (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 project_name text not null check(length(project_name) between 1 and 120),
 selected_area_ids text[] not null check(cardinality(selected_area_ids) between 1 and 25),
 created_at timestamptz not null default now(),
 report jsonb not null check(jsonb_typeof(report)='object' and octet_length(report::text)<=1000000)
);
create index heatshield_proposals_owner on public.heatshield_proposals(owner_id);
alter table public.heatshield_proposals enable row level security;
revoke all on public.heatshield_proposals from anon,authenticated;
grant select,insert on public.heatshield_proposals to authenticated;
create policy proposals_read_own on public.heatshield_proposals for select to authenticated using((select auth.uid())=owner_id);
create policy proposals_insert_own on public.heatshield_proposals for insert to authenticated with check((select auth.uid())=owner_id);
-- Snapshots intentionally survive GIS reloads. The API verifies selected area IDs.
-- Reports are user-owned planning documents, never authoritative GIS source records.
