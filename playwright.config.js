import { defineConfig, devices } from '@playwright/test';

// End-to-end OCR test. Boots the real Vite dev server (which sets the COOP/COEP
// headers PaddleOCR's threaded WASM wants) and drives the actual upload flow.
// OCR + first-run model download is slow, so timeouts are generous.
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 150_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
