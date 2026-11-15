import "server-only";
import snapshot from "../../data/shade-zones.json";
import { type ScoredSite } from "./schema";

type LandCoverMix = { coverage: number; shares: Record<string, number> };

type Zone = {
  id: string; latitude: number; longitude: number; ring: number[][];
  holes?: number[][][];
  ndmi?: number;
  open_area_m2?: number;
  land_year?: number;
  canopy_year?: number;
  land_context?: { within: LandCoverMix; surrounding: LandCoverMix };
  temperature: number; canopy: number; score: number; developed: number; coverage: number; date: string; parent: string; locality?: string; street?: string;
};
const areas = new Map<string, ScoredSite[]>();
const byId = new Map<string, ScoredSite>();
for (const [area, entries] of Object.entries(snapshot)) {
  const zones = entries as Zone[];
  const sites = zones.map((z, index): ScoredSite => {
    const cooler = zones.filter(zone => zone.temperature < z.temperature).length;
    const tied = zones.filter(zone => zone.temperature === z.temperature).length;
    // Share the middle rank for identical estimates, and use the midpoint for a single candidate.
    const heat = zones.length > 1 ? (cooler + (tied - 1) / 2) / (zones.length - 1) : 0.5;
    const heatPoints = Math.round(6000 * heat) / 100;
    const canopyPoints = Math.round(40 * (100 - z.canopy)) / 100;
    const locality = z.locality ?? area;
    const location = z.street ? `Near ${z.street} · ${locality}` : locality;
    return {
      id: z.id, site_code: `Z${index + 1}`, name: location,
      latitude: z.latitude, longitude: z.longitude, study_area: area,
      canopy_coverage: z.canopy / 100, heat_score: heat,
      suitability_score: null, community_score: null, equity_score: null,
      verification_status: "needs_verification", known_conflict: false,
      data_quality: "verified_source",
      data_source: `USGS Landsat surface temperature (${z.date}); NLCD canopy (${z.canopy_year ?? 2021}); NLCD land cover (${z.land_year ?? 2021}); Landsat near-infrared and shortwave infrared; FEMA USA Structures; California Protected Areas Database; USGS NHD; Census TIGER/Line roads and places (2024)`,
      source_date: z.date, priority_score: Math.round((heatPoints + canopyPoints) * 100) / 100, scoring_version: "local-temperature-rank-v2",
      area_type: "screening_polygon",
      geometry: { type: "Polygon", coordinates: [z.ring, ...(z.holes ?? [])] },
      score_breakdown: { heat: heatPoints, canopy_gap: canopyPoints },
      environmental_metadata: { developed_percent: z.developed, valid_developed_percent: z.coverage, parent_area_id: z.parent, locality, street: z.street, open_area_m2: z.open_area_m2, ndmi: z.ndmi, land_year: z.land_year ?? 2021, canopy_year: z.canopy_year ?? 2021, ...(z.land_context ? { land_context: z.land_context } : {}) },
      surface_temperature_c: z.temperature, canopy_percent: z.canopy,
      warnings: ["Check surface type, access, utilities, and planting permission in person.", "Heat and moisture reflect the dated satellite scene."],
      eligible: true,
    };
  }).sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0) ||
    (b.surface_temperature_c ?? 0) - (a.surface_temperature_c ?? 0) || a.id.localeCompare(b.id));
  for (const site of sites) byId.set(site.id, site);
  areas.set(area, sites);
}
export const shadeZones = (area: string) => areas.get(area);
export const shadeZone = (id: string) => byId.get(id);
