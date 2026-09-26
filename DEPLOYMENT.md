# Deploy on Vercel without paid services

This project is prepared for **Vercel Hobby + Turso Free**. The frontend and API live on Vercel; persistent bills, profiles, payment details, receipts, and notifications live in Turso. Local development still uses the existing SQLite file unless Turso variables are configured.

No Vercel or Turso resource is created by building this code. Deployment needs your account access and database settings. Do not put credentials in GitHub or chat messages.

## Free-plan setup

1. In [Turso](https://turso.tech/), sign in and create a database on the **Free** plan. Do not upgrade or enable paid overages. The published Free plan currently requires no credit card and includes 5 GB storage. Free limits can change; check [current pricing](https://turso.tech/pricing).
2. Copy the database's `libsql://...` URL and create a database access token. These are server secrets.
3. In [Vercel](https://vercel.com/new), select your **Hobby** account and import `ZarakQadirKhan/BILLSPLIT`. This friends-only personal app fits Hobby's non-commercial purpose. Avoid a Pro trial or paid add-ons. Hobby limits can pause service; see [Hobby plan details](https://vercel.com/docs/plans/hobby).
4. Keep the project root at the repository root. Framework: **Vite**. Build command: **npm run build**. Output directory: **dist**. Use Node.js **24.x** in project settings.
5. Add these environment variables in Vercel for **Production**:

   | Name | Value |
   | --- | --- |
   | `TURSO_DATABASE_URL` | Your database's `libsql://...` URL |
   | `TURSO_AUTH_TOKEN` | Your database access token |

   Never use a `VITE_` prefix for these secrets. Add preview variables only if preview deployments should connect to the chosen database; a separate free test database is preferable for previews.
6. Deploy. Use the included `.vercel.app` address, so a custom domain is not needed.
7. Open `/api/health` on the deployed address. It should return `{"ok":true,"database":"turso"}`. Then test the complete two-person flow: invite a friend, send a ride or food bill, mark paid, and confirm receipt. Refresh or reopen on another device to confirm data persists.

`vercel.json` configures the API route and frontend output. The API creates missing tables automatically using idempotent schema statements. It fails with an explicit error when cloud database variables are absent; it never silently saves bills in a temporary Vercel file.

## Existing local accounts and bills

Publishing the source does **not** copy your local database. Choose between a fresh online database and migrating existing records. To preserve existing accounts, stop the local app and back up `data/`, then create a private `.env.local` containing the two Turso variables and run:

```sh
node --env-file=.env.local scripts/migrate-to-turso.mjs --confirm
```

The destination must be empty. The script refuses to merge with existing online records, leaves the local file untouched, and verifies table counts. It prints no account or payment details. It uses bounded transactions; if migration fails after copying some records, use a **new empty destination database** and retry instead of rerunning against the partial destination. Existing large receipts can exceed cloud request limits; the original files remain safe locally if a migration fails.

The online address is a different browser origin, so use your existing recovery code to access a migrated profile. Invitation links created at localhost need their host replaced by the deployed address; private invitation tokens remain the same.

## Operational notes

- Vercel's filesystem is ephemeral. A local SQLite file is not a production database there; [Vercel explains why](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel).
- Receipt images are resized and compressed on-device to at most 2 MB, below [Vercel's 4.5 MB function limit](https://vercel.com/docs/errors/function_payload_too_large), then stored in the authorized database. The client supports common JPG, PNG, and WebP inputs.
- OCR still runs in the browser. The build copies its worker, WASM, and English data into static assets. There are no OCR or LLM API charges.
- Activity refreshes every 30 seconds while visible, reducing requests. In-app notifications work across devices; there is no email, SMS, or background push provider.
- Database transactions protect concurrent updates and duplicate payment confirmations. Auth rate limits use the shared database rather than temporary server memory.
- Turso credentials stay server-side. Keep paid overages off and remain on Vercel Hobby to preserve the zero-spending constraint. The app cannot enforce your hosting account's billing settings.
- Source pushes trigger redeployment only after Vercel is connected to the repository.

Free-plan information was checked against the official documentation on September 27, 2026.
