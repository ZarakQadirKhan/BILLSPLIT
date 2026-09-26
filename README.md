# Tab Together

A free bill-splitting app for a group of friends. Built with React, Vite, Express, SQLite, and Tesseract.js. No paid APIs, LLMs, credit card, subscription, cloud account, or external runtime service is required.

## Run it

Requires Node.js **22.13 or newer** (Node 24 LTS recommended). Dependencies are already installed in this workspace.

```sh
npm run dev
```

Open **http://localhost:5173**. To run the production build:

```sh
npm run build
npm start
```

The server listens on port 5173. Set `PORT` to use another port. `DATA_DIR` changes the database directory. Do not run development and production servers on the same port simultaneously.

## Use with friends at no hosting cost

Keep this computer awake and the server running. On the **same trusted Wi-Fi**, friends can open `http://YOUR_COMPUTER_LAN_IP:5173`. Use that address yourself when creating invitations so the links work on their phones. Your router must allow devices to communicate, and the system firewall may need to permit Node.

This is a working shared backend, not a browser-only mockup: every connected device uses the same SQLite database. Friends cannot connect once this computer sleeps or the server stops. The app has **not** been publicly deployed and has no always-online hosting configured. No paid service was provisioned. For a future public deployment, choose and verify a no-cost host first, add HTTPS, and review its storage and usage limits. Do not expose this development server directly to the internet.

Local HTTP is for trusted Wi-Fi testing. HTTPS is needed for confidential traffic on an untrusted network, secure clipboard APIs, and a full installable/offline PWA. Clipboard fallback text is provided. There is a web app manifest, but no offline service worker or background push subscription.

## Workflow

1. Enter your name once. The device keeps an opaque session token; there is no logout button. Save the private recovery code to use the same account on another device. Clearing browser storage removes the saved session, not the account or bills.
2. Add friends and privately share their single-use invitation links. A friend can create a profile or attach the invitation to an existing account. A name alone cannot impersonate an existing person. Creating another invitation for the same unclaimed friend invalidates the old link.
3. Save your transfer instructions in **Your profile**. Only known friends and participants in shared bills can see them. The app never transfers money.
4. Add a bill. Upload a JPG/PNG/WebP, paste receipt text, or enter items manually. OCR runs on the device using bundled local English recognition data. Uploaded receipt images are saved on this computer so participants can review them.
5. Check every extracted field. Edit quantities, unit prices, line totals, discounts, tax, fees, and the actual charged amount. A manual line-total override is labeled; editing quantity or unit price restores automatic line arithmetic.
6. Add participants and select the original payer. Assign item quantities or share an item equally, including fractional quantities. Unassigned and over-assigned items are flagged. The payer must have joined and saved transfer instructions before sending.
7. Save a private draft or send shares. Sending is blocked until all item units are assigned, the calculated and entered receipt totals agree, and no share is negative. Published bills are locked; their money amounts are recalculated and validated on the server.
8. Each participant accepts or questions their share, transfers outside the app, then marks it paid with an optional reference. The payer confirms receipt or rejects the claim with a note. **A marked-paid share remains outstanding until the payer confirms it.**
9. Overview shows both money owed and money to collect. Activity contains persistent notifications, refreshed every 10 seconds while the app is visible. Settled bills remain in history.

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

The durable database, including receipt images, lives at `data/tab-together.sqlite` (ignored by Git). Back up the entire `data/` directory with the server stopped; SQLite WAL files can contain recent writes while it is running. Application data does not leave this server except to authorized participants' browsers. OCR assets and fonts do not depend on external CDNs.

Session, invitation, and recovery tokens are cryptographically random; only their hashes are stored on the server. Server-side authorization controls every bill, receipt, and payment action. Drafts are creator-only. Editing uses a version check to avoid silently overwriting another device. Published shares are immutable. Keep recovery codes and invitation links private; account recovery does not revoke existing sessions.

## Verification

```sh
npm test
npm run build
```

Tests cover capped discounts, tax bases, rounding conservation across 499 variants, shared quantities, receipt mismatches, over-allocation, a real OCR pass over a synthetic receipt, parser output, persistent data, recovery, invitation claims, private drafts, authorization boundaries, concurrent edits, duplicate actions, and payment confirmation. DOM interaction tests exercise onboarding and live editor recalculation. Desktop browser visual QA was unavailable because computer-use permissions were pending.

The optional `read_my_balances` WebMCP tool is feature-detected in supported browsers. It has no write side effects. Its browser integration was not verified in this environment.

## Current scope

- English printed receipts; extraction is a draft and always needs human review. No promise of automatic perspective correction, blur detection, or accurate handwriting recognition.
- One original payer per bill; no partial repayments or automatic debt simplification.
- One receipt image per bill; no PDF or multi-image receipt import.
- In-app activity notifications; no email, SMS, or background push.
- Sent bills cannot yet be corrected or canceled in the interface. Resolve disputes before accepting or transferring. Creating a second bill does not cancel the first.
- No public hosting or internet-wide access has been activated, to preserve the zero-spending requirement.

The repository itself uses no billable service. Electricity/internet and any charges imposed by your existing software subscription are outside the app's control.
