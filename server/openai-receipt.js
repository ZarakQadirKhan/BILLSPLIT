import { randomUUID } from "node:crypto";
import { receiptSchema, normalizeReceipt } from "../shared/receipt-schema.js";
import { receiptPrompt } from "./receipt-prompt.js";

export const OPENAI_MODEL = "gpt-6-sol";
const OUTPUT_LIMIT = 4096;
const NANO = 1e9;
// Standard pricing, with cache-write input pricing as the conservative ceiling.
// An additional 10% reserve guards rounding. These are app estimates, not invoices.
export const conservativeCost = (input, output) =>
  input * 2750 + output * 11000;
const safeLog = (data) =>
  console.info(
    "Receipt scanner:",
    JSON.stringify({ provider: "openai", ...data }),
  );
const fallback = (reason) => {
  safeLog({ event: "fallback", reason });
  return { source: "ocr", reason };
};

// Keep type/shape constraints on the wire; enforce every numerical/text bound locally.
function wireSchema(schema) {
  return Object.fromEntries(
    Object.entries(schema)
      .filter(
        ([key]) =>
          ![
            "minimum",
            "maximum",
            "exclusiveMinimum",
            "minLength",
            "maxLength",
            "minItems",
            "maxItems",
          ].includes(key),
      )
      .map(([key, value]) => [
        key,
        key === "properties"
          ? Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, wireSchema(v)]),
            )
          : key === "items"
            ? wireSchema(value)
            : value,
      ]),
  );
}

export function createOpenAIReceiptScanner(db, options = {}) {
  const key = options.key ?? process.env.OPENAI_API_KEY;
  const configuredBudget = Number(
    options.budgetUsd ?? process.env.OPENAI_BUDGET_USD ?? 5,
  );
  // Invalid settings disable paid requests. No automatic reset or credit top-up.
  const budget =
    Number.isFinite(configuredBudget) && configuredBudget > 0
      ? Math.floor(Math.min(configuredBudget, 5) * NANO)
      : 0;
  const fetcher = options.fetch ?? fetch;
  return async (bytes, mime, userId) => {
    if (!key || !budget) return fallback("not_configured");
    const signal = AbortSignal.timeout(options.timeoutMs ?? 40000);
    let stage = "preflight";
    try {
      if ((await db.rateLimit(`openai-receipt-user:${userId}`)).count > 3)
        return fallback("busy");
      if ((await db.rateLimit("openai-receipt-daily", 86400000)).count > 20)
        return fallback("daily_cap");
      const control = await db.one("ai_budget", { id: "openai-lifetime" });
      if (control?.chargedNano >= budget) return fallback("budget_cap");
      const common = {
        model: OPENAI_MODEL,
        instructions: receiptPrompt,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Extract this receipt. Return the required receipt JSON.",
              },
              {
                type: "input_image",
                image_url: `data:${mime};base64,${bytes.toString("base64")}`,
                detail: "high",
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "receipt",
            strict: true,
            schema: wireSchema(receiptSchema),
          },
        },
        reasoning: { effort: "low" },
      };
      const post = (path, body) =>
        fetcher(`https://api.openai.com/v1/responses${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          signal,
          body: JSON.stringify(body),
        });
      // Count the actual image + prompt before authorizing any generation spend.
      const countResponse = await post("/input_tokens", common);
      if (!countResponse.ok) {
        safeLog({ event: "http_error", stage, status: countResponse.status });
        await countResponse.body?.cancel();
        return fallback("preflight_failed");
      }
      const { input_tokens: inputTokens } = await countResponse.json();
      if (
        !Number.isSafeInteger(inputTokens) ||
        inputTokens < 1 ||
        inputTokens > 20000
      )
        return fallback("input_limit");
      const reservedNano = conservativeCost(inputTokens + 1024, OUTPUT_LIMIT);
      const reservationId = randomUUID();
      if (!(await db.reserveScanBudget(reservationId, reservedNano, budget)))
        return fallback("budget_cap");
      // A lost response/timeout keeps its full reservation: the provider may have billed it.
      // There are no automatic paid retries, including on 429/5xx.
      signal.throwIfAborted();
      stage = "generation";
      const response = await post("", {
        ...common,
        store: false,
        service_tier: "default",
        max_output_tokens: OUTPUT_LIMIT,
      });
      if (!response.ok) {
        safeLog({ event: "http_error", stage, status: response.status });
        await response.body?.cancel();
        return fallback(
          response.status === 429
            ? "quota"
            : [401, 403].includes(response.status)
              ? "access_denied"
              : response.status === 404
                ? "model_unavailable"
                : "unavailable",
        );
      }
      stage = "response";
      const result = await response.json();
      const usage = result.usage;
      let measurement = null;
      if (
        Number.isSafeInteger(usage?.input_tokens) &&
        usage.input_tokens >= 0 &&
        Number.isSafeInteger(usage?.output_tokens) &&
        usage.output_tokens >= 0
      ) {
        const chargedNano = conservativeCost(
          usage.input_tokens,
          usage.output_tokens,
        );
        measurement = {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          estimatedCostUsd:
            (usage.input_tokens * 2500 + usage.output_tokens * 10000) / NANO,
        };
        await db.settleScanBudget(reservationId, chargedNano, measurement);
        safeLog({ event: "usage", model: OPENAI_MODEL, ...measurement });
      }
      if (result.status !== "completed") return fallback("invalid_result");
      const output = result.output
        ?.filter((part) => part.type === "message")
        .flatMap((part) => part.content ?? [])
        .filter((part) => part.type === "output_text")
        .map((part) => part.text)
        .join("");
      if (!output || output.length > 150000) return fallback("invalid_result");
      const receipt = normalizeReceipt(JSON.parse(output));
      safeLog({ event: "success", model: OPENAI_MODEL });
      return { source: "openai", receipt, usage: measurement };
    } catch {
      return fallback(
        signal.aborted
          ? "timeout"
          : stage === "response"
            ? "invalid_result"
            : "unavailable",
      );
    }
  };
}

export function createReceiptPipeline(db, gemini, options = {}) {
  const openai = createOpenAIReceiptScanner(db, options);
  return async (bytes, mime, userId, consent) => {
    // Old cached clients consented to Google only. Never widen their permission.
    if (consent !== "openai-gemini") return gemini(bytes, mime, userId);
    const first = await openai(bytes, mime, userId);
    if (first.source === "openai") return first;
    const second = await gemini(bytes, mime, userId);
    return { ...second, openaiReason: first.reason };
  };
}
