# Paisay dou $

A bill-splitting app for a group of friends. Built with React, Vite, Express, MongoDB, and Tesseract.js. Optional receipt scanning uses paid GPT-6 Sol to transcribe a table and GPT-6 Luna to format JSON, with Gemini 3.8 Flash and free on-device OCR as fallbacks. Manual bills need no photo or AI. No payment gateway. Deployment uses Vercel Hobby and MongoDB Atlas Free; see [DEPLOYMENT.md](DEPLOYMENT.md).

## Run it

Requires Node.js **22.13 or newer** (Node 24 LTS recommended). Create a private `.env.local` with `MONGODB_URI` and `MONGODB_DB=tab_together` using `.env.example` as a template. Use MongoDB Atlas **Free**, or a local MongoDB replica set (transactions require a replica set). Dependencies are already installed in this workspace.

```sh
npm run dev
```

Open **http://localhost:5173**. To run the production build:

```sh
npm run build
npm start
```

The server listens on port 5173. Set `PORT` to use another port. The API requires MongoDB credentials and never falls back to a temporary database. Do not run development and production servers on the same port simultaneously.

## Use with friends at no hosting cost

Keep this computer awake and the server running. On the **same trusted Wi-Fi**, friends can open `http://YOUR_COMPUTER_LAN_IP:5173`. Use that address yourself when creating invitations so the links work on their phones. Your router must allow devices to communicate, and the system firewall may need to permit Node.

This is a working shared backend, not a browser-only mockup: every connected device uses the same MongoDB database. Friends cannot connect once this computer sleeps or the server stops. The repository now includes Vercel deployment configuration and MongoDB persistence. These files do not provision hosting or a database by themselves. For a future public deployment, choose and verify a no-cost host first, add HTTPS, and review its storage and usage limits. Do not expose this development server directly to the internet.

Local HTTP is for trusted Wi-Fi testing. HTTPS is needed for confidential traffic on an untrusted network, secure clipboard APIs, and a full installable/offline PWA. Clipboard fallback text is provided. There is a web app manifest, but no offline service worker or background push subscription.

## Workflow

1. Enter your display name and a unique username once. Usernames use 3–24 letters, numbers or underscores, are stored lowercase, and are protected by a unique database index. Display names may repeat. You can change your username in Profile without changing your account ID or debts. The device keeps an opaque session token; there is no logout button. Save the private recovery code to use the same account on another device. Clearing browser storage removes the saved session, not the account or bills.
2. Add friends and privately share their single-use invitation links. A friend can create a profile or attach the invitation to an existing account. A name alone cannot impersonate an existing person. Creating another invitation for the same unclaimed friend invalidates the old link.
3. Save your transfer instructions in **Your profile**. Only known friends and participants in shared bills can see them. The app never transfers money.
4. Add a bill. Select a JPG/PNG/WebP, paste receipt text, or enter items manually. AI mode asks permission before sending the photo through the server to OpenAI, then Google if needed, then bundled on-device OCR. Private mode sends no photo to any server. Our app never persists photos; only reviewed bill fields and numeric AI usage/reservations are stored. Leaving the editor discards the preview. Provider data-use terms still apply; `store:false` is not a promise of zero provider retention. OpenAI defaults to a cumulative $5 app budget, with no automatic reset or recharge; see deployment guidance.
5. Check every extracted field. Edit quantities, unit prices, line totals, discounts, tax, fees, and the actual charged amount. A manual line-total override is labeled; editing quantity or unit price restores automatic line arithmetic.
6. Add participants and select the original payer. Assign item quantities or share an item equally, including fractional quantities. Unassigned and over-assigned items are flagged. The payer must have joined and saved transfer instructions before sending.
7. Save a private draft or send shares. Sending is blocked until all item units are assigned, the calculated and entered receipt totals agree, and no share is negative. Published bills are locked; their money amounts are recalculated and validated on the server.
8. After transferring outside the app, choose **I’ve paid**, select the bills, and enter the amount actually paid. Partial payments are supported. A transfer can cover multiple bills owed to the same friend, applied in the order shown. The recipient confirms the whole report or rejects it with a note. Only confirmation reduces the debt; pending amounts are reserved so they cannot be reported twice.
9. Overview groups outstanding bills by friend. **Still to pay** excludes both confirmed and pending amounts; **Pending** shows money already reported, with a warning not to pay again. Recipients see approval cards. Confirmed transfers appear under **Paid**, including partial payments. Activity contains persistent notifications, refreshed every 30 seconds while the app is visible.

Unfinished food and ride bills autosave on the current device. Resume them from **Pick up where you left off**. This works for incomplete fields, saves on backgrounding/leaving, and never stores photos, raw OCR text or model transcripts. Clearing browser storage removes these local drafts; **Save draft** explicitly saves a validated draft to MongoDB for access from another device.

