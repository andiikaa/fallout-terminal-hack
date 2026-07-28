// PaddleOCR (PP-OCRv6) pipeline via ppu-paddle-ocr running fully in-browser on
// onnxruntime-web (WebGPU when available, WASM otherwise). Far more robust than
// Tesseract on the stylized ROBCO CRT font, and returns per-region bounding
// boxes so we can rebuild the two-column memory layout geometrically.

import { PaddleOcrService, V5_EN_MOBILE_MODEL } from 'ppu-paddle-ocr/web';

let servicePromise = null;

function getService(onProgress) {
  if (!servicePromise) {
    servicePromise = (async () => {
      onProgress?.('loading models', 0);
      // PP-OCRv5 English mobile: far more accurate on the stylized ROBCO CRT
      // font than the default v6 multilingual model (which misreads the
      // monospace glyphs and even hallucinates CJK characters).
      const service = new PaddleOcrService({ model: V5_EN_MOBILE_MODEL });
      // Downloads + caches the model on first run.
      await service.initialize();
      onProgress?.('ready', 1);
      return service;
    })();
  }
  return servicePromise;
}

/**
 * Load a File/Blob into a canvas honoring EXIF orientation (iPhone photos).
 * NOTE: iOS Safari support for `imageOrientation: 'from-image'` is spotty, so
 * the image may still arrive sideways — recognizeRegions corrects for that.
 */
async function fileToCanvas(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  // Cap size so mobile Safari doesn't run out of memory on 48MP photos.
  const maxSide = 2200;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

/** Return a new canvas with `src` rotated clockwise by 0/90/180/270 degrees. */
function rotateCanvas(src, deg) {
  if (deg === 0) return src;
  const rad = (deg * Math.PI) / 180;
  const swap = deg === 90 || deg === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? src.height : src.width;
  canvas.height = swap ? src.width : src.height;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return canvas;
}

/** In-place separable box blur of a Float32 plane; returns a new plane. */
function boxBlur(src, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = radius * 2 + 1;
  // Horizontal pass.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      const add = src[row + Math.min(w - 1, x + radius + 1)];
      const sub = src[row + Math.max(0, x - radius)];
      sum += add - sub;
    }
  }
  // Vertical pass.
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      const add = tmp[Math.min(h - 1, y + radius + 1) * w + x];
      const sub = tmp[Math.max(0, y - radius) * w + x];
      sum += add - sub;
    }
  }
  return out;
}

/**
 * Flatten CRT glare/reflection via background subtraction (flat-field):
 * estimate the smooth glare gradient with a large box blur and subtract it, so
 * the smooth bright blob is removed while the sharp green text survives. Keeps
 * the result grayscale (PaddleOCR converts internally anyway).
 */
function flattenGlare(src) {
  const w = src.width;
  const h = src.height;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    // Bias toward green: the CRT text is green, glare is broadband/white.
    lum[p] = 0.15 * d[i] + 0.75 * d[i + 1] + 0.1 * d[i + 2];
  }
  // Radius ~ a few text rows so words survive but the glare blob is averaged out.
  const radius = Math.max(12, Math.round(Math.min(w, h) / 24));
  const bg = boxBlur(lum, w, h, radius);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let v = 128 + (lum[p] - bg[p]) * 1.5;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').putImageData(img, 0, 0);
  return out;
}

// A ROBCO board is anchored by ~20+ `0x####` addresses per column. Counting how
// many regions look like an address is a strong, cheap signal of a good read —
// near-zero when the image is sideways or unreadable.
const ADDR_LIKE = /[0-9A-FO]X[0-9A-FO]{2,4}/i;
function gridScore(regions) {
  let n = 0;
  for (const r of regions) if (ADDR_LIKE.test((r.text || '').toUpperCase())) n++;
  return n;
}

const STRONG_READ = 12; // address anchors => confidently a correct, upright read

/**
 * Recognize a Fallout terminal image with PaddleOCR, correcting for arbitrary
 * photo rotation and CRT glare.
 *
 * 1. ORIENTATION: try each 90° rotation and keep whichever finds the most
 *    memory addresses (short-circuiting once one clearly works). Handles iOS
 *    photos whose EXIF orientation the browser didn't apply.
 * 2. GLARE: at the winning orientation, also run a glare-flattened pass. The
 *    raw and flattened passes recover *different* words (reflections wash out
 *    different regions), so both are returned and the caller unions them.
 *
 * Returns { passes } — an array of region lists (raw first, glare second),
 * each region being { text, position: { x, y, width, height } }.
 */
export async function recognizeRegions(file, { previewCanvas, onProgress } = {}) {
  const base = await fileToCanvas(file);
  const service = await getService(onProgress);

  // --- 1. Find the orientation that reads the most of the memory grid. ---
  let best = null;
  const orientations = [0, 90, 270, 180];
  for (let i = 0; i < orientations.length; i++) {
    const deg = orientations[i];
    onProgress?.(deg ? `reading (rotated ${deg}°)` : 'reading', 0.4);
    const canvas = rotateCanvas(base, deg);
    const result = await service.recognize(canvas, { flatten: true });
    const regions = result.results || [];
    const score = gridScore(regions);
    if (!best || score > best.score) best = { score, regions, canvas };
    if (score >= STRONG_READ) break; // clearly upright & readable — stop early
  }

  const passes = [best.regions];

  // --- 2. Second pass with glare flattened, to recover washed-out words. ---
  onProgress?.('reducing glare', 0.8);
  try {
    const canvas = flattenGlare(best.canvas);
    const result = await service.recognize(canvas, { flatten: true });
    const regions = result.results || [];
    if (regions.length) passes.push(regions);
  } catch (err) {
    console.warn('glare pass failed:', err);
  }

  if (previewCanvas) {
    previewCanvas.width = best.canvas.width;
    previewCanvas.height = best.canvas.height;
    previewCanvas.getContext('2d').drawImage(best.canvas, 0, 0);
  }
  onProgress?.('done', 1);
  return { passes };
}
