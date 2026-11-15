import assert from "node:assert/strict";

const origin = process.argv[2];
if (!origin) {
  process.stderr.write("Usage: node scripts/check-regional-api.mjs <team-api-origin>\n");
  process.exit(2);
}

const regions = [
  "Alameda County", "Contra Costa County", "Marin County", "Napa County",
  "San Francisco County", "San Mateo County", "Santa Clara County",
  "Solano County", "Sonoma County", "Tracy", "Mountain House",
];

async function read(path) {
  const url = new URL(path, origin);
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  assert.ok(response.ok, `${url.pathname}: HTTP ${response.status}`);
  return response.json();
}

const health = await read("/api/health");
assert.equal(health.data_mode, "supabase", "The team API must run in Supabase mode.");

let failures = 0;
for (const region of regions) {
  try {
    const params = new URLSearchParams({
      study_area: region, limit: "1", min_priority: "0", include_geometry: "true",
    });
    const batch = await read("/api/sites?" + params);
    assert.equal(batch.data_mode, "supabase");
    assert.ok(batch.total > 0, "No environmental priority records returned.");
    const candidate = batch.data?.[0];
    assert.equal(candidate?.study_area, region);
    assert.ok(Number.isFinite(candidate.priority_score), "Missing environmental score.");
    const polygon = candidate.screening_geometry ?? candidate.geometry;
    assert.ok(polygon?.coordinates?.length > 0, "Missing screening geometry.");
    console.log(`${region}: ${batch.total} environmental priority records`);
  } catch (error) {
    failures++;
    console.error(`${region}: ${error.message}`);
  }
}
if (failures) process.exitCode = 1;