Assignment controls include **Only show unassigned items**, a sticky remaining count, collapsed completed items, **Split all items equally**, and one-step **Undo assignment**. Undo restores quantities assigned to people while preserving later price edits.

When AI sees unresolved card/cash tax alternatives, it returns both for the editor to present as choices. Selecting one updates tax and any readable final total. Missing prices and unreadable totals become explicit questions and block publication until resolved. A clipped total is never invented. Manual bills do not require a receipt total.

## inDrive rides

Choose **Add a bill → inDrive ride**, enter the complete fare, select everyone who was in the car, and choose who paid. The app splits the fare equally among all selected passengers, including the payer. The payer owes no money to themselves; their own share is excluded from the payment-request list. Other passengers see their debt and the payer's transfer details. Shares automatically recalculate when passengers change; rounding is distributed by paisa.

For example, Rs 1,200 shared by four passengers is Rs 300 each. The payer sees Rs 900 to collect, with three Rs 300 requests.

## Email notifications and payment approval

Daily reminder emails use one random quote from the 100 owner-supplied templates. Each message includes the recipient's actual display name, their current still-payable total, and a per-friend breakdown. Confirmed amounts and payments awaiting confirmation are excluded. Balances are checked before queueing and rebuilt immediately before every delivery attempt; reminders are canceled when nothing is payable, email is unverified/disabled/changed, or the daily message has expired. Each recipient/day has a unique outbox ID to prevent duplicate scheduler invocations from generating extra reminders.

Vercel's free daily cron is configured as `0 19 * * *` (00:00 Asia/Karachi). **Hobby scheduling can run any time during 00:00–00:59; exact midnight is not guaranteed.** The scheduler does not require anyone to keep the app open. Set a private random `CRON_SECRET` of at least 32 characters in Production. `/api/cron/reminders` accepts only GET requests bearing that secret; `?dryRun=1` checks configuration without queueing or sending messages. The existing shared 100-attempt daily mail cap remains in force; throttling or sender failures can delay or prevent delivery. Users can turn off notification emails in Profile. No new paid service or LLM calls are used for reminders.

Add an email address during signup or in Profile, then enter the emailed six-digit verification code. Codes expire after 15 minutes and lock after five incorrect attempts. Email addresses remain private to their owner; they are not included in friends' profiles. Users can disable notification emails in Profile.

- A published share emails the person who owes money, once their email is verified. Pending invitees receive a catch-up notification after joining and verifying.
- **I’ve paid** changes the display to **Pending approval** and emails the recipient to check their actual bank/wallet/cash receipt.
- Only that signed-in recipient can select **Confirm received**. Both receive a confirmation email for that amount. A partial payment reduces the remaining balance; the debt becomes fully paid only after all its amounts are confirmed. Combined transfers are approved together, with an itemized bill breakdown.
- **Not received** keeps the debt unpaid and emails the debtor to review the note.
- Email links open the bill; opening a link never approves a payment. There is no gateway, card collection, bank connection, or money transfer in the app.

A dedicated free Gmail sender must be configured first; see [DEPLOYMENT.md](DEPLOYMENT.md). The app clearly shows when setup or verification is missing. Email messages are queued in MongoDB in the same transaction as the payment update. Failed delivery does not undo a bill or payment. Vercel background work attempts delivery immediately; queued failures retry when someone next uses the app, with exponential backoff and a manual retry option for failed messages. There is no always-running paid worker or guaranteed delivery time. SMTP can rarely deliver a duplicate if the provider accepted a message before the connection failed.

The app conservatively allows at most 100 SMTP attempts per rolling 24 hours across the whole app. It queues excess messages and never purchases extra capacity. Sent message bodies are removed; sent/canceled metadata expires automatically. Gmail can independently throttle or reject messages.

## Calculation rules

All stored money is integer **paisa**. Percentage calculations round once to paisa; proportional distribution uses the largest-remainder method so shares sum exactly to the bill total. Equal shared quantities may be fractional. Discounts affect only eligible items and are distributed in proportion to each person's eligible amount.

- **Percentage discount:** rate × min(eligible item subtotal, eligible amount limit), limited by the optional maximum saving and eligible subtotal.
- **Fixed discount:** exact amount, limited to the eligible amount.
- **Example:** Rs 30,000 bill, 50% discount on the first Rs 20,000 → Rs 10,000 discount → Rs 20,000 before additional charges.
- **Tax:** fixed receipt amount or percentage; basis before or after discounts. Tax is distributed using that same basis. A fully discounted bill with fixed tax falls back to the pre-discount basis.
- **Extra fees:** delivery, service, tip, and an explicit signed adjustment; split equally or proportionally. Manual adjustments require a reason.
- **Receipt reconciliation:** editing the charged total never silently changes the math. Correct the bill, add a labeled adjustment, or explicitly use the calculated total.
- **Payer:** original amount paid minus own share is the amount to collect. No debt is created to oneself. Confirmation reduces outstanding amounts; accepting or claiming payment does not.
- **Net balance:** display only. Opposing debts are never automatically canceled.

