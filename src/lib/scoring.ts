import { siteSchema, type Site } from "./schema";
export const weights = {
  heat: 0.3,
  canopy_gap: 0.25,
  community: 0.2,
  suitability: 0.15,
  equity: 0.1,
} as const;
export function normalize(value: number, min: number, max: number) {
  if (![value, min, max].every(Number.isFinite) || max <= min)
    throw new Error("Normalization requires finite values and max > min");
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}
export function scoreSite(input: Site) {
  const s = siteSchema.parse(input);
  const metrics = {
    heat: s.heat_score,
    canopy_gap: s.canopy_coverage === null ? null : 1 - s.canopy_coverage,
    community: s.community_score,
    suitability: s.suitability_score,
    equity: s.equity_score,
  };
  const entries = Object.entries(metrics) as [
    keyof typeof weights,
    number | null,
  ][];
  const missing = entries.filter(([, v]) => v === null).map(([k]) => k);
  const score_breakdown = Object.fromEntries(
    entries.map(([k, v]) => [
      k,
      v === null ? null : Math.round(10000 * weights[k] * v) / 100,
    ]),
  );
  const eligible = !s.known_conflict;
  const priority_score =
    missing.length || s.data_quality === "unreliable" || !eligible
      ? null
      : Math.round(
          entries.reduce((sum, [k, v]) => sum + weights[k] * v!, 0) * 10000,
        ) / 100;
  const warnings = [
    "Planning suggestion only; site verification is required.",
    ...(missing.length
      ? [`Missing inputs: ${missing.join(", ")}. No overall score assigned.`]
      : []),
    ...(s.known_conflict
      ? ["Known conflict: excluded from planting proposals."]
      : []),
    ...(s.data_quality === "unreliable"
      ? ["Unreliable data: no overall score assigned."]
      : []),
    ...(s.data_quality === "synthetic"
      ? ["SYNTHETIC DEMO DATA: not real environmental measurements."]
      : []),
  ];
  return {
    ...s,
    priority_score,
    score_breakdown,
    warnings,
    eligible,
    scoring_version: "1.0" as const,
  };
}
