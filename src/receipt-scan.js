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

export async function extractReceipt(
  blob,
  progress,
  { useGemini = true, send = request, ocr = scanImage } = {},
) {
  let reason = null;
  if (useGemini) {
    progress({ status: "Reading with Gemini", progress: 0 });
    try {
      const result = await send("/scan-receipt", {
        method: "POST",
        body: blob,
        headers: { "Content-Type": blob.type, "x-receipt-consent": "gemini" },
        signal: AbortSignal.timeout(30000),
      });
      if (result.source === "gemini") {
        // The server adds IDs and empty allocations; revalidate only extraction fields.
        const receipt = {
          ...result.receipt,
          items: result.receipt.items.map(
            ({ id, allocations, ...item }) => item,
          ),
        };
        return {
          source: "gemini",
          parsed: normalizeReceipt(receipt),
          text: "",
        };
      }
      reason = result.reason;
    } catch (error) {
      reason = ["TimeoutError", "AbortError"].includes(error.name)
        ? "timeout"
        : "unavailable";
    }
  }
  const fallback = useGemini
    ? `${fallbackReasons[reason] || "Gemini is unavailable"} — used private on-device OCR.`
    : "";
  progress({
    status: fallback || "Reading privately on this device",
    progress: 0,
  });
  const text = await ocr(blob, (update) =>
    progress({
      ...update,
      status: `${useGemini ? "OCR fallback" : "Private OCR"}: ${update.status}`,
    }),
  );
  return { source: "ocr", parsed: parseReceipt(text), text, fallback };
}
