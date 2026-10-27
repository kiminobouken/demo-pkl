const { test, expect } = require("@playwright/test");
const { FRIDAY, accounts, trackErrors, login, loginReady } = require("./helpers");

const budi = { ...accounts.budi, password: accounts.budi.newPassword };
const pdf = Buffer.from("%PDF-1.4\n%laporan uji\n");

test.describe.serial("siswa", () => {
  test("password sementara wajib diganti sebelum aplikasi bisa dipakai", async ({ page }) => {
    const errors = trackErrors(page);
    await login(page, accounts.budi);
    const dialog = page.locator("#password-dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog, "dialog wajib tidak bisa ditutup").toBeVisible();
    expect((await page.request.get("/api/attendance-records")).status(), "API diblokir server").toBe(403);

    await page.fill("#password-new", "budi-password-baru-1");
    await page.fill("#password-confirm", "berbeda-sekali-12");
    await page.click("#password-submit");
    await expect(page.locator("#password-status")).toContainText("tidak sama");
    await page.fill("#password-new", "pendek");
    await page.fill("#password-confirm", "pendek");
    await page.click("#password-submit");
    await expect(page.locator("#password-status")).toContainText("12 karakter");

    await page.fill("#password-new", budi.password);
    await page.fill("#password-confirm", budi.password);
    await page.click("#password-submit");
    await expect(dialog).toBeHidden();
    await expect(page.locator("#student-location-dialog"), "belum punya lokasi PKL").toBeVisible();
    expect(errors).toEqual([]);
  });

  test("siswa memilih lokasi PKL dari daftar dan pilihan tersimpan", async ({ page }) => {
    const errors = trackErrors(page);
    await loginReady(page, budi);
    await expect(page.locator("#student-location-dialog")).toBeVisible();
    await expect(page.locator("#skip-student-location")).toBeVisible();
    const value = await page.locator("#student-location-choice option", { hasText: "PT Sasmita Digital" }).getAttribute("value");
    await page.selectOption("#student-location-choice", value);
    await page.click("#save-student-location");
    await expect(page.locator("#student-location-dialog")).toBeHidden();
    await expect(page.locator("#pkl-company-name")).toHaveText("PT Sasmita Digital");

    await page.reload();
    await expect(page.locator("#pkl-company-name")).toHaveText("PT Sasmita Digital");
    await expect(page.locator("#student-location-dialog")).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("siswa hanya melihat menu dan panel miliknya", async ({ page }) => {
    await loginReady(page, budi);
    await expect(page.locator("#open-qr")).toBeVisible();
    await expect(page.locator(".schedule-panel")).toBeVisible();
    await expect(page.locator("#today-panel")).toBeHidden();
    for (const view of ["notifikasi", "profil-guru", "akun", "kelas", "audit"]) {
      await expect(page.locator(`.nav-item[data-view="${view}"]`), view).toBeHidden();
    }
    await page.click('.nav-item[data-view="siswa"]');
    await expect(page.locator("#location-request-panel")).toBeHidden();
    await expect(page.locator(".student-list-panel")).toBeHidden();
    await expect(page.locator("#edit-student-location")).toBeVisible();
    await expect(page.locator("#teacher-location-panel")).toBeHidden();
    for (const route of ["/api/students", "/api/users", "/api/audit-logs", "/api/notifications"]) {
      expect((await page.request.get(route)).status(), route).toBe(403);
    }
  });

  test("presensi: kamera, ambil ulang, simpan, tampil di rekap, bertahan setelah muat ulang", async ({ page }) => {
    const errors = trackErrors(page);
    await page.addInitScript(() => {
      const originalScale = CanvasRenderingContext2D.prototype.scale;
      CanvasRenderingContext2D.prototype.scale = function (x, y) {
        if (this.canvas.id === "face-capture") window.__attendancePhotoScale = [x, y];
        return originalScale.call(this, x, y);
      };
    });
    await page.clock.setFixedTime(FRIDAY);
    await loginReady(page, budi);
    await page.click("#open-qr");
    await expect(page.locator("#camera-hint")).toContainText("Langkah 1");
    await expect(page.locator("#capture-face")).toBeDisabled();
    await expect(page.locator("#save-attendance")).toBeDisabled();

    await page.click("#enable-camera");
    await expect(page.locator("#enable-camera b")).toHaveText("Kamera aktif");
    await expect(page.locator("#enable-camera")).toBeDisabled();
    await expect(page.locator("#capture-face")).toBeEnabled();
    await page.waitForFunction(() => document.querySelector("#camera-preview").videoWidth > 0);
    await expect(page.locator("#camera-preview")).toHaveCSS("transform", "matrix(-1, 0, 0, 1, 0, 0)");
    await expect(page.locator("#face-capture")).toHaveCSS("transform", "none");
    await page.click("#capture-face");
    await expect(page.locator("#enable-camera b")).toHaveText("Ambil ulang");
    await expect(page.locator("#save-attendance")).toBeEnabled();
    expect(await page.evaluate(() => window.__attendancePhotoScale)).toEqual([-1, 1]);

    await page.click("#enable-camera");
    await expect(page.locator("#save-attendance"), "ambil ulang membatalkan foto lama").toBeDisabled();
    await page.waitForFunction(() => document.querySelector("#camera-preview").videoWidth > 0);
    await page.click("#capture-face");
    await page.click("#save-attendance");
    await expect(page.locator("#toast")).toContainText("Presensi masuk berhasil disimpan");
    await expect(page.locator("#qr-modal")).not.toHaveClass(/open/);

    await page.click('.nav-item[data-view="rekap"]');
    const row = page.locator("#full-table tr").first();
    await expect(row).toContainText("Terlambat");
    const image = row.locator("img.photo-thumb").first();
    await expect(image).toBeVisible();
    const source = await image.getAttribute("src");
    const fetched = await page.request.get(source);
    expect(fetched.status(), `GET ${source}`).toBe(200);
    expect(fetched.headers()["content-type"]).toBe("image/jpeg");
    await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0), { message: "foto termuat di halaman" }).toBe(true);
    await expect(page.locator("#full-table-head")).not.toContainText("SISWA");

    await page.reload();
    await page.click('.nav-item[data-view="rekap"]');
    await expect(page.locator("#full-table tr").first()).toContainText("Terlambat");
    expect(errors).toEqual([]);
  });

  test("rekap: filter periode/status dan unduh CSV dari filter aktif", async ({ page }) => {
    await page.clock.setFixedTime(FRIDAY);
    await loginReady(page, budi);
    await page.click('.nav-item[data-view="rekap"]');
    await page.selectOption("#period-filter", "today");
    await expect(page.locator("#attendance-summary-count")).toHaveText("1 catatan");
    await page.selectOption("#status-filter", "Sakit");
    await expect(page.locator("#attendance-summary-count")).toHaveText("0 catatan");
    await page.click("#download-attendance");
    await expect(page.locator("#download-status")).toContainText("Tidak ada data");

    await page.selectOption("#status-filter", "Semua status");
    await page.selectOption("#period-filter", "quarter");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#download-attendance")]);
    expect(download.suggestedFilename()).toMatch(/^rekap-presensi-\d{4}-\d{2}-\d{2}\.csv$/);
    const content = require("node:fs").readFileSync(await download.path(), "utf8");
    expect(content).toContain("Tanggal,Nama,NISN,Kelas,Jam masuk,Jam pulang,Status");
    expect(content).toContain("Budi Santoso");
    expect(content).not.toContain("Citra");
  });

  test("laporan: validasi format, unggah, status menunggu pemeriksaan", async ({ page }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginReady(page, budi);
    await page.click('.nav-item[data-view="laporan"]');
    await expect(page.locator("#teacher-report-table")).toBeHidden();
    await page.setInputFiles("#report-file", { name: "catatan.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await page.click("#upload-report");
    await expect(page.locator("#upload-error")).toContainText("PDF, DOC, atau DOCX");

    await page.setInputFiles("#report-file", { name: "laporan-budi.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.click("#upload-report");
    await expect(page.locator("#report-empty")).toContainText("laporan-budi.pdf");
    await expect(page.locator("#report-empty")).toContainText("Menunggu pemeriksaan");

    await page.setInputFiles("#report-file", {
      name: "laporan-budi-revisi.docx",
      mimeType: "",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
    });
    await page.click("#upload-report");
    await expect(page.locator(".report-file-list .report-file-row")).toHaveCount(2);
    await expect(page.locator(".report-file-list")).toContainText("laporan-budi-revisi.docx");
    await expect(page.locator(".report-file-list a[download]")).toHaveAttribute("download", "laporan-budi-revisi.docx");
    const reportLayout = await page.locator("#report-empty").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, viewport: window.innerWidth };
    });
    expect(reportLayout.left).toBeGreaterThanOrEqual(0);
    expect(reportLayout.right).toBeLessThanOrEqual(reportLayout.viewport);
    const rowPositions = await page.locator(".report-file-list .report-file-row").evaluateAll((rows) =>
      rows.map((row) => row.getBoundingClientRect().top));
    expect(rowPositions[1]).toBeGreaterThan(rowPositions[0]);

    await page.reload();
    await page.click('.nav-item[data-view="laporan"]');
    await expect(page.locator("#report-empty")).toContainText("laporan-budi.pdf");
    await expect(page.locator("#report-empty")).toContainText("laporan-budi-revisi.docx");

    for (const link of await page.locator("#report-empty a.table-link").all()) {
      const reportHref = await link.getAttribute("href");
      expect((await page.request.get(reportHref)).status(), `file laporan dapat diakses: ${reportHref}`).toBe(200);
    }
    expect(errors).toEqual([]);
  });

  test("siswa mengusulkan tempat PKL baru dan melihat statusnya", async ({ page }) => {
    await loginReady(page, accounts.dewi);
    await expect(page.locator("#student-location-dialog")).toBeVisible();
    await page.selectOption("#student-location-choice", "other");
    await page.fill("#student-other-company", "PT Usulan Baru");
    await page.fill("#student-other-address", "Jalan Braga No. 99, Bandung");
    await page.click("#save-student-location");
    await expect(page.locator("#toast")).toContainText("Usulan lokasi terkirim");
    await expect(page.locator("#student-location-dialog")).toBeHidden();

    await page.click('.nav-item[data-view="siswa"]');
    await page.click("#edit-student-location");
    await expect(page.locator("#student-location-requests")).toContainText("PT Usulan Baru · menunggu persetujuan");
    await expect(page.locator("#skip-student-location"), "mode edit: tombol tutup, bukan lewati").toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.locator("#student-location-dialog")).toBeHidden();
  });
});
