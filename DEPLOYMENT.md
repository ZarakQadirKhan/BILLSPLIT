# Deploy for $0: Vercel Hobby + MongoDB Atlas Free

The app records payments, but never transfers money. Local OCR runs on-device. Optional Gemini scanning sends a redacted photo to Google only after confirmation, without persisting it in our app. Deploying requires your own accounts. No cloud resources are created by building or testing the code.

## 1. Create the free database

1. Sign in at [MongoDB Atlas](https://cloud.mongodb.com/). Create a project called **BILLSPLIT**.
2. Choose **Create → Free / M0**, confirming the price is **$0**. Do not select Flex, a dedicated paid cluster, or paid add-ons. Choose an available nearby region and name the cluster **billsplit**. Skip sample datasets.
3. Create a **database user** with a generated strong password. This is separate from both your Atlas login and app users. Restrict its role to **readWrite** on database **tab_together**.
4. For local setup, add only your current IP under **Network Access**.
5. Open the cluster's **Connect → Drivers → Node.js** instructions. Copy the connection string into your private environment settings, substituting the database user's password (URL-encode special characters). Never paste it in chat or commit it to GitHub.

Official instructions: [create a Free cluster](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/), [database users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/), [IP access lists](https://www.mongodb.com/docs/atlas/security/ip-access-list/).

### Vercel connectivity needs a separate network decision

Adding your laptop's IP does not allow Vercel's servers. Vercel Hobby does not provide a dedicated static outbound IP. A commonly used no-cost Atlas setup allows `0.0.0.0/0` (connections from any IP), while still requiring TLS and database credentials. This broadens network exposure: approve it explicitly before changing the allowlist, use a dedicated strong-password user scoped only to this app's database, and never expose its URI in frontend code. Do not enable paid static IP/private networking to work around this without discussing the cost.

## 2. Configure Vercel

1. On [Vercel New Project](https://vercel.com/new), use your **Hobby** account and import **ZarakQadirKhan/BILLSPLIT**.
2. Framework **Vite**; repository root; build **npm run build**; output **dist**; Node.js **24.x**.
3. Add server-only environment variables for **Production**:

   | Variable | Value |
   | --- | --- |
   | `MONGODB_URI` | Private Atlas connection string |
   | `MONGODB_DB` | `tab_together` |

   Do not use a `VITE_` prefix. Preview deployments should use a separate test database and restricted database user, not the production database.
4. Ensure Atlas network access allows the deployment as agreed above.
5. Deploy using the included **.vercel.app** address; no purchased domain is needed.
6. Verify **/api/health** returns `{"ok":true,"database":"mongodb"}`. Test two separate browser profiles: invite, split a bill/ride, mark paid, confirm received, and reopen to verify persistence.

The function reuses its MongoDB connection pool (maximum five application connections per instance). Database indexes are created automatically. Missing credentials fail explicitly; nothing is written to Vercel's ephemeral filesystem. Pushing GitHub changes redeploys only after Vercel has been connected.

## 3. Set up the free Gmail sender

1. Create or choose a dedicated **free personal Gmail account** for this app. Google Workspace is not required. Do not use your normal account password in the app.
2. Enable [Google 2-Step Verification](https://myaccount.google.com/security), then create an [App Password](https://myaccount.google.com/apppasswords) named **Tab Together**. Google explains [App Password eligibility and restrictions](https://support.google.com/accounts/answer/185833). If the option is unavailable, stop and check account eligibility rather than disabling security.
3. Save these in **Vercel → Project Settings → Environment Variables → Production**, then redeploy:

   | Variable | Value |
   | --- | --- |
   | `GMAIL_USER` | The dedicated sender's Gmail address |
   | `GMAIL_APP_PASSWORD` | The generated App Password, without display spaces |
   | `APP_BASE_URL` | Your exact HTTPS `.vercel.app` origin, with no trailing slash |

   These are server-only secrets. Do not paste the App Password into chat or GitHub. Use the same private `.env.local` variables if testing locally; use `http://localhost:5173` for local email links.
4. In the app, save your recipient email in Profile and choose **Send a new code**. Enter the code from Gmail (check spam too). Test with two verified users: a new share sends an owed email; **I’ve paid** sends an approval request to the recipient; **Confirm received** sends confirmation to both people and marks the debt paid.

Google documents a [personal Gmail sending limit](https://support.google.com/mail/answer/22839). This app caps itself more conservatively at **100 attempts in a rolling 24 hours**, including verification and failed attempts. Extra notifications stay queued. No paid sending plan or purchased domain is needed for this setup. Gmail can still block a login from a new server, throttle, or classify mail as spam; successful real delivery must be tested after configuration.

Emails are recorded transactionally in MongoDB, and Vercel `waitUntil` continues sending after the HTTP response. A failed email never reverses a payment update. Automatic retries happen during subsequent app requests; there is no paid queue worker or scheduled always-on retry service. The app shows failed-delivery warnings and supports a manual retry in Profile. Sent/canceled records expire via TTL indexes. SMTP cannot guarantee exactly-once delivery if a connection fails after a provider accepted a message.

Users must verify their email before receiving financial notifications and can opt out in Profile. Verification is not account recovery: users must keep their recovery code. Approval links require the recipient's saved session or recovery code and never change debt status through a GET request.

## 4. Optional: preserve existing local accounts

A source-code push does not migrate your previous SQLite records. The old database and photos remain untouched. Choose a fresh online start or migrate **before anyone uses the online app**:

1. Stop the old app and back up the complete `data/` directory.
2. Create a private `.env.local` containing the MongoDB variables above.
3. Use a new **empty** destination database and run:

```sh
node --env-file=.env.local scripts/migrate-to-mongodb.mjs --confirm
```

Migration runs in a transaction and refuses nonempty destinations. Profiles, sessions, invitations, bills, debts and activity are preserved; photo bytes are deliberately skipped. Existing profiles receive deterministic unique usernames beginning with `user_`, which they can change in Profile. Recovery codes remain valid. A new website origin does not inherit your browser session: use your saved recovery code. Replace localhost in old invitation links with the online address.

No migration is run automatically. The script prints counts, not private data. Back up the hosted data periodically; Atlas Free has no automatic backups.

## Cost and scope

Use only **Vercel Hobby**, **Atlas Free**, a **free personal Gmail sender**, and an optional **Gemini Free Tier project with billing disabled**. No payment gateway, SMS, or paid email provider is configured. Free services have usage/storage limits and can pause or throttle; the code cannot control account upgrades or provider policy changes. Do not accept paid trials or add-ons.

## Optional Gemini receipt reader

Save `GEMINI_API_KEY` privately in Vercel Production, never with a `VITE_` prefix. The model is pinned to `gemini-3.8-flash`; the app never switches to a paid model or enables billing. Confirm the key's Google project is Free Tier with no billing account. A key alone does not let our code verify billing status.

`GEMINI_DAILY_LIMIT` defaults to 20 app-wide attempts per UTC day (maximum 100; 0 disables Gemini). This is an app safeguard, NOT Google's advertised quota. It is shared atomically through MongoDB across server instances; only counters are stored. Each user is limited to 3 attempts/minute. Provider 429 responses trigger a shared 60-second cooldown. No automatic Gemini retries: the device falls back to OCR. Provider quota remains authoritative and can be lower than our cap.

Images are validated, limited to 2 MB after device preparation, and sent inline through an authenticated route with a consent header. Neither request images nor provider error bodies are logged or stored. Interactions use `store:false`; Google's separate free-tier training/review terms still apply. Crop/redact personal data in your photo editor before using Gemini, or choose Private OCR. Request and response schemas, examples and server validation are in `shared/receipt-schema.js`, `server/receipt-prompt.js`, and `server/receipt-scan.js`. Financial calculations remain deterministic. Scanning itself never creates bills or debts.

The current Atlas Free storage limit is 512 MB including indexes. Photos are not stored, leaving space for bill records. Notifications refresh in-app every 30 seconds while visible; there is no background push. Actual payments take place through cash, bank or wallet outside this app. Only recipient confirmation changes a debt to paid.

Sources: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/). Account setup and a successful deployed smoke test are required before claiming the app is live.
