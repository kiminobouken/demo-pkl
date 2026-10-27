const { test, expect, request } = require("@playwright/test");
const { FRIDAY, accounts, trackErrors, loginReady } = require("./helpers");

test.describe.serial("guru", () => {
  test("guru hanya melihat UI dan data guru: tanpa presensi, dengan foto presensi hari ini", async ({ page }) => {
    const errors = trackErrors(page);
    await page.clock.setFixedTime(FRIDAY);
    await loginReady(page, accounts.guruA);

    await expect(page.locator("#open-qr"), "guru tidak punya opsi presensi").toBeHidden();
    await expect(page.locator(".schedule-panel")).toBeHidden();
    await expect(page.locator(".company-panel").first()).toBeHidden();
    await expect(page.locator("#today-panel")).toBeVisible();
    for (const view of ["akun", "kelas", "audit"]) {
      await expect(page.locator(`.nav-item[data-view="${view}"]`), view).toBeHidden();
    }
    await expect(page.locator('.nav-item[data-view="notifikasi"]')).toBeVisible();
    await expect(page.locator("#profile-nav-label")).toHaveText("Profil guru");

    const photos = page.locator("#today-photo-grid img.photo-thumb");
    await expect(photos).toHaveCount(1);
    await expect(photos.first()).toHaveAttribute("alt", /Budi Santoso/);
    await expect.poll(() => photos.first().evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("server menolak aksi di luar peran dan di luar kelas guru", async ({ page }) => {
    await loginReady(page, accounts.guruA);
    const photoBody = { photo: "data:image/jpeg;base64,/9j/", image: { width: 640, height: 480 } };
    expect((await page.request.post("/api/attendance-photo", { data: photoBody })).status()).toBe(403);
    expect((await page.request.post("/api/report-upload", { data: { filename: "x.pdf", data: "data:application/pdf;base64,AAAA" } })).status()).toBe(403);
    for (const route of ["/api/users", "/api/audit-logs"]) {
      expect((await page.request.get(route)).status(), route).toBe(403);
    }
    expect((await page.request.post("/api/users", { data: { id: "guru.x", role: "guru", password: "password-guru-x-1" } })).status()).toBe(403);
    const students = await (await page.request.get("/api/students")).json();
    expect(students.map((student) => student.nisn).sort()).toEqual(["1111111111", "3333333333"]);
    expect((await page.request.get("/api/students/2222222222")).status(), "siswa kelas lain").toBe(403);
  });

  test("guru kelas lain tidak melihat data kelas ini", async () => {
    const context = await request.newContext({ baseURL: process.env.E2E_BASE_URL });
    const login = await context.post("/api/login", { data: { id: "guru.b", password: "guru-b-password-123" } });
    expect(login.ok()).toBe(true);
    expect((await context.post("/api/password", { data: { password: accounts.guruB.newPassword } })).ok()).toBe(true);
    expect((await (await context.get("/api/students")).json()).map((student) => student.nisn)).toEqual(["2222222222"]);
    expect(await (await context.get("/api/attendance-records")).json()).toEqual([]);
    expect(await (await context.get("/api/reports")).json()).toEqual([]);
    const budiPhoto = (await (await (await request.newContext({ baseURL: process.env.E2E_BASE_URL })).post("/api/login", { data: { id: "guru.a", password: accounts.guruA.password } })).json()).user.id;
    expect(budiPhoto).toBe("guru.a");
    await context.dispose();
  });

  test("rekap guru: nama siswa, foto, filter hari ini, unduh CSV", async ({ page }) => {
    await page.clock.setFixedTime(FRIDAY);
    await loginReady(page, accounts.guruA);
    await page.click('.nav-item[data-view="rekap"]');
    await expect(page.locator("#full-table-head")).toContainText("SISWA");
    await page.selectOption("#period-filter", "today");
    const row = page.locator("#full-table tr").first();
    await expect(row).toContainText("Budi Santoso");
    await expect(row).toContainText("XII-A");
    await expect(row.locator("img.photo-thumb").first()).toBeVisible();
    await expect(page.locator("#full-table")).not.toContainText("Citra");

    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#download-attendance")]);
    const content = require("node:fs").readFileSync(await download.path(), "utf8");
    expect(content).toContain("Budi Santoso");
    expect(content).toContain("XII-A");
  });

  test("guru menyetujui usulan lokasi dan siswa dapat memilihnya", async ({ page, browser }) => {
    await loginReady(page, accounts.guruA);
    await page.click('.nav-item[data-view="siswa"]');
    await expect(page.locator("#students-table-body tr")).toHaveCount(2);
    await expect(page.locator("#students-table-body")).not.toContainText("Citra");
    await expect(page.locator("#students-table-body")).toContainText("0812*****890");
    await expect(page.locator("#students-table-body")).not.toContainText("081234567890");
    await expect(page.locator(".profile-grid")).toBeHidden();

    await expect(page.locator("#location-request-count")).toHaveText("1 menunggu");
    await expect(page.locator("#location-request-body")).toContainText("PT Usulan Baru");
    await page.click('[data-request-action="approve"]');
    await expect(page.locator("#location-request-status")).toContainText("disetujui");
    await expect(page.locator("#location-request-count")).toHaveText("0 menunggu");
    await expect(page.locator('select[data-student-location="3333333333"]')).toContainText("PT Usulan Baru");

    const student = await browser.newPage();
    await loginReady(student, accounts.dewi);
    await expect(student.locator("#student-location-dialog")).toBeVisible();
    const value = await student.locator("#student-location-choice option", { hasText: "PT Usulan Baru" }).getAttribute("value");
    await student.selectOption("#student-location-choice", value);
    await student.click("#save-student-location");
    await expect(student.locator("#pkl-company-name")).toHaveText("PT Usulan Baru");
    await student.close();
  });

  test("guru memvalidasi laporan dan siswa melihat statusnya", async ({ page, browser }) => {
    const errors = trackErrors(page);
    await loginReady(page, accounts.guruA);
    await page.click('.nav-item[data-view="laporan"]');
    await expect(page.locator("#report-form")).toBeHidden();
    const row = page.locator("#teacher-report-table tr").first();
    await expect(row).toContainText("Budi Santoso");
    await expect(row).toContainText("Menunggu pemeriksaan");
    await row.getByRole("button", { name: "Periksa" }).click();
    await page.selectOption("#review-status", "perlu_revisi");
    await page.fill("#review-note", "Lengkapi dokumentasi kegiatan.");
    await page.click("#review-submit");
    await expect(page.locator("#toast")).toContainText("Hasil pemeriksaan tersimpan");
    await expect(row).toContainText("Perlu revisi");
    await expect(row).toContainText("Lengkapi dokumentasi kegiatan.");

    const student = await browser.newPage();
    await loginReady(student, { ...accounts.budi, password: accounts.budi.newPassword });
    await student.click('.nav-item[data-view="laporan"]');
    await expect(student.locator("#report-empty")).toContainText("Perlu revisi");
    await expect(student.locator("#report-empty")).toContainText("Lengkapi dokumentasi kegiatan.");
    await expect(student.locator("#report-status")).toHaveText("Perlu revisi");
    await student.close();
    expect(errors).toEqual([]);
  });

  test("notifikasi dibaca dan profil guru tersimpan di server setelah refresh", async ({ page }) => {
    await loginReady(page, accounts.guruA);
    await expect(page.locator("#notification-nav-count")).toBeVisible();
    await page.click('.nav-item[data-view="notifikasi"]');
    await page.click("#mark-notifications-read");
    await expect(page.locator("#notification-nav-count")).toBeHidden();
    await expect(page.locator("#notification-indicator")).toBeHidden();

    await page.click('.nav-item[data-view="profil-guru"]');
    await page.fill("#teacher-profile-name-input", "Bu Guru Pembimbing A");
    await page.fill("#teacher-profile-contact", "guru.a@example.sch.id");
    await page.click('#teacher-profile-form button[type="submit"]');
    await expect(page.locator("#teacher-profile-status")).toContainText("berhasil disimpan");
    await expect(page.locator("#current-user-name")).toHaveText("Bu Guru Pembimbing A");

    const profile = await (await page.request.get("/api/profile")).json();
    expect(profile.displayName).toBe("Bu Guru Pembimbing A");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("#notification-nav-count"), "status baca berasal dari server").toBeHidden();
    await expect(page.locator("#current-user-name")).toHaveText("Bu Guru Pembimbing A");
    await page.click('.nav-item[data-view="profil-guru"]');
    await expect(page.locator("#teacher-profile-contact")).toHaveValue("guru.a@example.sch.id");
  });

  test("pengaturan notifikasi: tombol sinkron dengan preferensi dan menyaring daftar", async ({ page }) => {
    await loginReady(page, accounts.guruA);
    await page.click('.nav-item[data-view="notifikasi"]');
    await expect(page.locator("#notification-list")).toContainText("Presensi");
    await page.click('.nav-item[data-view="pengaturan"]');
    const toggle = page.locator('[data-notification-setting="attendance"]');
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(toggle).toHaveClass(/on/);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle, "tampilan harus sama dengan state").not.toHaveClass(/\bon\b/);
    await page.click('.nav-item[data-view="notifikasi"]');
    await expect(page.locator("#notification-list")).not.toContainText("Presensi masuk tercatat");
    await expect(page.locator("#notification-list")).toContainText("Laporan PKL baru diunggah");
    await page.click('.nav-item[data-view="pengaturan"]');
    await toggle.click();
    await expect(toggle).toHaveClass(/on/);
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
