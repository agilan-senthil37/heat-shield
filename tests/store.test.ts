import { it, expect, vi, afterEach } from "vitest";
const { query, client } = vi.hoisted(() => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const k of ["select", "eq", "gte", "lte", "order", "range", "insert"])
    query[k] = vi.fn(() => query);
  query.abortSignal = vi.fn(() => query);
  query.maybeSingle = vi.fn();
  const client = { from: vi.fn(() => query) };
  return { query, client };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: () => client }));
import { listSites, loadProposal } from "@/lib/store";
import { filtersSchema } from "@/lib/regional";
afterEach(() => vi.unstubAllEnvs());
function setup() {
  vi.stubEnv("DATA_MODE", "supabase");
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-only");
}
it("paginates the active view and converts API fractions to database units", async () => {
  setup();
  query.abortSignal.mockResolvedValueOnce({
    data: [],
    error: null,
    count: 1799,
  });
  const result = await listSites(
    filtersSchema.parse({
      offset: 100,
      limit: 20,
      min_heat: 0.5,
      max_canopy: 0.2,
      study_area: "Tracy",
    }),
  );
  expect(client.from).toHaveBeenCalledWith("environmental_candidates");
  expect(query.range).toHaveBeenCalledWith(100, 119);
  expect(query.gte).toHaveBeenCalledWith("surface_temperature_c", 35);
  expect(query.lte).toHaveBeenCalledWith("canopy_percent", 20);
  expect(result.total).toBe(1799);
});
it("returns an explicit database failure instead of demo records", async () => {
  setup();
  query.abortSignal.mockResolvedValueOnce({
    data: null,
    error: { message: "private error" },
    count: null,
  });
  await expect(listSites(filtersSchema.parse({}))).rejects.toMatchObject({
    status: 503,
  });
});
it("requires small pages for complex geometry", async () => {
  setup();
  await expect(
    listSites(filtersSchema.parse({ include_geometry: "true", limit: 100 })),
  ).rejects.toMatchObject({ status: 400 });
});
it("filters proposal lookup by authenticated owner", async () => {
  setup();
  query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
  await expect(
    loadProposal("00000000-0000-4000-8000-000000000001", "user-b", "jwt"),
  ).rejects.toMatchObject({ status: 404 });
  expect(client.from).toHaveBeenCalledWith("heatshield_proposals");
  expect(query.eq).toHaveBeenCalledWith("owner_id", "user-b");
});
