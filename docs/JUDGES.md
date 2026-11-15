# HeatShield judge guide

HeatShield helps neighbors identify areas that may benefit from shade, coordinate a site visit, and record completed work.

## Try the app

1. Open the public app URL in the submission. Choose **Browse Pinpoint**, select **Tracy** or **Mountain House**, then select an outlined zone or open **Candidates**. Compare the shade need score, satellite surface temperature, and tree canopy.
2. To try live collaboration, sign in by email code and complete your profile. Use two separate browser profiles and two email addresses you control. Give both accounts the same ZIP code and enable collaborator discovery on the receiving account.
3. Shortlist a zone in **Pinpoint**. Pick and name a meeting point. Open **Proposal**, name the planting call, find the second account, and send it.
4. Open **Photosynthesis** as the receiving account and accept the planting call. The two accounts can exchange messages from the accepted invitation and open the meeting point for directions. Use a private test deployment for completion testing, since reporting completed work changes the shared map.

Screening estimates are dated satellite and land-cover data. The shade need score helps prioritize field review. A completion report lowers that planning score by five points and leaves the measured temperature unchanged.

## Run locally without credentials

Install Node.js 24, then clone the repository linked in the submission and run these commands from its root:

```sh
npm ci --prefix frontend
NEXT_PUBLIC_DATA_MODE=pilot npm run build --prefix frontend
NEXT_PUBLIC_DATA_MODE=pilot npm start --prefix frontend -- -H 127.0.0.1 -p 4179
```

Open http://127.0.0.1:4179 and choose **Browse Pinpoint**. This mode uses San José city inventory data. In Photosynthesis, create two local accounts in separate browser profiles with the same ZIP code to try the invitation and reply workflow. Live regional coverage, email verification, and completion reporting require the live setup.

For a live deployment with the team’s Supabase project and persistent community database, see [Hosting](HOSTING.md). To run the backend test suite, run `npm ci` and `npm test` from the repository root.
