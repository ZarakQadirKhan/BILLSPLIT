import { mkdir, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const part of ['worker', 'core', 'lang']) await mkdir(path.join(root, 'dist/ocr', part), { recursive: true });
await copyFile(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'), path.join(root, 'dist/ocr/worker/worker.min.js'));
for (const name of await readdir(path.join(root, 'node_modules/tesseract.js-core'))) {
  if (/^tesseract-core.*\.(wasm|js)$/.test(name)) await copyFile(path.join(root, 'node_modules/tesseract.js-core', name), path.join(root, 'dist/ocr/core', name));
}
await copyFile(path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), path.join(root, 'dist/ocr/lang/eng.traineddata.gz'));
console.log('Bundled OCR worker, WASM, and English data into dist/ocr (no external OCR service).');
