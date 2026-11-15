# Host HeatShield

Use one Node 24 web service with a persistent volume. The start script exposes the frontend on the host's PORT and runs the mapping API on loopback. Use HTTPS at the host's reverse proxy.

Build command:

```sh
npm ci && npm ci --prefix frontend && npm run build && NEXT_PUBLIC_DATA_MODE=live npm run build --prefix frontend
```

Start command:

```sh
node scripts/start-hosted.mjs
```

Set these environment variables in the host dashboard:

| Key | Value |
| --- | --- |
| SUPABASE_URL | Team Supabase project HTTPS URL |
| SUPABASE_PUBLISHABLE_KEY | Team Supabase publishable key |
| HEAT_SHIELD_DB | Absolute SQLite path on the mounted volume, e.g. /var/data/heat-shield.sqlite |
| HEAT_SHIELD_PUBLIC_URL | Public HTTPS origin of the web service |
| HEAT_SHIELD_RESEND_KEY | Resend API key for proposal invitation email |
| HEAT_SHIELD_EMAIL_FROM | Verified Resend sender for proposal invitation email |

Configure email OTP and SMTP in Supabase and load the regional data before launch. In-app proposal invitations, chat, and completion reports live in the SQLite database. Keep the service at one instance. If migrating an existing preview, transfer a SQLite backup privately to the configured path before starting the service. Never commit a community database or provider credentials. A fresh database starts with empty community history.

Run a release smoke test using two test accounts. Verify OTP delivery, map data for Tracy and Mountain House, proposal delivery in-app and by email, chat privacy, and a completion report reflected in Pinpoint.
