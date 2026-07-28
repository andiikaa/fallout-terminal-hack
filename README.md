# ROBCO Terminal Hack Solver

[![Deploy PWA to GitHub Pages](https://github.com/andiikaa/fallout-terminal-hack/actions/workflows/deploy.yml/badge.svg)](https://github.com/andiikaa/fallout-terminal-hack/actions/workflows/deploy.yml)

A mobile-first PWA that solves Fallout's terminal hacking minigame — snap a
photo of the terminal, and it reads the candidate words and tells you the
optimal word to guess.

**Live app:** https://andiikaa.github.io/fallout-terminal-hack/

## How it works

1. **Capture** — take a photo (or pick one / type words manually).
2. **OCR** — the image is read by **PaddleOCR (PP-OCRv6)** running fully in the
   browser via [`ppu-paddle-ocr`](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr)
   on **onnxruntime-web** (WebGPU when available, WASM otherwise). PaddleOCR is a
   two-stage detector+recognizer, far more robust on the stylized ROBCO CRT font
   than Tesseract, and it returns a **bounding box** for every text region.
   (Tesseract.js remains as an automatic fallback.)
3. **Reconstruct** — Fallout terminals are memory dumps where words wrap across
   12-char rows in address order, shown in two columns. `reconstructFromRegions`
   rebuilds the true memory order purely from **box geometry** (cluster by x into
   columns, sort by y into rows, concatenate payloads), so wrapped words like
   `TECHN`+`ICAL` = TECHNICAL rejoin — without trusting the (often corrupted)
   `0x` address text.
4. **Solve** — a **minimax** solver picks the guess that minimizes the
   worst-case number of remaining candidates.
5. **Feedback** — after you select a word in-game, tap the **likeness** number
   the terminal shows. The solver narrows the list and recommends the next word
   until the password is found.

## Run it

```bash
pnpm install
pnpm dev         # http://localhost:5173  (open on your phone via the Network URL)
pnpm build       # production build in dist/
pnpm preview     # preview the build
```

To use it on your **iPhone 15**, open the Network URL shown by `pnpm dev`
while the phone is on the same Wi-Fi (camera capture needs HTTPS or localhost;
for full camera on the LAN URL, serve over HTTPS or use a tunnel like
`cloudflared` / `ngrok`). Then "Add to Home Screen" for the PWA experience.

## Files

- `src/solver.js` — likeness, candidate filtering, minimax recommendation, and
  `reconstructFromRegions` (box-geometry layout rebuild).
- `src/paddle-ocr.js` — PaddleOCR (PP-OCRv6) pipeline via `ppu-paddle-ocr/web`.
- `src/ocr.js` — Tesseract.js fallback + canvas preprocessing.
- `src/main.js` — UI wiring, feedback flow.
- `src/style.css` — CRT/ROBCO green-terminal theme.
- `vite.config.js` — sets COOP/COEP for cross-origin isolation (multithreaded WASM).
- `public/` — PWA manifest, icon, service worker.
- `test/` — regression tests (`pnpm test`), incl. a real PaddleOCR sample.

## Privacy & where the models load from

**Everything runs on-device.** Your photo never leaves the browser — all text
detection and recognition happen locally. Two things are downloaded once:

| What | Size | Source | Served from |
| :--- | :--- | :----- | :---------- |
| PP-OCRv6 models (`PP-OCRv6_small_det.ort`, `..._rec.ort`, `ppocrv6_dict.txt`) | a few MB | [`ppu-paddle-ocr-models`](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models) (GitHub) | fetched at runtime |
| ONNX Runtime WASM | ~26 MB (6.4 MB gzip) | bundled at build time | **our own origin** (`dist/assets/`) |

The inference engine (ORT WASM) is served from our own site, not a third-party
CDN. The model files are fetched from GitHub on first use, then the service
worker (`public/sw.js`, which caches same-origin **and** CORS GET responses)
stores them — so **after the first load the app works fully offline.**

## Notes on OCR quality

PaddleOCR handles messy real-world photos (angled, CRT glow) well. Two things
still hurt: physical **occlusion** (e.g. a mesh/net in front of the screen can
hide whole rows) and extreme perspective. For a perfect read, a **native console
screenshot** beats a photo of the TV every time.

Always eyeball the extracted words (shown in an editable box) before analyzing.

## Hosting note (cross-origin isolation)

Multithreaded WASM needs `COOP: same-origin` + `COEP: require-corp` headers.
The dev/preview servers set these (see `vite.config.js`). On a static host that
can't set headers, either rely on WebGPU (no isolation needed) or add
`ppu-paddle-ocr`'s bundled `coi-serviceworker.js`.
