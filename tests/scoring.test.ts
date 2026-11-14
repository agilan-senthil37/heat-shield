import { describe, it, expect } from "vitest";
import fixtures from "../data/demo-sites.json";
import { siteSchema } from "@/lib/schema";
import { scoreSite, normalize } from "@/lib/scoring";
const s = siteSchema.parse(fixtures[0]);
describe("scoring contract", () => {
  it("matches the hand-calculated weighted example", () => {
    expect(
      scoreSite({
        ...s,
        heat_score: 0.9,
        canopy_coverage: 0.2,
        community_score: 0.9,
        suitability_score: 0.6,
        equity_score: 0.7,
      }).priority_score,
    ).toBe(81);
  });
  it("covers score boundaries and canopy inversion", () => {
    expect(
      scoreSite({
        ...s,
        heat_score: 1,
        canopy_coverage: 0,
        community_score: 1,
        suitability_score: 1,
        equity_score: 1,
      }).priority_score,
    ).toBe(100);
    expect(
      scoreSite({
        ...s,
        heat_score: 0,
        canopy_coverage: 1,
        community_score: 0,
        suitability_score: 0,
        equity_score: 0,
      }).priority_score,
    ).toBe(0);
  });
  it("does not convert missing metrics to zero", () => {
    const r = scoreSite({ ...s, heat_score: null });
    expect(r.priority_score).toBeNull();
    expect(r.score_breakdown.heat).toBeNull();
  });
  it("excludes conflicts and refuses to rank unreliable data", () => {
    expect(scoreSite({ ...s, known_conflict: true }).eligible).toBe(false);
    expect(
      scoreSite({ ...s, data_quality: "unreliable" }).priority_score,
    ).toBeNull();
  });
  it("rejects percentages, NaN, and bad coordinates", () => {
    for (const patch of [
      { heat_score: 90 },
      { heat_score: NaN },
      { latitude: 100 },
    ])
      expect(() => scoreSite({ ...s, ...patch })).toThrow();
  });
  it("normalizes using documented fixed bounds", () => {
    expect(normalize(35, 20, 40)).toBe(0.75);
    expect(normalize(80, 20, 40)).toBe(1);
    expect(() => normalize(20, 20, 20)).toThrow();
  });
});
