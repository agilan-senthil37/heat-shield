import { z } from "zod";
export const metric = z.number().finite().min(0).max(1).nullable();
export const siteSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9:_-]+$/),
  site_code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  canopy_coverage: metric,
  heat_score: metric,
  community_score: metric,
  suitability_score: metric,
  equity_score: metric,
  verification_status: z.literal("needs_verification"),
  known_conflict: z.boolean(),
  data_quality: z.enum(["verified_source", "unreliable", "synthetic"]),
  data_source: z.string().min(1).max(1000),
  source_date: z.iso.date().nullable(),
});
export type Site = z.infer<typeof siteSchema>;
export const idSchema = z.uuid();
export const siteIdSchema = siteSchema.shape.id;
export const explainSchema = z.object({ site_id: siteIdSchema }).strict();
export const proposalInput = z
  .object({
    project_name: z.string().trim().min(1).max(120),
    selected_site_ids: z.array(siteIdSchema).min(1).max(25),
  })
  .strict()
  .refine(
    (x) => new Set(x.selected_site_ids).size === x.selected_site_ids.length,
    { message: "Site IDs must be unique" },
  );
export const checklist = [
  "Confirm property ownership and permission.",
  "Have appropriate professionals check underground and overhead utilities.",
  "Verify root space and mature canopy clearance.",
  "Preserve sidewalk accessibility and sightlines.",
  "Assign watering and long-term maintenance.",
  "Ask local forestry experts to review species and required approvals.",
];
export const actions = {
  field_review:
    "Arrange a professional field review of selected candidate sites.",
  community_outreach:
    "Discuss priorities with nearby residents and community organizations.",
  permissions:
    "Identify property owners and obtain required permissions before planting.",
  maintenance: "Identify a partner for watering and long-term maintenance.",
} as const;
export const factorKeys = [
  "heat",
  "canopy_gap",
  "community",
  "suitability",
  "equity",
] as const;
export const guidanceSchema = z
  .object({
    factor_order: z.array(z.enum(factorKeys)).max(5),
    action_keys: z
      .array(
        z.enum([
          "field_review",
          "community_outreach",
          "permissions",
          "maintenance",
        ]),
      )
      .min(1)
      .max(4),
  })
  .strict();
export const explanationSchema = z.object({
  summary: z.string(),
  generation: z.enum(["template", "openai"]),
  model: z.string().nullable(),
  actions: z.array(z.string()),
  verification_checklist: z.array(z.string()),
});
export const scoredSiteSchema = siteSchema.extend({
  priority_score: z.number().min(0).max(100).nullable(),
  score_breakdown: z.record(z.string(), z.number().nullable()),
  warnings: z.array(z.string()),
  eligible: z.boolean(),
  scoring_version: z.string(),
  study_area: z.string().optional(),
  area_type: z.literal("screening_polygon").optional(),
  geometry: z.unknown().optional(),
  screening_geometry: z.unknown().optional(),
  environmental_metadata: z.record(z.string(), z.unknown()).optional(),
  surface_temperature_c: z.number().nullable().optional(),
  canopy_percent: z.number().nullable().optional(),
  source_score: z.number().nullable().optional(),
  source_method: z.string().optional(),
  poverty_estimate: z.number().nullable().optional(),
  poverty_universe: z.number().nullable().optional(),
  poverty_moe: z.number().nullable().optional(),
  universe_moe: z.number().nullable().optional(),
});
export type ScoredSite = z.infer<typeof scoredSiteSchema>;
export const proposalSchema = z.object({
  id: idSchema,
  owner_id: z.string(),
  project_name: z.string(),
  selected_site_ids: z.array(siteIdSchema),
  created_at: z.iso.datetime(),
  sites: z.array(scoredSiteSchema),
  explanation: explanationSchema,
  data_mode: z.enum(["demo", "supabase"]),
});
export type Proposal = z.infer<typeof proposalSchema>;
