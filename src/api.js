export function token() { return localStorage.getItem('tab-together-session'); }
export async function request(path, options = {}) {
  const headers = { ...(options.body && !(options.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...options.headers };
  const response = await fetch(`/api${path}`, { ...options, headers, body: options.body && !(options.body instanceof Blob) ? JSON.stringify(options.body) : options.body });
  if (!response.ok) { const data = await response.json().catch(() => ({})); const error = Error(data.error || 'Could not connect. Your unsaved changes are still here.'); error.status = response.status; throw error; }
  return response.json();
}
export function saveSession(value) { localStorage.setItem('tab-together-session', value); }
export async function prepareImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw Error('Choose a JPG, PNG, or WebP receipt.');
  if (file.size > 20 * 1024 * 1024) throw Error('Choose a receipt image smaller than 20 MB.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  for (const quality of [.9, .75, .6, .45]) {
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('Could not read this image.')), 'image/jpeg', quality));
    if (blob.size <= 2 * 1024 * 1024) return blob;
  }
  throw Error('This image is too large after compression. Crop the receipt and try again.');
}
export async function scanImage(blob, progress) {
  const { createWorker } = await import('tesseract.js'); let worker;
  try { worker = await createWorker('eng', 1, { workerPath: '/ocr/worker/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang', workerBlobURL: false, logger: message => progress({ status: message.status, progress: message.progress || 0 }) }); const { data } = await worker.recognize(blob); return data.text; }
  finally { if (worker) await worker.terminate(); }
}
