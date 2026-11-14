import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const base = process.env.BASE_URL || "http://localhost:3000";
const headers = {
  "Content-Type": "application/json",
  ...(process.env.SMOKE_ACCESS_TOKEN
    ? { Authorization: `Bearer ${process.env.SMOKE_ACCESS_TOKEN}` }
    : {}),
};
async function get(path, options) {
  const r = await fetch(base + path, options);
  assert.ok(
    r.ok,
    `${path}: ${r.status} ${await (!r.ok ? r.text() : Promise.resolve(""))}`,
  );
  return r;
}
const health = await (await get("/api/health")).json();
const list = await (await get("/api/sites")).json();
assert.ok(list.data.length > 0);
const selected = list.data
  .filter((s) => s.eligible)
  .slice(0, 3)
  .map((s) => s.id);
const detail = await (await get(`/api/sites/${selected[0]}`)).json();
assert.equal(detail.data.id, selected[0]);
const explanation = await (
  await get("/api/explain", {
    method: "POST",
    headers,
    body: JSON.stringify({ site_id: selected[0] }),
  })
).json();
assert.ok(explanation.data.summary);
const p = await (
  await get("/api/proposals", {
    method: "POST",
    headers,
    body: JSON.stringify({
      project_name: "Community planting pilot",
      selected_site_ids: selected,
    }),
  })
).json();
const saved = await (
  await get(`/api/proposals/${p.data.id}`, { headers })
).json();
assert.equal(saved.data.id, p.data.id);
const pdf = Buffer.from(
  await (await get(p.pdf_url, { headers })).arrayBuffer(),
);
assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
if (process.env.PDF_OUTPUT) await writeFile(process.env.PDF_OUTPUT, pdf);
const invalid = await fetch(base + "/api/proposals", {
  method: "POST",
  headers,
  body: JSON.stringify({ project_name: "Invalid", selected_site_ids: [] }),
});
assert.equal(invalid.status, 400);
console.log(
  JSON.stringify(
    {
      result: "PASS",
      data_mode: health.data_mode,
      ai_mode: health.ai_mode,
      site_count: list.data.length,
      proposal_id: p.data.id,
      pdf_bytes: pdf.length,
    },
    null,
    2,
  ),
);
