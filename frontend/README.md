# Heat Shield frontend

Heat Shield helps community members find areas to review for tree planting and ask neighbors to work with them. Pinpoint is the map, Proposal is the planting call and report, and Photosynthesis is the account, collaborators, friendships, and inbox.

## Local review

Use Node.js 24. From this directory:

```sh
npm install
NEXT_PUBLIC_DATA_MODE=pilot npm run build
NEXT_PUBLIC_DATA_MODE=pilot npm start -- -H 127.0.0.1 -p 4179
```

Open http://127.0.0.1:4179. Pilot mode shows 80 San José city inventory candidates, with dated modeled heat and surrounding-area canopy estimates. Other study areas in the picker intentionally show an unavailable state. Use `demo` only for the original sample map and demo profiles.

To try collaboration, open Photosynthesis in two separate browser profiles and create local accounts with the same ZIP code. On the receiving account opt in to discovery. In Pinpoint, shortlist a candidate. In Proposal, name the call, pick the recipient, add a note and send it. The recipient can respond in Photosynthesis; the sender sees the reply under Sent calls. The inbox and collaborator list refresh every two seconds. Discovery matches the entered five-digit ZIP, plus opted-in accepted friends. The city or neighborhood is self-reported, and the app does not expose ZIPs or infer a GPS location.

## Live setup

1. Follow the [team's GIS setup](https://github.com/rtr91/RotaryHackathon/blob/feature/database/supabase/README.md) to apply the migrations and load the full enriched regional dataset into the team Supabase project. It covers the nine Bay Area counties, Tracy and Mountain House. Confirm each area has records in the team API's Supabase mode before using it in the demo.
2. Run or deploy the [team backend](https://github.com/rtr91/RotaryHackathon/tree/feature/backend) with its Supabase configuration and `DATA_MODE=supabase`. Use its origin (without `/api`) as `NEXT_PUBLIC_API_BASE_URL` for this frontend. The frontend forwards these requests from the server, including the user's Supabase access token for protected reports.
3. Configure this frontend from `.env.example`: set `NEXT_PUBLIC_DATA_MODE=live`, `NEXT_PUBLIC_API_BASE_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. Supabase Auth must use an [email template containing the actual OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless) and SMTP configured for real recipients. Set `HEAT_SHIELD_HTTPS=true` behind a trusted HTTPS proxy. Configure a persistent `HEAT_SHIELD_DB` path for the community data and run a single frontend server. Do not use a temporary serverless filesystem.
4. Build and start the frontend. Test two verified accounts on separate devices against the same server: request a code, reject an invalid code, sign in with the real code, opt into discovery, send a call with a regional candidate, reply, and download a proposal PDF. Check that a third account cannot see the call. The live frontend never substitutes demo records on API failure.

### Set up a new team Supabase project

Use a checkout containing the team backend and database migrations plus this frontend. From the repository root, link the CLI to the **new project reference**, then apply the existing migrations:

```sh
supabase login
supabase link --project-ref YOUR_NEW_PROJECT_REF
supabase db push
```

Install the GIS dependencies from `scripts/requirements.txt` in a virtual environment. Build and validate the environmental bundle with the existing loader. If your teammate has already generated the full validated bundle, put it at `data/output/environment_bundle.json` and start at validation.

```sh
python scripts/pipeline.py build
python scripts/environment.py --all
python scripts/pipeline.py validate-environment
# Configure DATABASE_URL privately for the new project's privileged database connection.
python scripts/pipeline.py load-environment
```

Start the team API from the repository root with the root `.env.example` settings and `DATA_MODE=supabase`. For a local checkout, run `npm ci` and `npm run dev -- --port 4185`. Give the frontend the same Supabase URL and publishable key, and set its API origin to `http://127.0.0.1:4185` for that local run. Check environmental records in all eleven regions before opening the map:

```sh
node scripts/check-regional-api.mjs http://127.0.0.1:4185
```

In the hosted Supabase dashboard, set the frontend URL under Authentication URL Configuration. Enable email confirmation and configure custom SMTP with the team's verified sender. Use `supabase/templates/verification-code.html` for **both** the Confirm sign up and Magic link templates, with the subject **Your Heat Shield verification code**. Use six digits and a ten-minute code lifetime to match the local configuration. Test with a mailbox outside the Supabase project team to confirm real delivery. Keep the SMTP password and privileged database URL in the provider dashboard or private environment settings.

For local Auth testing, the committed `supabase/config.toml` and template work with `supabase start` and the local email viewer reported by `supabase status`. Local capture tests the code and login flow. A test through hosted SMTP verifies delivery to real recipients. Configure hosted email in the dashboard so the local URL does not replace the deployed URL.


The GIS values are dated screening estimates (2024 Landsat surface temperature and 2021 canopy), and the shapes are screening areas. A field visit is required to confirm a particular planting spot. Email verification confirms control of an email address, not residence. The team API provides geodata and protected proposal reports; profiles, friendships and inbox state currently use the frontend's SQLite service, not the team's Supabase tables. A rollout across multiple instances needs shared community storage and deployment-level rate limits before opening public registration.

Nothing needs to be pushed to the team repository to run the local preview.

Proposal invitations appear in Photosynthesis. The sender can invite more people from Sent calls, and accepted collaborators can invite another eligible collaborator from their inbox. Forwarded invitations keep the original candidate areas and named map point. Opted-in Tracy and Mountain House profiles can find each other across ZIP codes.

To deliver proposal emails, set `HEAT_SHIELD_RESEND_KEY`, `HEAT_SHIELD_EMAIL_FROM` (a verified Resend sender), and `HEAT_SHIELD_PUBLIC_URL` (the public HTTPS address of this app) on the frontend server. Supabase continues to handle sign-in codes. For isolated development tests only, set `HEAT_SHIELD_TEST_MAIL_PORT` to a loopback mail capture service that accepts `POST /emails` with a Resend-style JSON payload.
