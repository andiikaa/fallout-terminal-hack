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

/**
 * Recognize a Fallout terminal image with PaddleOCR.
 * Returns an array of regions: { text, box: { x, y, width, height } }.
 */
export async function recognizeRegions(file, { previewCanvas, onProgress } = {}) {
  const canvas = await fileToCanvas(file);
  if (previewCanvas) {
    previewCanvas.width = canvas.width;
    previewCanvas.height = canvas.height;
    previewCanvas.getContext('2d').drawImage(canvas, 0, 0);
  }
  onProgress?.('recognizing', 0.5);
  const service = await getService(onProgress);
  const result = await service.recognize(canvas, { flatten: true });
  onProgress?.('done', 1);
  return result.results || [];
}
