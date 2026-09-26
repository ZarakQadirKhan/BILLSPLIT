import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'no-referrer'); res.set('X-Frame-Options', 'SAMEORIGIN'); next(); });
const { api, db } = createApi(process.env.DATA_DIR || path.join(root, 'data'));
app.use('/api', api);
app.use('/ocr/worker', express.static(path.join(root, 'node_modules/tesseract.js/dist')));
app.use('/ocr/core', express.static(path.join(root, 'node_modules/tesseract.js-core')));
app.use('/ocr/lang', express.static(path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int')));
const dev = process.argv.includes('--dev');
if (dev) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));
}
const port = Number(process.env.PORT || 5173);
const server = app.listen(port, '0.0.0.0', () => console.log(`Tab Together: http://localhost:${port}`));
// Node 25 can treat the Express listener as unreferenced with this SQLite setup.
// This timer keeps the local appliance process alive; normal SIGINT still stops it.
setInterval(() => {}, 60 * 60 * 1000);
