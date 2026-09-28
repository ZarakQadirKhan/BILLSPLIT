import { parseReceipt } from "../shared/parser.js";
import { normalizeReceipt } from "../shared/receipt-schema.js";
import { request, scanImage } from "./api.js";

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
    } catch {
      reason = "unavailable";
    }
  }
  const fallback = useGemini
    ? ["quota", "daily_cap", "busy"].includes(reason)
      ? "Gemini limit reached — used private on-device OCR."
      : "Gemini unavailable — used private on-device OCR."
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
