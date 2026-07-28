import { defineConfig } from 'vite';

// COOP/COEP headers enable cross-origin isolation so Tesseract.js can use
// multithreaded WASM (SharedArrayBuffer). Falls back to single-thread if absent.
const crossOriginIsolation = {
  name: 'cross-origin-isolation',
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
};

export default defineConfig({
  base: './',
  plugins: [crossOriginIsolation],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
