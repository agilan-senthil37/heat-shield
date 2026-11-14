import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET as list } from "@/app/api/sites/route";
import { GET as detail } from "@/app/api/sites/[id]/route";
import { POST as explain } from "@/app/api/explain/route";
import { POST as create } from "@/app/api/proposals/route";
import { GET as retrieve } from "@/app/api/proposals/[id]/route";
import { GET as pdf } from "@/app/api/proposals/[id]/pdf/route";
const id = "00000000-0000-4000-8000-000000000001";
let dir: string;
const request = (
  url: string,
  data: unknown,
  extra: Record<string, string> = {},
) =>
  new Request("http://localhost:3000" + url, {
    method: "POST",
    headers: { "content-type": "application/json", ...extra },
    body: JSON.stringify(data),
  });
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "heatshield-"));
  vi.stubEnv("DATA_MODE", "demo");
  vi.stubEnv("AI_MODE", "template");
  vi.stubEnv("DEMO_STORAGE_DIR", dir);
  vi.stubEnv("DEMO_ACCESS_TOKEN", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
it("lists, filters and sorts sites", async () => {
  const r = await list(
    new Request("http://localhost/api/sites?min_priority=70&max_canopy=0.3"),
  );
  expect(r.status).toBe(200);
  const { data } = await r.json();
  expect(data.length).toBeGreaterThan(0);
  expect(
    data.every(
      (s: { priority_score: number; canopy_coverage: number }) =>
        s.priority_score >= 70 && s.canopy_coverage <= 0.3,
    ),
  ).toBe(true);
  expect(
    (await list(new Request("http://localhost/api/sites?min_heat=90"))).status,
  ).toBe(400);
});
it("returns 404 for unknown UUID and 400 for malformed ID", async () => {
  expect(
    (
      await detail(new Request("http://localhost"), {
        params: Promise.resolve({ id: "00000000-0000-4000-8000-999999999999" }),
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await detail(new Request("http://localhost"), {
        params: Promise.resolve({ id: "../oops" }),
      })
    ).status,
  ).toBe(400);
});
it("creates, persists, retrieves and exports a proposal", async () => {
  const r = await create(
    request("/api/proposals", {
      project_name: "School planting plan",
      selected_site_ids: [id],
    }),
  );
  expect(r.status).toBe(201);
  const { data: p } = await r.json();
  const ctx = { params: Promise.resolve({ id: p.id }) };
  const saved = await retrieve(new Request("http://localhost:3000"), ctx);
  expect((await saved.json()).data.sites[0].id).toBe(id);
  const report = await pdf(new Request("http://localhost:3000"), ctx);
  expect(report.status).toBe(200);
  expect(
    Buffer.from(await report.arrayBuffer())
      .subarray(0, 5)
      .toString(),
  ).toBe("%PDF-");
});
it("validates selections and refuses known conflicts", async () => {
  for (const ids of [[], [id, id], ["../invalid"]])
    expect(
      (
        await create(
          request("/api/proposals", {
            project_name: "Test",
            selected_site_ids: ids,
          }),
        )
      ).status,
    ).toBe(400);
  expect(
    (
      await create(
        request("/api/proposals", {
          project_name: "Test",
          selected_site_ids: ["00000000-0000-4000-8000-000000000030"],
        }),
      )
    ).status,
  ).toBe(422);
});
it("rejects malformed, oversized and non-JSON bodies", async () => {
  expect(
    (
      await explain(
        new Request("http://localhost/api/explain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await explain(request("/api/explain", { x: "x".repeat(17000) }))).status,
  ).toBe(413);
  expect(
    (
      await explain(
        new Request("http://localhost/api/explain", {
          method: "POST",
          body: "hello",
        }),
      )
    ).status,
  ).toBe(415);
});
it("requires configured token and rejects cross-origin requests", async () => {
  vi.stubEnv("DEMO_ACCESS_TOKEN", "test-secret");
  expect((await explain(request("/api/explain", { site_id: id }))).status).toBe(
    401,
  );
  expect(
    (
      await explain(
        request(
          "/api/explain",
          { site_id: id },
          {
            authorization: "Bearer test-secret",
            origin: "https://evil.example",
          },
        ),
      )
    ).status,
  ).toBe(403);
  const r = await explain(
    request(
      "/api/explain",
      { site_id: id },
      { authorization: "Bearer test-secret" },
    ),
  );
  expect(r.status).toBe(200);
  expect((await r.json()).data.generation).toBe("template");
});
it("locks production demo without a token", async () => {
  vi.stubEnv("NODE_ENV", "production");
  expect((await explain(request("/api/explain", { site_id: id }))).status).toBe(
    503,
  );
});
