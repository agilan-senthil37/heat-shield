# HeatShield backend

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/agilan-senthil37/heat-shield)

The button sets up a free HeatShield demo with a public HTTPS URL. Render asks for your Supabase project URL and publishable key. The free demo resets local community data when the service sleeps or restarts. See [Hosting](docs/HOSTING.md) for deployment and storage details.

Next.js + TypeScript backend for the Rotary AI for Good tree-planting planner, integrated with the published `feature/database` regional GIS schema. Frontend and GIS development remain separate team responsibilities.

The active Supabase integration reads `environmental_candidates`: neighborhood screening polygons across the nine Bay Area counties plus Tracy and Mountain House. These are not verified individual planting sites. The published GIS report describes 1,799 areas; live database loading still needs verification. See [supabase/README.md](supabase/README.md) for the data pipeline.

## Run without accounts (synthetic demo)

Requires Node.js 22 or later and npm. Ask Codex to execute these steps; no manual coding is needed.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The starter page links to health and site endpoints; it is not the final map UI.

In a second terminal, `npm run smoke` creates a three-site proposal, retrieves it, and downloads/verifies a PDF. `PDF_OUTPUT=/absolute/path/proposal.pdf npm run smoke` also saves the report. For protected environments set `SMOKE_ACCESS_TOKEN` to a valid access token in your terminal environment, not source code.

All 30 demo points are **synthetic**, including their metrics and coordinates. They are not verified planting locations. One deliberately conflicted fixture exercises exclusion behavior. Demo proposals persist in ignored `.data/projects` on a local writable filesystem. Do not use demo storage on Vercel or other ephemeral/read-only hosting.

## Validation

```sh
npm run lint
npm test
npm run typecheck
npm run build
```

To smoke-test a production build locally, set `DATA_MODE=demo`, `AI_MODE=template`, and a private `DEMO_ACCESS_TOKEN`, run `npm start`, then set the matching `SMOKE_ACCESS_TOKEN` when running the smoke test. Production demo mutations are locked without a token. Never embed the shared demo token in frontend bundles. Use Supabase sessions for the public app.

## Team integration

- Frontend owner: replace `src/app/page.tsx`; use the endpoints in [docs/API.md](docs/API.md). Keep UI work on `feature/frontend`.
- Backend owner: `src/app/api`, `src/lib`, tests and endpoint documentation; branch `feature/backend`.
- Database/GIS owner: review [the additive proposal migration](supabase/migrations/20261114000001_backend_proposals.sql), load the regional dataset with provenance. No migration has been applied remotely by this backend task. The existing migrations are preserved.
- Regional IDs are strings such as `06085:06085000100`; proposal IDs are UUIDs. Database canopy is percent, satellite temperature is Celsius; the API also exposes normalized canopy_coverage and heat_score fractions. Missing data stays null.

## Enable Supabase

1. Have the database teammate apply the existing migrations in order plus the additive `20261114000001_backend_proposals.sql` migration, then run the documented environmental loader in a development Supabase project.
2. Set `DATA_MODE=supabase`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` in `.env.local` or your hosting provider's secret settings. Legacy anon keys also work. This implementation does not require a service-role secret.
3. Configure Supabase Auth for team/demo users. Frontend sends the signed-in user's access token as `Authorization: Bearer <access-token>` for explanations, proposal creation, retrieval, and PDF downloads. The backend validates the session with Supabase. Sites are publicly readable; project rows are private to their owner through RLS.
4. Run the smoke test with a valid user access token. Test with two users: one must not retrieve the other's report or insert a project owned by another user. Verify anonymous inserts are denied. These live checks require the configured project and cannot be replaced by mocks.

The additive proposal schema grants users insert/read of their own report snapshots. Those reports are user content, not signed official assessments. The new `heatshield_proposals` table leaves legacy `planting_projects` and `project_sites` untouched. Site data can only be edited by the database team. Reports retain their original site snapshots even if source data later changes.

## Enable AI

Set `AI_MODE=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL` to a model available in your API account that supports Responses structured outputs. No key is needed for `AI_MODE=template`. The app never silently falls back from live AI to templates.

The model selects relevant factors and next actions from allowlists. The server builds factual text from validated site data and computed contributions. It cannot emit arbitrary measurements, species or approvals. The PDF and API disclose the generation mode. This constrained approach limits hallucinated facts while keeping the ranking deterministic. A live API call remains required to verify account/model access.

## Public deployment

Deploy this Next.js project using Node.js runtime, set Supabase mode and AI variables in hosting secrets, and run the live checks above. Configure frontend authentication and any hosting-level rate limits before public use. The built-in ten-generations-per-minute limit is per process; it is not a distributed quota and resets on restart. Add a shared limiter/provider spending cap for public traffic. PDFs run in Node, not Edge. API responses are uncached.

No map snapshot is included in the current PDF: it contains site coordinates and full records. Regional PDFs include area IDs and study names; detailed polygon geometry is served on demand, not copied into report snapshots. The frontend teammate can add a verified map image later. Scenario modeling, species advice, live GIS processing, and deployment are outside this backend MVP.

## GitHub and judging

- [Open the public HeatShield app](https://heatshield-u7th.onrender.com)
- [Watch the 2:25 demo video](https://drive.google.com/file/d/16PdaGaJ59txR2BdjSNBgk2KrRFdTJbPT/view)
- [Read the judge instructions](docs/JUDGES.md)

Use the **Field guide** button in the top-right corner for a pop-up tutorial on Pinpoint, Proposal, or Photosynthesis.

### Live validation

Test with two verified accounts. Load the Tracy and Mountain House maps, shortlist a location, add a meeting point, and send a proposal. Confirm the second account receives the invitation by email and in Photosynthesis, then accept it and exchange a message. Verify any OpenAI-backed features separately on the deployed app.

GitHub Actions runs lint, tests, typecheck, build, and a production smoke test. Use small pull requests into `main` and avoid force-pushing shared history. See the [API documentation](docs/API.md) and [developer setup](docs/CODEX-STEPS.md).

## Scoring compatibility

Live regional records preserve `heat-canopy-snapshot-v1`: 60% normalized dated surface temperature plus 40% canopy gap. Both inputs need at least 50% valid coverage. Scores are cross-checked against the documented formula; a mismatch is flagged and unranked. Baseline poverty-only scores remain available as source_score but are never mislabeled heat priority. The earlier five-factor formula exists only for synthetic demo fixtures and unit tests. No community-benefit or suitability metric is invented for regional areas.

API list defaults to 20 records and returns next_offset. Use study_area to narrow results, and include_geometry=true with limit <= 20 for polygons. Original and screening geometries can be large. `/api/sources` supplies the published provenance catalogs.
