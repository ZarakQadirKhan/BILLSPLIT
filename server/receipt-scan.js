import { receiptSchema, normalizeReceipt } from "../shared/receipt-schema.js";
import { receiptPrompt } from "./receipt-prompt.js";

export const GEMINI_MODEL = "gemini-3.8-flash";
export function validReceiptImage(bytes, mime) {
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > 2 * 1024 * 1024
  )
    return false;
  return mime === "image/jpeg"
    ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === "image/png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === "image/webp" &&
        bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP";
}

export function createReceiptScanner(db, options = {}) {
  const key = options.key ?? process.env.GEMINI_API_KEY;
  const fetcher = options.fetch ?? fetch;
  const configuredLimit = Number(
    options.dailyLimit ?? process.env.GEMINI_DAILY_LIMIT ?? 20,
  );
  const dailyLimit =
    Number.isInteger(configuredLimit) && configuredLimit >= 0
      ? Math.min(configuredLimit, 100)
      : 20;
  return async function scan(bytes, mime, userId) {
    const fallback = (reason) => ({ source: "ocr", reason });
    if (!key || !dailyLimit) return fallback("not_configured");
    try {
      const cooldown = await db.one("rate_limits", { id: "gemini-cooldown" });
      if (cooldown && new Date(cooldown.expires_at) > new Date())
        return fallback("quota");
      if ((await db.rateLimit(`receipt-user:${userId}`)).count > 3)
        return fallback("busy");
      // Atomic, shared across Vercel instances. Only counters are persisted, never images.
      if ((await db.rateLimit("receipt-daily", 86400000)).count > dailyLimit)
        return fallback("daily_cap");
      const response = await fetcher(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          signal: AbortSignal.timeout(options.timeoutMs ?? 25000),
          body: JSON.stringify({
            model: GEMINI_MODEL,
            store: false,
            system_instruction: receiptPrompt,
            input: [
              {
                type: "text",
                text: "Extract this receipt. Return the required receipt JSON.",
              },
              {
                type: "image",
                mime_type: mime,
                data: bytes.toString("base64"),
              },
            ],
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: receiptSchema,
            },
            generation_config: {
              max_output_tokens: 12000,
              thinking_level: "low",
            },
          }),
        },
      );
      if (!response.ok) {
        if (response.status === 429)
          await db.update(
            "rate_limits",
            { id: "gemini-cooldown" },
            { $set: { expires_at: new Date(Date.now() + 60000) } },
            { upsert: true },
          );
        // No provider error bodies, keys, image bytes, or extracted personal data in logs.
        console.info(
          "Receipt scanner:",
          JSON.stringify({ status: response.status }),
        );
        return fallback(response.status === 429 ? "quota" : "unavailable");
      }
      const result = await response.json();
      if (result.status !== "completed") return fallback("invalid_result");
      const output =
        result.output_text ??
        result.outputs
          ?.filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
      if (typeof output !== "string" || output.length > 150000)
        return fallback("invalid_result");
      const receipt = normalizeReceipt(JSON.parse(output));
      return { source: "gemini", receipt };
    } catch {
      return fallback("unavailable");
    }
  };
}
