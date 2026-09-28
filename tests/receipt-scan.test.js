import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { createApi } from "../server/api.js";
import { createReceiptScanner, GEMINI_MODEL } from "../server/receipt-scan.js";
import { normalizeReceipt } from "../shared/receipt-schema.js";
import { extractReceipt } from "../src/receipt-scan.js";

const sample = () => ({
  title: "Cafe Demo",
  items: [
    {
      name: "Cold drinks",
      quantity: 6,
      unitPriceCents: 20000,
      lineTotalCents: 120000,
      eligible: true,
      uncertain: false,
    },
  ],
  charges: {
    discountCents: null,
    discountRate: 50,
    eligibleCapCents: 2000000,
    maxDiscountCents: null,
    taxCents: 5000,
    taxRate: 5,
    taxBasis: null,
    deliveryCents: null,
    serviceCents: null,
    tipCents: null,
  },
  receiptTotalCents: 125000,
  warnings: [],
});
const photo = readFileSync(new URL("./fixtures/receipt.png", import.meta.url));
const ok = (value) => ({
  ok: true,
  json: async () => ({
    status: "completed",
    outputs: [{ type: "text", text: JSON.stringify(value) }],
  }),
});

test("receipt schema rejects malformed data and preserves caps and printed mismatches", () => {
  const value = sample();
  value.items[0].lineTotalCents = 119999;
  const normalized = normalizeReceipt(value);
  assert.equal(normalized.items[0].lineTotalCents, 119999);
  assert.equal(normalized.charges.eligibleCapCents, 2000000);
  assert.equal(normalized.charges.maxDiscountCents, null);
  assert.deepEqual(normalized.items[0].allocations, []);
  assert.match(normalized.warnings[0], /differs/);
  for (const patch of [
    { quantity: -1 },
    { quantity: "6" },
    { unitPriceCents: 1.5 },
    { unitPriceCents: null, lineTotalCents: null },
    { name: "" },
    { allocations: [{ personId: "hacker", quantity: 6 }] },
  ]) {
    const bad = sample();
    Object.assign(bad.items[0], patch);
    assert.throws(() => normalizeReceipt(bad));
  }
  assert.throws(() => normalizeReceipt({ ...sample(), photo: "secret" }));
  assert.throws(() => normalizeReceipt({ ...sample(), items: [] }));
});

