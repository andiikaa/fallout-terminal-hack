import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(
  new URL('../test/fixtures/img7886-warriors.jpeg', import.meta.url)
);

// Full pipeline in a real browser: upload a photo -> PaddleOCR (WASM) ->
// orientation correction + glare pass -> reconstruction -> candidate words.
// The fixture is a genuine glary, curved-CRT photo stored SIDEWAYS (EXIF
// stripped), so this exercises the orientation auto-detection too.
test('extracts candidate words from a real terminal photo', async ({ page }) => {
  await page.goto('/');

  await page.setInputFiles('#file-input', FIXTURE);

  // Wait for OCR to populate the words box (model download + a few passes).
  const wordsBox = page.locator('#words-input');
  await expect
    .poll(async () => (await wordsBox.inputValue()).trim().length, {
      timeout: 150_000,
      message: 'OCR never populated the words box',
    })
    .toBeGreaterThan(0);

  const words = (await wordsBox.inputValue())
    .split(/\s+/)
    .map((w) => w.trim().toUpperCase())
    .filter(Boolean);

  console.log('OCR words:', words.join(' '));

  // All candidates share a length (Fallout passwords), and the board is 8-char.
  expect(words.length).toBeGreaterThanOrEqual(6);
  expect(words.every((w) => w.length === 8)).toBe(true);

  // Words reliably recovered from this photo across the raw + glare passes.
  for (const w of ['PASSKEYS', 'TOMATOES', 'PRODUCED', 'STRAIGHT', 'SHUTTING']) {
    expect(words).toContain(w);
  }
});
