const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

let runtime;
let baseUrl;
let server;

async function getFreePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

test.beforeAll(async () => {
  const project = path.join(__dirname, "..");
  runtime = fs.mkdtempSync(path.join(os.tmpdir(), "presensi-v2-browser-"));
  const dataDirectory = path.join(runtime, "data");
  const reportDirectory = path.join(runtime, "reports");
  fs.mkdirSync(dataDirectory);
  fs.mkdirSync(reportDirectory);
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(project, "legacy", "barcode-version", "server.js")], {
    cwd: project,
    env: {
      ...process.env,
      V2_PORT: String(port),
      V2_DATA_DIRECTORY: dataDirectory,
      V2_REPORT_DIRECTORY: reportDirectory,
      V2_ADMIN_ID: "admin.v2.browser",
      V2_GURU_ID: "guru.v2.browser",
      V2_SISWA_ID: "202312047",
      ADMIN_PASSWORD: "admin-v2-browser-temporary-123",
      GURU_PASSWORD: "guru-v2-browser-temporary-123",
      SISWA_PASSWORD: "student-v2-browser-temporary-123",
    },
    stdio: "ignore",
  });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`V2 server exited with code ${server.exitCode}`);
    try {
      if ((await fetch(baseUrl)).status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("V2 browser test server startup timeout");
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  if (runtime) fs.rmSync(runtime, { recursive: true, force: true });
});

test("V2 forces password change, supports admin reset, and revokes logout sessions", async ({ page }) => {
  await page.goto(`${baseUrl}/login.html`);
  await page.locator('#roleSwitch [data-role="admin"]').click();
  await page.locator("#idInput").fill("admin.v2.browser");
  await page.locator("#pwInput").fill("admin-v2-browser-temporary-123");
  await page.locator("#loginBtn").click();
  await expect(page).toHaveURL(/account\.html\?required=1$/);
  await expect(page.locator("#account-title")).toHaveText("Ganti kata sandi sementara");
  await page.locator("#new-password").fill("Admin-V2-Browser-Changed-2026!");
  await page.locator("#confirm-password").fill("Admin-V2-Browser-Changed-2026!");
  await page.getByRole("button", { name: "Simpan kata sandi" }).click();
  await expect(page).toHaveURL(/admin\.html$/);

  await page.locator("#reset-user-id").fill("202312047");
  await page.locator("#reset-user-password").fill("Student-V2-Reset-Temporary-123");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.locator("#admin-password-reset-status")).toContainText("wajib mengganti");
  await page.setViewportSize({ width: 390, height: 844 });
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBe(false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator(".logout-button").click();
  await expect(page).toHaveURL(/login\.html$/);

  await page.locator('#roleSwitch [data-role="siswa"]').click();
  await page.locator("#idInput").fill("202312047");
  await page.locator("#pwInput").fill("Student-V2-Reset-Temporary-123");
  await page.locator("#loginBtn").click();
  await expect(page).toHaveURL(/account\.html\?required=1$/);
  await page.locator("#new-password").fill("Student-V2-Browser-Recovered-2026!");
  await page.locator("#confirm-password").fill("Student-V2-Browser-Recovered-2026!");
  await page.getByRole("button", { name: "Simpan kata sandi" }).click();
  await expect(page).toHaveURL(/index\.html$/);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator(".logout-button").click();
  await expect(page).toHaveURL(/login\.html$/);
  const sessionStatus = await page.evaluate(async () => (await fetch("/api/session")).status);
  expect(sessionStatus).toBe(401);
});
