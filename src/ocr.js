// OCR pipeline tuned for Fallout's ROBCO terminal: bright green monospace text
// on a black CRT background, mixed with junk symbols.
//
// Strategy: heavy canvas preprocessing (downscale for phone photos, grayscale,
// contrast/threshold, upscale) then Tesseract.js with an A-Z whitelist.

import { createWorker } from 'tesseract.js';

let workerPromise = null;

function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng', 1, {
        logger: (m) => {
          if (onProgress && m.status && typeof m.progress === 'number') {
            onProgress(m.status, m.progress);
          }
        },
      });
      await worker.setParameters({
        // Uppercase letters plus digits + x, so the 0xXXXX memory addresses
        // survive OCR and can be used to reconstruct words that wrap across rows.
        tessedit_char_whitelist:
          'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789x',
        // Sparse text: find as much text as possible, no assumed layout.
        tessedit_pageseg_mode: '11',
        preserve_interword_spaces: '1',
      });
      return worker;
    })();
  }
  return workerPromise;
}

/**
 * Load a File/Blob into an ImageBitmap honoring EXIF orientation (iPhone!).
 */
async function loadBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Fallback for browsers ignoring the option.
    return await createImageBitmap(file);
  }
}

/**
 * Preprocess into a high-contrast black-on-white canvas for OCR.
 * Draws the result into `previewCanvas` if provided.
 */
export function preprocess(bitmap, previewCanvas) {
  // Downscale huge phone photos; upscale small ones. Target ~1600px on long side.
  const target = 1600;
  const scale = target / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // Emphasize the green channel (CRT text is green), then threshold.
  // Compute a luminance-ish value biased toward green.
  const lum = new Float32Array(w * h);
  let min = 255;
  let max = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = 0.2 * d[i] + 0.7 * d[i + 1] + 0.1 * d[i + 2];
    lum[p] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Normalize + threshold (Otsu-ish midpoint with contrast stretch).
  const range = Math.max(1, max - min);
  const threshold = 0.45; // fraction of normalized range; tunable
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const norm = (lum[p] - min) / range;
    // Text (bright) -> black (0); background (dark) -> white (255).
    const val = norm > threshold ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = val;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  if (previewCanvas) {
    previewCanvas.width = w;
    previewCanvas.height = h;
    previewCanvas.getContext('2d').drawImage(canvas, 0, 0);
  }
  return canvas;
}

/**
 * Full pipeline: File -> preprocessed canvas -> OCR text.
 */
export async function recognize(file, { previewCanvas, onProgress } = {}) {
  const bitmap = await loadBitmap(file);
  const canvas = preprocess(bitmap, previewCanvas);
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  return data.text || '';
}
