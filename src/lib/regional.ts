import { z } from "zod";
import { normalize } from "./scoring";
import { siteIdSchema, type ScoredSite } from "./schema";
const nullableNumber = z.number().finite().nullable();
export const regionalSchema = z.object({
  id: siteIdSchema,
  study_area: z.string(),
  geoid: z.string(),
  score: z.number().min(0).max(100).nullable(),
  method: z.string(),
  status: z.literal("screening_only"),
  canopy_percent: z.number().min(0).max(100).nullable(),
  surface_temperature_c: z.number().min(-50).max(90).nullable(),
  poverty_estimate: nullableNumber,
  poverty_universe: nullableNumber,
  poverty_moe: nullableNumber,
  universe_moe: nullableNumber,
  environmental_metadata: z.record(z.string(), z.unknown()),
  geometry: z.unknown().optional(),
  screening_geometry: z.unknown().optional(),
});
export const regionalColumns =
  "id,study_area,geoid,score,method,status,canopy_percent,surface_temperature_c,poverty_estimate,poverty_universe,poverty_moe,universe_moe,environmental_metadata";
export const filtersSchema = z
  .object({
    study_area: z.string().trim().min(1).max(100).optional(),
    min_priority: z.coerce.number().min(0).max(100).optional(),
    min_heat: z.coerce.number().min(0).max(1).optional(),
    max_canopy: z.coerce.number().min(0).max(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    include_geometry: z.enum(["true", "false"]).default("false"),
  })
  .strict();
export type Filters = z.infer<typeof filtersSchema>;
export function regionalSite(input: unknown): ScoredSite {
  const r = regionalSchema.parse(input),
    m = r.environmental_metadata;
  const heatValid =
    typeof m.heat_valid_fraction === "number" && m.heat_valid_fraction >= 0.5;
  const canopyValid =
    typeof m.canopy_valid_fraction === "number" &&
    m.canopy_valid_fraction >= 0.5;
  const heat =
    r.surface_temperature_c === null
      ? null
      : normalize(r.surface_temperature_c, 20, 50);
  const canopy = r.canopy_percent === null ? null : r.canopy_percent / 100;
  const empty =
    r.screening_geometry !== undefined &&
    r.screening_geometry !== null &&
    typeof r.screening_geometry === "object" &&
    "coordinates" in r.screening_geometry &&
    Array.isArray(r.screening_geometry.coordinates) &&
    r.screening_geometry.coordinates.length === 0;
  const environmental = r.method === "heat-canopy-snapshot-v1";
  const valid =
    environmental &&
    heat !== null &&
    canopy !== null &&
    heatValid &&
    canopyValid &&
    !empty;
  const computed = valid
    ? Math.round((60 * heat + 40 * (1 - canopy)) * 100) / 100
    : null;
  const mismatch =
    computed !== null &&
    r.score !== null &&
    Math.abs(computed - r.score) > 0.02;
  // Preserve the loader's score; verify against the same formula rather than overwriting it.
  const score = valid && !mismatch ? r.score : null;
  const warnings = [
    "Neighborhood screening area, not an individual planting location or permission.",
    "Dated satellite surface temperature is not air temperature or current weather.",
    "Source years and scene dates differ; inspect coverage before comparing areas.",
  ];
  if (!environmental)
    warnings.push(
      "Baseline equity method detected; no environmental planting-priority score assigned.",
    );
  if (!heatValid || !canopyValid)
    warnings.push(
      "Insufficient or missing valid-data coverage; no environmental score assigned.",
    );
  if (empty)
    warnings.push("All mapped land excluded; no remaining screening geometry.");
  if (mismatch)
    warnings.push(
      "Stored score differs from documented environmental formula; investigate before ranking.",
    );
  if (m.protected_land_review === "intersects")
    warnings.push(
      "Conservation holdings overlap: specialist review required, not automatic permission.",
    );
  for (const key of ["building_mask", "waterbody_mask"])
    if (m[key] !== "applied") warnings.push(`${key}: not confirmed applied.`);
  if (m.errors && typeof m.errors === "object" && Object.keys(m.errors).length)
    warnings.push("Environmental source errors are recorded in metadata.");
  return {
    id: r.id,
    site_code: r.geoid,
    name: `${r.study_area} / tract ${r.geoid}`,
    latitude: null,
    longitude: null,
    canopy_coverage: canopy,
    heat_score: heat,
    community_score: null,
    suitability_score: null,
    equity_score:
      r.poverty_universe && r.poverty_estimate !== null
        ? r.poverty_estimate / r.poverty_universe
        : null,
    verification_status: "needs_verification",
    known_conflict: empty,
    data_quality: "verified_source",
    data_source:
      "NLCD TCC 2021 v2021-4; Landsat Collection 2 summer 2024; source details in /api/sources",
    source_date:
      typeof m.heat_acquired_at === "string"
        ? m.heat_acquired_at.slice(0, 10)
        : null,
    priority_score: score,
    score_breakdown: {
      heat: valid ? Math.round(heat! * 6000) / 100 : null,
      canopy_gap: valid ? Math.round((1 - canopy!) * 4000) / 100 : null,
    },
    warnings,
    eligible: !empty,
    scoring_version: r.method,
    study_area: r.study_area,
    area_type: "screening_polygon",
    ...(r.geometry !== undefined ? { geometry: r.geometry } : {}),
    ...(r.screening_geometry !== undefined
      ? { screening_geometry: r.screening_geometry }
      : {}),
    environmental_metadata: m,
    surface_temperature_c: r.surface_temperature_c,
    canopy_percent: r.canopy_percent,
    source_score: r.score,
    source_method: r.method,
    poverty_estimate: r.poverty_estimate,
    poverty_universe: r.poverty_universe,
    poverty_moe: r.poverty_moe,
    universe_moe: r.universe_moe,
  };
}
