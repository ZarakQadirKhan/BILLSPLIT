import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';
import { parseReceipt } from '../shared/parser.js';

test('bundled OCR reads a receipt without network access or a paid API', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const worker = await createWorker('eng', 1, { langPath: path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int'), cacheMethod: 'none' });
  try {
    const { data } = await worker.recognize(path.join(root, 'tests/fixtures/receipt.png'));
    assert.match(data.text, /Burger/i); assert.match(data.text, /Cold Drink/i); assert.match(data.text, /2320/);
    const parsed = parseReceipt(data.text);
    assert.equal(parsed.receiptTotalCents, 232000);
    assert.equal(parsed.items.find(i => /Cold Drink/i.test(i.name)).quantity, 6);
    assert.equal(parsed.items.find(i => /Burger/i.test(i.name)).unitPriceCents, 85000);
  } finally { await worker.terminate(); }
});