test("authenticated scan route enforces consent, limits, privacy and shared daily budget", async (t) => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  let calls = 0,
    mode = "ok";
  const apiOptions = {
    uri: replica.getUri(),
    databaseName: "receipt_test",
    mail: {},
    scanner: {
      key: "test-only-key",
      dailyLimit: 2,
      fetch: async (url, options) => {
        calls++;
        assert.equal(
          url,
          "https://generativelanguage.googleapis.com/v1beta/interactions",
        );
        assert.equal(options.headers["x-goog-api-key"], "test-only-key");
        const payload = JSON.parse(options.body);
        assert.equal(payload.model, GEMINI_MODEL);
        assert.equal(payload.store, false);
        assert.match(payload.system_instruction, /EXAMPLE A/);
        assert.match(payload.system_instruction, /untrusted DATA/);
        assert.equal(payload.response_format.mime_type, "application/json");
        assert.equal(payload.input[1].data, photo.toString("base64"));
        return mode === "ok" ? ok(sample()) : { ok: false, status: 429 };
      },
    },
  };
  const { api, db } = await createApi(undefined, apiOptions),
    app = express();
  app.use("/api", api);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await db.close();
    await replica.stop();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const register = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test", username: "receipt_tester" }),
  });
  const { token, user } = await register.json();
  const send = (headers = {}, body = photo) =>
    fetch(`${base}/scan-receipt`, {
      method: "POST",
      headers: { "Content-Type": "image/png", ...headers },
      body,
    });
  assert.equal((await send()).status, 401);
  assert.equal((await send({ Authorization: `Bearer ${token}` })).status, 400);
  const headers = {
    Authorization: `Bearer ${token}`,
    "x-receipt-consent": "gemini",
  };
  assert.equal((await send(headers, Buffer.from("not an image"))).status, 400);
  assert.equal(
    (await send(headers, Buffer.alloc(2 * 1024 * 1024 + 1))).status,
    413,
  );
  assert.equal(calls, 0);
  const result = await (await send(headers)).json();
  assert.equal(result.source, "gemini");
  assert.equal(result.receipt.items[0].quantity, 6);
  assert.equal(
    (await db.many("bills")).length,
    0,
    "scanning does not create a bill",
  );
  assert.equal(
    (await db.many("debts")).length,
    0,
    "scanning does not create a debt",
  );
  const second = await createApi(undefined, apiOptions);
  try {
    const anotherScanner = createReceiptScanner(second.db, apiOptions.scanner);
    assert.equal(
      (await anotherScanner(photo, "image/png", user.id)).source,
      "gemini",
    );
    assert.equal(
      (await anotherScanner(photo, "image/png", user.id)).reason,
      "daily_cap",
    );
    assert.equal(calls, 2, "daily cap shared across server instances");
  } finally {
    await second.db.close();
  }
  await db.remove("rate_limits", {});
  mode = "quota";
  assert.equal((await (await send(headers)).json()).reason, "quota");
  assert.equal((await (await send(headers)).json()).reason, "quota");
  assert.equal(calls, 3, "cooldown prevents immediate provider retry");
  const stored = JSON.stringify(await db.many("rate_limits"));
  assert.ok(
    !stored.includes("test-only-key") &&
      !stored.includes(photo.toString("base64")),
  );
});

test("provider faults and invalid responses request OCR, without leaking provider errors", async () => {
  const db = {
    one: async () => null,
    rateLimit: async () => ({ count: 1 }),
    update: async () => {},
  };
  for (const fetcher of [
    async () => {
      throw Error("SECRET provider error");
    },
    async () => ({ ok: false, status: 403 }),
    async () => ok({ ...sample(), items: [] }),
    async () => ({ ok: true, json: async () => ({ status: "incomplete" }) }),
    async () => ({
      ok: true,
      json: async () => ({
        status: "completed",
        outputs: [{ type: "text", text: "not json" }],
      }),
    }),
  ]) {
    const result = await createReceiptScanner(db, {
      key: "secret",
      fetch: fetcher,
    })(photo, "image/png", "tester");
    assert.equal(result.source, "ocr");
    assert.ok(!JSON.stringify(result).includes("SECRET"));
  }
  assert.equal(
    (await createReceiptScanner(db, { key: "" })(photo, "image/png", "tester"))
      .reason,
    "not_configured",
  );
});

