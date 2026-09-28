# Tab Together

A free-tier bill-splitting app for a group of friends. Built with React, Vite, Express, MongoDB, and Tesseract.js, with optional Gemini 3.8 Flash receipt extraction. No payment gateway. Deployment uses Vercel Hobby and MongoDB Atlas Free; see [DEPLOYMENT.md](DEPLOYMENT.md).

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
4. Add a bill. Select a JPG/PNG/WebP, paste receipt text, or enter items manually. Gemini-first mode asks permission before sending a redacted receipt through the server to Google. On quota exhaustion, missing configuration, timeout or unusable output, it automatically runs bundled on-device OCR. Private mode sends no photo to either server. Our app never persists photos; only reviewed bill fields are stored. Leaving the editor discards the preview. Google free-tier data-use terms still apply; `store:false` is not a promise of zero provider retention.
5. Check every extracted field. Edit quantities, unit prices, line totals, discounts, tax, fees, and the actual charged amount. A manual line-total override is labeled; editing quantity or unit price restores automatic line arithmetic.
6. Add participants and select the original payer. Assign item quantities or share an item equally, including fractional quantities. Unassigned and over-assigned items are flagged. The payer must have joined and saved transfer instructions before sending.
7. Save a private draft or send shares. Sending is blocked until all item units are assigned, the calculated and entered receipt totals agree, and no share is negative. Published bills are locked; their money amounts are recalculated and validated on the server.
8. Each participant can accept or question their share, or directly choose **I’ve paid** on any unpaid transaction after transferring outside the app. Marking paid includes an optional reference and no longer requires a separate acceptance click. The payer confirms receipt or rejects the claim with a note. **A marked-paid share remains outstanding until the payer confirms it.**
9. Overview shows both money owed and money to collect. Activity contains persistent notifications, refreshed every 30 seconds while the app is visible. Confirmed payments appear under **Paid history** and settled bills remain in history.

## inDrive rides

Choose **Add a bill → inDrive ride**, enter the complete fare, select everyone who was in the car, and choose who paid. The app splits the fare equally among all selected passengers, including the payer. The payer owes no money to themselves; their own share is excluded from the payment-request list. Other passengers see their debt and the payer's transfer details. Shares automatically recalculate when passengers change; rounding is distributed by paisa.

For example, Rs 1,200 shared by four passengers is Rs 300 each. The payer sees Rs 900 to collect, with three Rs 300 requests.

## Email notifications and payment approval

Add an email address during signup or in Profile, then enter the emailed six-digit verification code. Codes expire after 15 minutes and lock after five incorrect attempts. Email addresses remain private to their owner; they are not included in friends' profiles. Users can disable notification emails in Profile.

- A published share emails the person who owes money, once their email is verified. Pending invitees receive a catch-up notification after joining and verifying.
- **I’ve paid** changes the display to **Pending approval** and emails the recipient to check their actual bank/wallet/cash receipt.
- Only that signed-in recipient can select **Confirm received**. The debt then shows **Paid** for both people, moves to Paid history, and both receive confirmation emails.
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

All active application data is stored in your MongoDB database: profiles, hashed sessions/recovery codes, invitations, bills, debts, and activity. Each debt is stored once with debtor and creditor IDs, integer-paisa amount, and a status. The API derives `paymentStatus` as `unpaid`, `pending_confirmation`, or `paid` from that status, so flags cannot disagree. Transactions keep notifications and settlements consistent. Browser sessions remain in localStorage. OCR assets and fonts do not depend on external CDNs.

The old `data/tab-together.sqlite` file and existing local photos are untouched and ignored by Git. They are not automatically moved to MongoDB. An explicit migration script can copy existing accounts/bills without uploading photos; see the deployment guide. Back up the old data directory with the old server stopped before migrating.

Session, invitation, and recovery tokens are cryptographically random; only their hashes are stored on the server. Server-side authorization controls every bill and payment action. Drafts are creator-only. Editing uses a version check to avoid silently overwriting another device. Published shares are immutable. Keep recovery codes and invitation links private; account recovery does not revoke existing sessions.

## Verification

```sh
npm test
npm run build
```

Tests launch an isolated local MongoDB replica set; the first run may download the free MongoDB server binary. They never use your Atlas URI. Tests cover MongoDB rollback, migration preservation, case-insensitive username uniqueness and race conditions, rejected image uploads, sanitized bill fields, capped discounts, tax bases, rounding conservation across 499 variants, shared quantities, receipt mismatches, over-allocation, a real OCR pass over a synthetic receipt, parser output, persistent data, recovery, invitation claims, private drafts, authorization boundaries, concurrent edits, duplicate actions, and payment confirmation. DOM interaction tests exercise onboarding and live editor recalculation. Desktop browser visual QA was unavailable because computer-use permissions were pending.

The optional `read_my_balances` WebMCP tool is feature-detected in supported browsers. It has no write side effects. Its browser integration was not verified in this environment.

## Current scope

- English printed receipts; extraction is a draft and always needs human review. No promise of automatic perspective correction, blur detection, or accurate handwriting recognition.
- One original payer per bill; no partial repayments or automatic debt simplification.
- One receipt photo can be scanned at a time; photos are not persisted. No PDF or multi-image receipt import.
- In-app activity plus verified-email notifications using your configured free Gmail sender; no SMS or background browser push.
- Sent bills cannot yet be corrected or canceled in the interface. Resolve disputes before accepting or transferring. Creating a second bill does not cancel the first.
- Vercel deployment is prepared, but your Vercel account and a MongoDB Atlas Free database must be connected before the app can run online. See [the deployment guide](DEPLOYMENT.md).

The repository itself uses no billable service. Electricity/internet and any charges imposed by your existing software subscription are outside the app's control.
