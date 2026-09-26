import express from 'express';
import { createApi } from '../server/api.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});
let ready;
function getApi() {
  if (!ready) ready = createApi(undefined, { requireRemote: true }).catch(error => { ready = null; throw error; });
  return ready;
}
app.use('/api', async (req, res, next) => {
  try { const { api } = await getApi(); api(req, res, next); }
  catch (error) {
    console.error('Database initialization failed:', error.code || error.name);
    res.status(503).json({ error: 'The online database is not ready. The app owner needs to check its database settings.' });
  }
});

// The rewrite passes the original API suffix explicitly, so nested routes are
// preserved regardless of how the platform presents the rewritten request URL.
export default function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = req.query?.__route ?? url.searchParams.get('__route');
  if (typeof route === 'string') req.url = `/api/${route.replace(/^\/+/, '')}`;
  return app(req, res);
}