test("temporary provider outages retry once, within the same deadline and daily budget", async () => {
  let calls = 0,
    pauses = 0,
    daily = 0;
  const signals = [];
  const db = {
    one: async () => null,
    rateLimit: async (key) => ({
      count: key === "receipt-daily" ? ++daily : 1,
    }),
    update: async () => {},
  };
  const scan = createReceiptScanner(db, {
    key: "test-only-key",
    pause: async (ms) => {
      pauses++;
      assert.ok(ms >= 1000 && ms <= 2000);
    },
    fetch: async (_url, options) => {
      signals.push(options.signal);
      return ++calls === 1 ? { ok: false, status: 503 } : ok(sample());
    },
  });
  assert.equal((await scan(photo, "image/png", "tester")).source, "gemini");
  assert.equal(calls, 2);
  assert.equal(pauses, 1);
  assert.equal(daily, 2);
  assert.equal(signals[0], signals[1], "retry must not extend the timeout");

  for (const [status, attempts, reason] of [
    [503, 2, "service_busy"],
    [502, 2, "service_busy"],
    [504, 2, "service_busy"],
    [429, 1, "quota"],
    [400, 1, "request_rejected"],
    [403, 1, "access_denied"],
    [404, 1, "model_unavailable"],
  ]) {
    calls = 0;
    daily = 0;
    const result = await createReceiptScanner(db, {
      key: "test-only-key",
      pause: async () => {},
      fetch: async () => {
        calls++;
        return { ok: false, status };
      },
    })(photo, "image/png", "tester");
    assert.equal(result.reason, reason);
    assert.equal(calls, attempts);
  }
  calls = 0;
  daily = 0;
  const capped = await createReceiptScanner(db, {
    key: "test-only-key",
    dailyLimit: 1,
    pause: async () => {},
    fetch: async () => {
      calls++;
      return { ok: false, status: 503 };
    },
  })(photo, "image/png", "tester");
  assert.equal(capped.reason, "daily_cap");
  assert.equal(calls, 1, "retry cannot bypass the daily cap");

  calls = 0;
  daily = 0;
  const longWait = await createReceiptScanner(db, {
    key: "test-only-key",
    pause: async () => assert.fail("must not ignore Retry-After"),
    fetch: async () => {
      calls++;
      return {
        ok: false,
        status: 503,
        headers: new Headers({ "Retry-After": "60" }),
      };
    },
  })(photo, "image/png", "tester");
  assert.equal(longWait.reason, "service_busy");
  assert.equal(calls, 1);
});

test("receipt format preserves quantity/value rows and unresolved cash/card totals", () => {
  const receipt = sample();
  receipt.items = [
    {
      name: "Seafood",
      quantity: 2,
      unitPriceCents: null,
      lineTotalCents: 1200000,
      eligible: true,
      uncertain: false,
    },
    {
      name: "Pepsi Black",
      quantity: 2,
      unitPriceCents: null,
      lineTotalCents: 50000,
      eligible: true,
      uncertain: false,
    },
  ];
  receipt.charges.taxCents = null;
  receipt.charges.taxRate = null;
  receipt.receiptTotalCents = null;
  receipt.warnings = ["Choose the card or cash tax and total actually paid."];
  const parsed = normalizeReceipt(receipt);
  assert.equal(parsed.items[0].unitPriceCents, 600000);
  assert.equal(parsed.items[1].unitPriceCents, 25000);
  assert.equal(parsed.receiptTotalCents, null);
  assert.equal(parsed.charges.taxCents, null);
  assert.match(parsed.warnings[0], /card or cash/);
});

test("client uses valid Gemini output, falls back once, and private mode makes no API call", async () => {
  let sends = 0,
    ocrs = 0;
  const ocr = async () => {
    ocrs++;
    return "Cold drinks 6 x 200 1200\nTotal 1200";
  };
  const blob = new Blob([photo], { type: "image/png" });
  let result = await extractReceipt(blob, () => {}, {
    send: async () => {
      sends++;
      return { source: "gemini", receipt: normalizeReceipt(sample()) };
    },
    ocr,
  });
  assert.equal(result.source, "gemini");
  assert.equal(ocrs, 0);
  for (const send of [
    async () => ({ source: "ocr", reason: "quota" }),
    async () => {
      throw Error("timeout");
    },
    async () => ({ source: "gemini", receipt: {} }),
  ]) {
    result = await extractReceipt(blob, () => {}, { send, ocr });
    assert.equal(result.source, "ocr");
    assert.equal(result.parsed.items[0].quantity, 6);
    assert.ok(result.fallback);
  }
  await extractReceipt(blob, () => {}, {
    useGemini: false,
    send: async () => {
      sends++;
    },
    ocr,
  });
  assert.equal(sends, 1);
  assert.equal(ocrs, 4);
  result = await extractReceipt(blob, () => {}, {
    send: async () => ({ source: "ocr", reason: "service_busy" }),
    ocr,
  });
  assert.match(result.fallback, /Google’s Gemini service is temporarily busy/);
  assert.equal(ocrs, 5);
});
