import { parseReceipt } from "../shared/parser.js";
import { normalizeReceipt } from "../shared/receipt-schema.js";
import { request, scanImage } from "./api.js";

const fallbackReasons = {
  quota: "Gemini’s free quota is currently exhausted",
  daily_cap: "The app’s daily Gemini safety limit was reached",
  busy: "Too many scans were requested in a minute",
  service_busy: "Google’s Gemini service is temporarily busy",
  timeout: "Gemini took too long to respond",
  not_configured: "Gemini is not configured or is disabled",
  access_denied: "Google rejected the app’s Gemini API access",
  request_rejected: "Google rejected the Gemini scan request",
  model_unavailable: "The configured Gemini model is unavailable",
  invalid_result: "Gemini’s result could not be safely read",
};
const openaiReasons = {
  budget_cap: "The app’s OpenAI budget has been reached",
  daily_cap: "The app’s daily OpenAI scan limit was reached",
  quota: "OpenAI’s quota or credit limit was reached",
  timeout: "OpenAI took too long to respond",
  not_configured: "OpenAI is not configured or is disabled",
  access_denied: "OpenAI rejected the app’s API access",
  model_unavailable: "GPT-6 Sol is unavailable for this key",
  invalid_result: "OpenAI’s result could not be safely read",
  preflight_failed: "OpenAI’s cost check was unavailable",
  input_limit: "The photo exceeded the AI input limit",
  busy: "Too many AI scans were requested in a minute",
};

export async function extractReceipt(
  blob,
  progress,
  { useAI = true, useGemini, send = request, ocr = scanImage } = {},
) {
  let reason = null;
  let openaiReason = null;
  const cloud = useGemini ?? useAI;
  if (cloud) {
    progress({
      status: "Reading with AI · OpenAI, then Gemini backup",
      progress: 0,
    });
    try {
      const result = await send("/scan-receipt", {
        method: "POST",
        body: blob,
        headers: {
          "Content-Type": blob.type,
          "x-receipt-consent": useGemini === true ? "gemini" : "openai-gemini",
        },
        signal: AbortSignal.timeout(75000),
      });
      openaiReason = result.openaiReason;
      if (["openai", "gemini"].includes(result.source)) {
        // The server adds IDs and empty allocations; revalidate only extraction fields.
        const receipt = {
          ...result.receipt,
          items: result.receipt.items.map(
            ({ id, allocations, ...item }) => item,
          ),
        };
        return {
          source: result.source,
          parsed: normalizeReceipt(receipt),
          text: "",
          usage: result.usage,
          fallback: openaiReason
            ? `${openaiReasons[openaiReason] || "OpenAI is unavailable"} — read with Gemini.`
            : "",
        };
      }
      reason = result.reason;
    } catch (error) {
      reason = ["TimeoutError", "AbortError"].includes(error.name)
        ? "timeout"
        : "unavailable";
    }
  }
  const fallback = cloud
    ? `${openaiReason ? (openaiReasons[openaiReason] || "OpenAI is unavailable") + ". " : ""}${fallbackReasons[reason] || "AI scanning is unavailable"} — used private on-device OCR.`
    : "";
  progress({
    status: fallback || "Reading privately on this device",
    progress: 0,
  });
  const text = await ocr(blob, (update) =>
    progress({
      ...update,
      status: `${cloud ? "OCR fallback" : "Private OCR"}: ${update.status}`,
    }),
  );
  return { source: "ocr", parsed: parseReceipt(text), text, fallback };
}
