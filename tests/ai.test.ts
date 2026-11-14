import { it, expect, vi, afterEach } from "vitest";
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { create };
  },
}));
import { explain } from "@/lib/ai";
import { scoreSite } from "@/lib/scoring";
import { siteSchema } from "@/lib/schema";
import fixture from "../data/demo-sites.json";
const site = scoreSite(siteSchema.parse(fixture[0]));
afterEach(() => {
  vi.unstubAllEnvs();
  create.mockReset();
});
function live() {
  vi.stubEnv("AI_MODE", "openai");
  vi.stubEnv("OPENAI_API_KEY", "test-only");
  vi.stubEnv("OPENAI_MODEL", "configured-test-model");
}
it("uses only validated factor/action selections for factual prose", async () => {
  live();
  create.mockResolvedValue({
    status: "completed",
    output_text: JSON.stringify({
      factor_order: ["heat", "canopy_gap"],
      action_keys: ["field_review"],
    }),
  });
  const r = await explain([site]);
  expect(r.generation).toBe("openai");
  expect(r.summary).toContain(`${site.score_breakdown.heat} points`);
  expect(r.summary).toContain("Synthetic");
});
it.each(["malformed", "refused", "timeout", "invented"])(
  "rejects %s output without silently faking AI",
  async (kind) => {
    live();
    if (kind === "timeout") create.mockRejectedValue(new Error("timeout"));
    else
      create.mockResolvedValue({
        status: kind === "refused" ? "incomplete" : "completed",
        output_text:
          kind === "malformed"
            ? "not json"
            : JSON.stringify({
                factor_order: ["heat"],
                action_keys: ["approve_planting"],
              }),
      });
    await expect(explain([site])).rejects.toMatchObject({ status: 502 });
  },
);
it("reports missing credentials", async () => {
  live();
  vi.stubEnv("OPENAI_API_KEY", "");
  await expect(explain([site])).rejects.toMatchObject({ status: 503 });
});
