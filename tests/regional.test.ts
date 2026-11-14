import { it, expect } from "vitest";
import { regionalSite } from "@/lib/regional";
const row = {
  id: "06085:06085000100",
  study_area: "Santa Clara County",
  geoid: "06085000100",
  score: 62,
  method: "heat-canopy-snapshot-v1",
  status: "screening_only",
  canopy_percent: 20,
  surface_temperature_c: 35,
  poverty_estimate: null,
  poverty_universe: null,
  poverty_moe: null,
  universe_moe: null,
  environmental_metadata: {
    heat_valid_fraction: 0.8,
    canopy_valid_fraction: 0.9,
    building_mask: "applied",
    waterbody_mask: "applied",
    protected_land_review: "intersects",
    heat_acquired_at: "2024-07-20T18:00:00Z",
  },
};
it("matches the active GIS formula and preserves polygon identity", () => {
  const s = regionalSite(row);
  expect(s.priority_score).toBe(62);
  expect(s.score_breakdown).toEqual({ heat: 30, canopy_gap: 32 });
  expect(s.latitude).toBeNull();
  expect(s.area_type).toBe("screening_polygon");
  expect(s.id).toBe(row.id);
  expect(s.canopy_coverage).toBe(0.2);
  expect(s.source_date).toBe("2024-07-20");
  expect(s.warnings.join(" ")).toContain("Conservation");
});
it("does not treat poverty-only scores as heat priority", () => {
  const s = regionalSite({ ...row, method: "acs-poverty-share-v1", score: 12 });
  expect(s.priority_score).toBeNull();
  expect(s.source_score).toBe(12);
});
it("keeps missing coverage and missing source scores null", () => {
  expect(
    regionalSite({ ...row, environmental_metadata: {} }).priority_score,
  ).toBeNull();
  expect(
    regionalSite({ ...row, surface_temperature_c: null }).priority_score,
  ).toBeNull();
  expect(regionalSite({ ...row, score: null }).priority_score).toBeNull();
});
it("flags inconsistent stored scores instead of silently changing them", () => {
  const s = regionalSite({ ...row, score: 99 });
  expect(s.priority_score).toBeNull();
  expect(s.source_score).toBe(99);
  expect(s.warnings.join(" ")).toContain("differs");
});
it("excludes empty screening polygons and retains original geometry", () => {
  const geometry = { type: "MultiPolygon", coordinates: [] };
  const s = regionalSite({ ...row, geometry, screening_geometry: geometry });
  expect(s.eligible).toBe(false);
  expect(s.priority_score).toBeNull();
  expect(s.geometry).toEqual(geometry);
});
it("does not mistake null geometry for fully excluded land", () => {
  expect(regionalSite({ ...row, screening_geometry: null }).eligible).toBe(
    true,
  );
});
it("rejects out-of-range measurements", () => {
  expect(() => regionalSite({ ...row, canopy_percent: 200 })).toThrow();
  expect(() => regionalSite({ ...row, surface_temperature_c: 120 })).toThrow();
});
