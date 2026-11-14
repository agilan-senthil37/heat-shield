# HeatShield API contract v1

JSON responses use `{data: ...}` except health (`{status,data_mode,ai_mode,note}`). Errors use `{error:{code,message,details?}}`. Regional site/area IDs are opaque strings (for example `06085:06085000100`); proposal IDs are UUIDs. Encode path IDs with encodeURIComponent. No arbitrary client metrics are accepted for explanation or proposal generation; sites are loaded from storage.

| Method | Path                   | Input                                                                                                                                                    | Output                                                                  |
| ------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| GET    | /api/health            | none                                                                                                                                                     | Process/config mode only; not a DB or AI readiness check                |
| GET    | /api/sites             | optional min_priority (0–100), min_heat (0–1), max_canopy (0–1), study_area, offset (0–100000), limit (1–100, default 20), include_geometry (true/false) | data array, total matching count, offset, limit, next_offset, data_mode |
| GET    | /api/sites/:id         | area ID path                                                                                                                                             | data: scored screening area, including geometry                         |
| POST   | /api/explain           | `{ "site_id": "AREA_ID" }`                                                                                                                               | data: summary, generation, model, actions, verification_checklist       |
| POST   | /api/proposals         | `{ "project_name": "School shade", "selected_site_ids": ["AREA_ID"] }`                                                                                   | 201 data: saved project; pdf_url                                        |
| GET    | /api/proposals/:id     | UUID path                                                                                                                                                | data: saved project for current owner                                   |
| GET    | /api/proposals/:id/pdf | UUID path                                                                                                                                                | application/pdf attachment                                              |

POSTs require `Content-Type: application/json`; bodies are limited to 16 KB. Names are trimmed and 1–120 characters; selections contain 1–25 unique existing IDs. Known conflicts yield 422. Unranked sites may be proposed for investigation but remain explicitly unranked.

Site list sort: descending priority, unranked last, ID tie-break. Filtered total is before limit. Unsupported filters return 400. Regional data is GeoJSON Polygon/MultiPolygon in WGS84, longitude first. Render it with Leaflet geoJSON, not a marker at a fabricated centroid. Regional latitude/longitude fields are null. A list omits large geometry fields unless include_geometry=true (limit <= 20); details include them. Names and database text must be rendered as text, never raw HTML.

## Active regional scoring

Supabase mode reads the `environmental_candidates` view from the published database schema. Formula `heat-canopy-snapshot-v1`: `0.6 * clamp((surface_temperature_c - 20)/30 * 100, 0, 100) + 0.4 * (100 - canopy_percent)`. Both measurements and their valid fractions (>= 0.5) are required. The source score is preserved and cross-checked, not replaced with invented inputs. All-excluded screening geometry is ineligible. A null geometry means the mask is unavailable, not all land excluded. Baseline `acs-poverty-share-v1` remains source_score only and is not environmental priority.

Responses include original source_score/source_method, raw surface_temperature_c/canopy_percent, environmental_metadata, study_area, area_type=screening_polygon, and warnings. Missing community/suitability inputs remain null. ACS poverty estimates and margins are retained separately and are not mixed into the active score. `data_quality=verified_source` means sourced measurements, not field-verified planting feasibility. GET /api/sources provides source catalogs.

Filters execute against stored source values; total counts matching DB rows before pagination, including any row the adapter flags as inconsistent/unranked. min_heat uses the 20–50 C normalization threshold; max_canopy is a 0–1 fraction converted to database percent.

## Synthetic-demo scoring

`100 * (0.30 * heat + 0.25 * (1 - canopy_coverage) + 0.20 * community + 0.15 * suitability + 0.10 * equity)`

All five inputs are 0–1; canopy coverage is the fraction covered by trees. Priority and per-factor contributions are rounded to two decimals. Fixed preprocessing bounds are a GIS decision and must be documented with dataset versions. `normalize(value,min,max)` clamps to 0–1 and rejects degenerate bounds; it does not infer bounds from each request.

The response contains priority_score, score_breakdown, eligible, warnings, and scoring_version. Missing values or unreliable data produce null overall scores. Known conflicts produce eligible=false and no score. No reweighting across missing values. Synthetic inputs are scored only as labeled demonstrations. The proposed weights are not scientifically validated.

## Persistence and authentication

Supabase mode uses the publishable key and validated user JWT, so RLS applies. All mutation/report routes require a user access token, including explanations. Local demo mode uses owner `local-demo` and shared local storage; it is not multi-user storage. Hosted demo writes require a shared bearer token and writable persistent disk. Use Supabase for the public frontend.

To download protected PDFs in a browser, fetch with the Authorization header, convert the response to a Blob, create an object URL and trigger a download; a plain anchor cannot attach the token. Revoke the object URL after use. Cross-origin browser requests are rejected; keep frontend/API same-origin.

Each project snapshot includes id, owner_id, project_name, selected_site_ids, created_at, sites, explanation, and data_mode. Proposal report reads are owner-filtered. The additive SQL creates heatshield_proposals; existing regional views and legacy project tables are unchanged. The GIS team owns source metadata and field units; migrations must be coordinated.

## Error statuses

400 invalid fields/JSON; 401 absent/invalid authentication; 403 cross-origin request; 404 unknown site/project; 413 oversized body; 415 non-JSON; 422 conflicted site; 429 generation throttle; 502 AI timeout/refusal/invalid output; 503 integration configuration/unavailability; 500 unexpected internal failure. Secrets and provider messages are not returned.

## Required live acceptance checks

Verify data source and dates, test real Supabase reads/writes and two-user RLS isolation, test an actual AI response and a provider failure, download a PDF, and exercise the frontend flow on the deployed URL. Mock unit tests do not certify remote service configuration.

Detailed geometry is deliberately omitted from proposal snapshots to keep reports small; selected area IDs allow a frontend to retrieve current polygons separately. Generated summaries always distinguish neighborhood screening from individual planting locations.
