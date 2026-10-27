const { expect } = require("@playwright/test");

// A Friday, 10:00 WIB: attendance is only accepted on weekdays, so the browser clock is pinned here.
const FRIDAY = new Date("2026-10-23T03:00:00.000Z");

const accounts = {
  admin: { role: "admin", id: "admin.sekolah", password: "admin-password-new-1" },
  guruA: { role: "guru", id: "guru.a", password: "guru-a-password-new-1" },
  guruB: { role: "guru", id: "guru.b", password: "guru-b-password-123", temporary: true, newPassword: "guru-b-password-new-1" },
  budi: { role: "Siswa/Siswi", id: "1111111111", password: "1111111111-temp-pass", temporary: true, newPassword: "budi-password-baru-1" },
  dewi: { role: "Siswa/Siswi", id: "3333333333", password: "dewi-password-baru-1" },
  citra: { role: "Siswa/Siswi", id: "2222222222", password: "citra-password-baru-1" },
};

function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function login(page, account, password = account.password) {
  await page.goto("/");
  await page.selectOption("#login-role", account.role);
  await page.fill("#login-id", account.id);
  await page.fill("#login-password", password);
  await page.click("#login-submit");
}

async function loginReady(page, account) {
  await login(page, account);
  await expect(page.locator("#app-shell")).toHaveClass(/authenticated/);
}

module.exports = { FRIDAY, accounts, trackErrors, login, loginReady };
