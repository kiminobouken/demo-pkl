const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { defineConfig } = require("@playwright/test");

// One throw-away runtime folder per run, shared with the worker processes through the environment.
const runtime = process.env.E2E_RUNTIME || fs.mkdtempSync(path.join(os.tmpdir(), "presensi-e2e-"));
process.env.E2E_RUNTIME = runtime;
const port = Number(process.env.E2E_PORT) || 4789;
process.env.E2E_BASE_URL = `http://localhost:${port}`;

module.exports = defineConfig({
  // Dua project: e2e aplikasi utama (V1) dan tes browser server V2/barcode (legacy/barcode-version).
  // tests/browser.spec.js (dari versi A) menarget tampilan lama dan tidak dijalankan; skenarionya ada di tests/e2e.
  projects: [
    { name: "e2e", testDir: "tests/e2e", testMatch: "**/*.spec.js" },
    { name: "v2-barcode", testDir: "tests", testMatch: "v2-browser.spec.js" },
  ],
  globalSetup: require.resolve("./tests/e2e/global-setup.js"),
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    permissions: ["camera", "geolocation"],
    geolocation: { latitude: -6.2, longitude: 106.8 },
    launchOptions: {
      // Set CHROMIUM_PATH to use a Chromium you already have instead of `npx playwright install chromium`.
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
  webServer: {
    command: "node server.js",
    url: `${process.env.E2E_BASE_URL}/healthz`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      PORT: String(port),
      DATABASE_PATH: path.join(runtime, "presensi.sqlite"),
      IMAGE_DIRECTORY: path.join(runtime, "images"),
      REPORT_DIRECTORY: path.join(runtime, "reports"),
      DATA_DIRECTORY: runtime,
      ADMIN_ID: "admin.sekolah",
      ADMIN_PASSWORD: "admin-password-123",
      GURU_ID: "guru.a",
      GURU_PASSWORD: "guru-a-password-123",
      HELP_CONTACT_NAME: "Admin Sekolah",
      HELP_CONTACT_EMAIL: "admin@example.sch.id",
    },
  },
});