## Data and privacy

Shared application data is stored in MongoDB: profiles, hashed sessions/recovery codes, invitations, saved bills, debts, repayment reports, and activity. Each debt retains its original integer-paisa amount plus confirmed and pending amounts. Repayment reports record their bill allocations, recipient, reference and approval status. MongoDB transactions atomically update all allocations and email notifications. Request IDs prevent a retried report from recording the same transfer twice. Older debts without the new counters remain compatible. Browser sessions and unfinished device drafts remain in localStorage; photos do not. OCR assets and fonts do not depend on external CDNs.

The old `data/tab-together.sqlite` file and existing local photos are untouched and ignored by Git. They are not automatically moved to MongoDB. An explicit migration script can copy existing accounts/bills without uploading photos; see the deployment guide. Back up the old data directory with the old server stopped before migrating.

Session, invitation, and recovery tokens are cryptographically random; only their hashes are stored on the server. Server-side authorization controls every bill and payment action. Drafts are creator-only. Editing uses a version check to avoid silently overwriting another device. Published shares are immutable. Keep recovery codes and invitation links private; account recovery does not revoke existing sessions.

## Verification

```sh
npm test
npm run build
```

Tests launch an isolated local MongoDB replica set; the first run may download the free MongoDB server binary. They never use your Atlas URI. Tests cover calculation conservation, MongoDB transactions, authorization, legacy debts, partial and combined repayments, concurrent overpayment attempts, idempotent retries, email amounts, draft privacy, receipt choices, missing prices, and interactive editor/payment flows. A 390-pixel-wide browser preview with fictional data checks the mobile layout without using production bills or sending emails.

The optional `read_my_balances` WebMCP tool is feature-detected in supported browsers. It has no write side effects. Its browser integration was not verified in this environment.

## Current scope

- English printed receipts; extraction is a draft and always needs human review. No promise of automatic perspective correction, blur detection, or accurate handwriting recognition.
- Multiple original payers and partial repayments are supported. Opposing debts are not automatically canceled.
- One receipt photo can be scanned at a time; photos are not persisted. No PDF or multi-image receipt import.
- In-app activity plus verified-email notifications using your configured free Gmail sender; no SMS or background browser push.
- Sent bills cannot yet be corrected or canceled in the interface. Resolve disputes before accepting or transferring. Creating a second bill does not cancel the first.
- Deployments use the configured Vercel project and MongoDB Atlas database. For a new installation, see [the deployment guide](DEPLOYMENT.md).

The payment and draft features need no additional paid service. Optional OpenAI receipt scanning uses configured API credit within the app's spending guard.

## Payment celebration

A successful full or partial repayment report shows falling dollar bills and a thank-you message for eight seconds. The payment remains pending until the recipient confirms it. Closing the celebration or hiding the page stops it; reduced-motion preferences disable the falling bills.

Audio is disabled until an authorized song clip is supplied. To connect it, add the clip under `public/audio/` and set `paymentAudio.src` in `src/celebration-audio.js` to its public path. Configure `startSeconds` for the desired section; playback is capped at eight seconds. Audio is prepared during the payment-button gesture for mobile browsers, with mute and manual-play controls when configured. No music subscription or external audio service is used.

## Manual bills and multiple original payers

Choose **Manual bill** on the home screen (or **Enter manually** in the editor), add items and prices, then assign items as usual. Discounts, tax and the final amount remain editable.

In food or ride bills, choose **Multiple people** under **Who paid?** and enter each contribution. Contributions must exactly equal the final bill before publishing. Each person's consumption is subtracted from their contribution; net debtors repay net receivers proportionally, rounded to integer paisa. Nobody pays themselves. For example, on a Rs 900 equal three-person bill, Ali paying Rs 500 and Sara Rs 400 leaves Hamza owing Ali Rs 200 and Sara Rs 100. A contributor who paid less than their own share still owes the difference. Each transfer has its own pending/confirmed state and email workflow. Existing single-payer bills retain their original behavior.

## Controlled live scanner test

Automated tests mock paid providers. To explicitly run one real scan with private environment settings and the production spending guard:

```sh
node --env-file=<private-env-file> scripts/test-receipt.mjs <receipt.jpg> --confirm-paid-test
```

This outputs the temporary transcription, validated items and token-cost estimate. It never creates a bill, sends an email or persists the photo/table. It consumes configured OpenAI credit and records numeric usage in the same cumulative app budget. Do not reset the budget for testing.
