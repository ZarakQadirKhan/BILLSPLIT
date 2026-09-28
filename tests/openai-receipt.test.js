import test from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { openDatabase } from "../server/database.js";
import {
  createOpenAIReceiptScanner,
  createReceiptPipeline,
  conservativeCost,
} from "../server/openai-receipt.js";
import { extractReceipt } from "../src/receipt-scan.js";

const receipt = {
  title: "Dinner",
  items: [
    {
      name: "Drinks",
      quantity: 6,
      unitPriceCents: null,
      lineTotalCents: 120000,
      eligible: true,
      uncertain: false,
    },
  ],
  charges: {
    discountCents: null,
    discountRate: null,
    eligibleCapCents: null,
    maxDiscountCents: null,
    taxCents: null,
    taxRate: null,
    taxBasis: null,
    deliveryCents: null,
    serviceCents: null,
    tipCents: null,
  },
  receiptTotalCents: 120000,
  warnings: [],
};
const photo = Buffer.from([255, 216, 255, 0]);
const json = (data) => ({ ok: true, json: async () => data });
const completion = () => ({
  status: "completed",
  usage: { input_tokens: 2000, output_tokens: 500 },
  output: [
    {
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(receipt) }],
    },
  ],
});

test("OpenAI pipeline: shared spending guard, exact consent, failure accounting and provider order", async (t) => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const options = { uri: replica.getUri(), databaseName: "openai_test" };
  const db = await openDatabase(null, options),
    other = await openDatabase(null, options);
  t.after(async () => {
    await db.close();
    await other.close();
    await replica.stop();
  });
  let calls = [],
    resultFactory = completion,
    geminiCalls = 0;
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(url);
    assert.equal(body.model, "gpt-6-sol");
    assert.equal(body.text.format.strict, true);
    assert.match(body.instructions, /EXAMPLE A/);
    assert.match(
      body.input[0].content[1].image_url,
      /^data:image\/jpeg;base64,/,
    );
    if (url.endsWith("/input_tokens")) return json({ input_tokens: 2000 });
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 4096);
    assert.equal(body.service_tier, "default");
    return resultFactory();
  };
  resultFactory = () => json(completion());
  const gemini = async () => {
    geminiCalls++;
    return { source: "gemini", receipt };
  };
  const scannerOptions = { key: "fake-unit-test-key", fetch: fetcher };
  const pipeline = createReceiptPipeline(db, gemini, scannerOptions);
  const reset = async () => {
    calls = [];
    geminiCalls = 0;
    await db.update(
      "ai_budget",
      { id: "openai-lifetime" },
      { $set: { chargedNano: 0 } },
    );
    await db.remove("ai_usage", {});
    await db.remove("rate_limits", {});
    resultFactory = () => json(completion());
  };
  await t.test(
    "OpenAI succeeds first and charges measured tokens; no images persisted",
    async () => {
      const result = await pipeline(photo, "image/jpeg", "u", "openai-gemini");
      assert.equal(result.source, "openai");
      assert.equal(geminiCalls, 0);
      assert.equal(result.receipt.items[0].unitPriceCents, 20000);
      assert.equal(result.usage.estimatedCostUsd, 0.01);
      const budget = await db.one("ai_budget", { id: "openai-lifetime" });
      assert.equal(budget.chargedNano, conservativeCost(2000, 500));
      const row = (await db.many("ai_usage"))[0];
      assert.deepEqual(
        Object.keys(row).sort(),
        [
          "id",
          "reservedNano",
          "status",
          "createdAt",
          "chargedNano",
          "usage",
        ].sort(),
      );
      await db.settleScanBudget(row.id, 0, {});
      assert.equal(
        (await db.one("ai_budget", { id: "openai-lifetime" })).chargedNano,
        budget.chargedNano,
      );
      const client = await extractReceipt(
        new Blob([photo], { type: "image/jpeg" }),
        () => {},
        {
          send: async (_, opts) => {
            assert.equal(opts.headers["x-receipt-consent"], "openai-gemini");
            return result;
          },
          ocr: () => {
            throw Error("must not use OCR");
          },
        },
      );
      assert.equal(client.source, "openai");
    },
  );
  await t.test(
    "old Google-only consent and missing/disabled OpenAI never call OpenAI",
    async () => {
      await reset();
      assert.equal(
        (await pipeline(photo, "image/jpeg", "u", "gemini")).source,
        "gemini",
      );
      for (const config of [
        { key: "" },
        { budgetUsd: 0 },
        { budgetUsd: "invalid" },
      ]) {
        const scan = createReceiptPipeline(db, gemini, {
          ...scannerOptions,
          ...config,
        });
        assert.equal(
          (await scan(photo, "image/jpeg", "u", "openai-gemini")).source,
          "gemini",
        );
      }
      assert.equal(calls.length, 0);
    },
  );
  await t.test(
    "two instances cannot reserve beyond the cumulative budget",
    async () => {
      await reset();
      const reservation = conservativeCost(3024, 4096);
      const approvals = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          (i % 2 ? db : other).reserveScanBudget(
            `parallel-${i}`,
            reservation,
            reservation * 2,
          ),
        ),
      );
      assert.equal(approvals.filter(Boolean).length, 2);
      assert.equal(
        (await db.one("ai_budget", { id: "openai-lifetime" })).chargedNano,
        reservation * 2,
      );
      const scan = createOpenAIReceiptScanner(db, {
        ...scannerOptions,
        budgetUsd: 0.01,
      });
      assert.equal((await scan(photo, "image/jpeg", "u")).reason, "budget_cap");
      assert.equal(calls.length, 0);
    },
  );
  await t.test(
    "unknown costs stay reserved; errors fall through without paid retries",
    async () => {
      for (const failure of [
        () => ({ ok: false, status: 429 }),
        () => ({ ok: false, status: 503 }),
        () => {
          throw Error("connection lost");
        },
      ]) {
        await reset();
        resultFactory = failure;
        const result = await pipeline(
          photo,
          "image/jpeg",
          "u",
          "openai-gemini",
        );
        assert.equal(result.source, "gemini");
        assert.ok(result.openaiReason);
        assert.equal(calls.length, 2);
        assert.equal(geminiCalls, 1);
        assert.equal(
          (await db.one("ai_budget", { id: "openai-lifetime" })).chargedNano,
          conservativeCost(3024, 4096),
        );
        assert.equal((await db.many("ai_usage"))[0].status, "reserved");
      }
    },
  );
  await t.test(
    "malformed and truncated output still account for billed tokens before falling back",
    async () => {
      for (const payload of [
        { ...completion(), status: "incomplete" },
        { ...completion(), output: [] },
        {
          ...completion(),
          output: [
            { type: "message", content: [{ type: "output_text", text: "{}" }] },
          ],
        },
      ]) {
        await reset();
        resultFactory = () => json(payload);
        assert.equal(
          (await pipeline(photo, "image/jpeg", "u", "openai-gemini")).source,
          "gemini",
        );
        assert.equal(
          (await db.one("ai_budget", { id: "openai-lifetime" })).chargedNano,
          conservativeCost(2000, 500),
        );
      }
    },
  );
  await t.test(
    "failed token preflight never authorizes generation",
    async () => {
      await reset();
      for (const response of [
        { ok: false, status: 404 },
        json({ input_tokens: 30000 }),
        json({}),
      ]) {
        let attempts = 0;
        const scan = createOpenAIReceiptScanner(db, {
          ...scannerOptions,
          fetch: async () => {
            attempts++;
            return response;
          },
        });
        assert.equal(
          (await scan(photo, "image/jpeg", `u${Math.random()}`)).source,
          "ocr",
        );
        assert.equal(attempts, 1);
      }
      assert.equal((await db.many("ai_usage")).length, 0);
    },
  );
  await t.test(
    "both providers fail then client runs OCR exactly once; private mode skips both",
    async () => {
      await reset();
      resultFactory = () => ({ ok: false, status: 503 });
      const chain = createReceiptPipeline(
        db,
        async () => ({ source: "ocr", reason: "quota" }),
        scannerOptions,
      );
      let ocrs = 0,
        sends = 0;
      const opts = {
        send: async () => {
          sends++;
          return chain(photo, "image/jpeg", "u", "openai-gemini");
        },
        ocr: async () => {
          ocrs++;
          return "Drinks 6 x 200 1200\nTotal 1200";
        },
      };
      assert.equal(
        (await extractReceipt(new Blob([photo]), () => {}, opts)).source,
        "ocr",
      );
      await extractReceipt(new Blob([photo]), () => {}, {
        ...opts,
        useAI: false,
      });
      assert.equal(ocrs, 2);
      assert.equal(sends, 1);
    },
  );
});
