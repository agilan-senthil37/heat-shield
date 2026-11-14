import "server-only";
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataMode } from "./config";
import { ApiError } from "./http";
import {
  idSchema,
  siteIdSchema,
  siteSchema,
  proposalSchema,
  type Proposal,
} from "./schema";
import { regionalColumns, regionalSite, type Filters } from "./regional";
import { scoreSite } from "./scoring";
import fixtures from "../../data/demo-sites.json";
export function db(token?: string) {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new ApiError(
      503,
      "DATABASE_UNCONFIGURED",
      "Supabase configuration is missing",
    );
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
}
export async function listSites(f: Filters) {
  if (dataMode() === "demo") {
    const all = siteSchema
      .array()
      .parse(fixtures)
      .map(scoreSite)
      .filter(
        (s) =>
          !f.study_area &&
          (f.min_priority === undefined ||
            (s.priority_score !== null &&
              s.priority_score >= f.min_priority)) &&
          (f.min_heat === undefined ||
            (s.heat_score !== null && s.heat_score >= f.min_heat)) &&
          (f.max_canopy === undefined ||
            (s.canopy_coverage !== null && s.canopy_coverage <= f.max_canopy)),
      )
      .sort(
        (a, b) =>
          (b.priority_score ?? -1) - (a.priority_score ?? -1) ||
          a.id.localeCompare(b.id),
      );
    return { data: all.slice(f.offset, f.offset + f.limit), total: all.length };
  }
  if (f.include_geometry === "true" && f.limit > 20)
    throw new ApiError(
      400,
      "GEOMETRY_LIMIT",
      "Use limit <= 20 when requesting detailed polygons",
    );
  let q = db()
    .from("environmental_candidates")
    .select(
      regionalColumns +
        (f.include_geometry === "true" ? ",geometry,screening_geometry" : ""),
      { count: "exact" },
    );
  if (f.study_area) q = q.eq("study_area", f.study_area);
  if (f.min_priority !== undefined)
    q = q.gte("score", f.min_priority).eq("method", "heat-canopy-snapshot-v1");
  if (f.min_heat !== undefined)
    q = q.gte("surface_temperature_c", 20 + 30 * f.min_heat);
  if (f.max_canopy !== undefined)
    q = q.lte("canopy_percent", 100 * f.max_canopy);
  const { data, error, count } = await q
    .order("score", { ascending: false, nullsFirst: false })
    .order("id")
    .range(f.offset, f.offset + f.limit - 1)
    .abortSignal(AbortSignal.timeout(15000));
  if (error)
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Environmental candidates unavailable; verify migrations and loading",
    );
  return { data: (data ?? []).map(regionalSite), total: count ?? 0 };
}
export async function site(id: string) {
  siteIdSchema.parse(id);
  if (dataMode() === "demo") {
    const found = fixtures.find((s) => s.id === id);
    if (!found) throw new ApiError(404, "SITE_NOT_FOUND", "Site not found");
    return scoreSite(siteSchema.parse(found));
  }
  const { data, error } = await db()
    .from("environmental_candidates")
    .select(regionalColumns + ",geometry,screening_geometry")
    .eq("id", id)
    .abortSignal(AbortSignal.timeout(15000))
    .maybeSingle();
  if (error)
    throw new ApiError(503, "DATABASE_UNAVAILABLE", "Candidate unavailable");
  if (!data) throw new ApiError(404, "SITE_NOT_FOUND", "Site not found");
  return regionalSite(data);
}
function directory() {
  return (
    process.env.DEMO_STORAGE_DIR ||
    path.join(process.cwd(), ".data", "projects")
  );
}
export async function saveProposal(p: Proposal, token?: string) {
  proposalSchema.parse(p);
  if (dataMode() === "demo") {
    await mkdir(directory(), { recursive: true });
    await writeFile(path.join(directory(), `${p.id}.json`), JSON.stringify(p), {
      flag: "wx",
      mode: 0o600,
    });
    return;
  }
  const { error } = await db(token)
    .from("heatshield_proposals")
    .insert({
      id: p.id,
      owner_id: p.owner_id,
      project_name: p.project_name,
      selected_area_ids: p.selected_site_ids,
      created_at: p.created_at,
      report: p,
    })
    .abortSignal(AbortSignal.timeout(10000));
  if (error)
    throw new ApiError(
      503,
      "SAVE_FAILED",
      "Could not save proposal; verify the proposal migration and session",
    );
}
export async function loadProposal(id: string, owner: string, token?: string) {
  idSchema.parse(id);
  let result: unknown;
  if (dataMode() === "demo") {
    try {
      result = JSON.parse(
        await readFile(path.join(directory(), `${id}.json`), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new ApiError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
      throw e;
    }
  } else {
    const { data, error } = await db(token)
      .from("heatshield_proposals")
      .select("report")
      .eq("id", id)
      .eq("owner_id", owner)
      .abortSignal(AbortSignal.timeout(10000))
      .maybeSingle();
    if (error)
      throw new ApiError(503, "DATABASE_UNAVAILABLE", "Proposal unavailable");
    if (!data)
      throw new ApiError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
    result = data.report;
  }
  const p = proposalSchema.parse(result);
  if (p.owner_id !== owner)
    throw new ApiError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  return p;
}
