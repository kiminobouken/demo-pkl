const { test, expect } = require("@playwright/test");
const { accounts, trackErrors, login, loginReady } = require("./helpers");

test.describe.serial("admin", () => {
  test("admin melihat halaman administrasi tetapi tidak punya presensi/validasi", async ({ page }) => {
    const errors = trackErrors(page);
    await loginReady(page, accounts.admin);
    for (const view of ["akun", "kelas", "audit", "notifikasi", "profil-guru"]) {
      await expect(page.locator(`.nav-item[data-view="${view}"]`), view).toBeVisible();
    }
    await expect(page.locator("#profile-nav-label")).toHaveText("Profil admin");
    await expect(page.locator("#open-qr")).toBeHidden();
    await expect(page.locator(".schedule-panel")).toBeHidden();
    await expect(page.locator("#today-panel")).toBeVisible();
    expect((await page.request.post("/api/attendance-photo", { data: { photo: "x" } })).status()).toBe(403);
    expect((await page.request.post("/api/report-upload", { data: { filename: "x.pdf", data: "x" } })).status()).toBe(403);
    const reports = await (await page.request.get("/api/reports")).json();
    expect(reports.length).toBe(1);
    expect((await page.request.post(`/api/reports/${reports[0].filename}/review`, { data: { status: "valid" } })).status(), "validasi hanya guru").toBe(403);

    await page.click('.nav-item[data-view="laporan"]');
    await expect(page.locator("#teacher-report-table").getByRole("button", { name: "Periksa" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("kelola akun: buat, reset password, nonaktifkan, dan akun nonaktif tidak bisa login", async ({ page, browser }) => {
    const errors = trackErrors(page);
    await loginReady(page, accounts.admin);
    await page.click('.nav-item[data-view="pengaturan"]');
    await page.locator('.theme-option[data-theme="dark"]').click();
    await page.click('.nav-item[data-view="akun"]');
    for (const selector of [
      '#admin-user-form button[type="submit"]',
      '#teacher-assignment-form button[type="submit"]',
    ]) {
      await expect(page.locator(selector)).toHaveCSS("background-color", "rgb(53, 107, 82)");
      await expect(page.locator(selector)).toHaveCSS("color", "rgb(247, 255, 249)");
    }
    await expect(page.locator("#admin-user-table tr")).toHaveCount(6);

    await page.fill("#admin-user-id", "9999999999");
    await page.selectOption("#admin-user-role", "siswa");
    await page.click("#admin-generate-password");
    await page.click('#admin-user-form button[type="submit"]');
    await expect(page.locator("#admin-user-status")).toContainText("belum terdaftar");

    await page.fill("#admin-user-id", "guru.c");
    await page.selectOption("#admin-user-role", "guru");
    await page.click("#admin-generate-password");
    const password = await page.inputValue("#admin-user-password");
    expect(password).toHaveLength(16);
    await page.click('#admin-user-form button[type="submit"]');
    await expect(page.locator("#admin-user-status")).toContainText("Akun guru.c dibuat");
    const row = page.locator("#admin-user-table tr", { hasText: "guru.c" });
    await expect(row).toContainText("Password sementara");

    await row.getByRole("button", { name: "Atur ulang password" }).click();
    await page.click("#temp-password-generate");
    const reset = await page.inputValue("#temp-password-input");
    await page.click("#temp-password-submit");
    await expect(page.locator("#temp-password-dialog")).toBeHidden();
    await expect(page.locator("#admin-user-status")).toContainText("Password sementara untuk guru.c disimpan");

    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Nonaktifkan" }).click();
    await expect(row).toContainText("Nonaktif");
    await expect(page.locator("#admin-user-table tr", { hasText: "admin.sekolah" }).getByRole("button", { name: "Nonaktifkan" })).toHaveCount(0);

    const other = await browser.newPage();
    await login(other, { role: "guru", id: "guru.c", password: reset });
    await expect(other.locator("#login-error")).not.toHaveText("");
    await expect(other.locator("#app-shell")).not.toHaveClass(/authenticated/);
    await other.close();
    expect(errors).toEqual([]);
  });

  test("kelas & guru: tambah kelas, tugaskan, cabut; atur kelas siswa", async ({ page }) => {
    await loginReady(page, accounts.admin);
    await page.click('.nav-item[data-view="kelas"]');
    await page.fill("#admin-class-name", "XII-C");
    await page.click('#admin-class-form button[type="submit"]');
    await expect(page.locator("#admin-class-status")).toContainText("XII-C ditambahkan");
    const row = page.locator("#admin-class-table tr", { hasText: "XII-C" });
    await expect(row).toContainText("Belum ada guru");
    await row.locator("select").selectOption("guru.b");
    await row.getByRole("button", { name: "Tambah" }).click();
    await expect(row.locator(".chip")).toContainText("guru.b");
    page.once("dialog", (dialog) => dialog.accept());
    await row.locator(".chip button").click();
    await expect(row).toContainText("Belum ada guru");

    await page.click('.nav-item[data-view="siswa"]');
    const select = page.locator('select[data-student-class="2222222222"]');
    await expect(select).toBeVisible();
    await select.selectOption({ label: "XII-C" });
    await expect(page.locator("#student-import-status")).toContainText("Kelas siswa berhasil disimpan");
    await select.selectOption({ label: "XII-B" });
    await expect(page.locator("#student-import-status")).toContainText("Kelas siswa berhasil disimpan");
  });

  test("log audit memuat tindakan penting tanpa password dan bisa difilter", async ({ page }) => {
    await loginReady(page, accounts.admin);
    await page.click('.nav-item[data-view="audit"]');
    await expect(page.locator("#audit-table")).toContainText("user_created");
    await expect(page.locator("#audit-table")).toContainText("report_reviewed");
    await expect(page.locator("#audit-table")).not.toContainText("password-baru");
    await page.selectOption("#audit-action-filter", "user_deactivated");
    await expect(page.locator("#audit-table tr")).toHaveCount(1);
    await expect(page.locator("#audit-table")).toContainText("guru.c");
  });
});
