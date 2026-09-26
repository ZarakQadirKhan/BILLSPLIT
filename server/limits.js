// Keep uploads beneath Vercel's 4.5 MB function payload limit and libSQL's
// encoded-request overhead. OCR still runs in the browser.
export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
