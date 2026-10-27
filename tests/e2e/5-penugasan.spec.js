const { test, expect } = require("@playwright/test");
const { accounts, trackErrors, loginReady } = require("./helpers");

// Fitur gabungan dari versi A: penugasan pembimbing per siswa, data guru, dan sesi aktif (halaman admin).
test.describe.serial("admin: penugasan pembimbing, data guru, sesi aktif", () => {
  const guru = { id: "guru.d", password: "guru-d-password-123", newPassword: "guru-d-password-new-1" };

  test("admin menugaskan siswa ke guru; guru itu melihat siswa tersebut", async ({ page, request }) => {
    const errors = trackErrors(page);
    await loginReady(page, accounts.admin);
    const created = await page.request.post("/api/users", { data: { id: guru.id, role: "guru", password: guru.password } });
    expect(created.status()).toBe(201);

    await page.reload();
    await expect(page.locator("#app-shell")).toHaveClass(/authenticated/);
    await page.click('.nav-item[data-view="akun"]');
    await expect(page.locator("#teacher-assignment-form")).toBeVisible();
    await expect(page.locator("#assignment-teacher option", { hasText: guru.id })).toHaveCount(1);

    await page.selectOption("#assignment-student", "2222222222");
    await page.selectOption("#assignment-teacher", guru.id);
    await page.click('#teacher-assignment-form button[type="submit"]');
    await expect(page.locator("#assignment-status")).toContainText("disimpan");

    const assignments = await (await page.request.get("/api/teacher-assignments")).json();
    expect(assignments).toEqual([expect.objectContaining({ studentNisn: "2222222222", teacherId: guru.id })]);

    // Pilih siswa lain lalu kembali: guru pembimbing yang tersimpan tampil lagi di dropdown.
    await page.selectOption("#assignment-student", "1111111111");
    await expect(page.locator("#assignment-teacher")).toHaveValue("");
    await page.selectOption("#assignment-student", "2222222222");
    await expect(page.locator("#assignment-teacher")).toHaveValue(guru.id);

    // Dari sisi guru: ganti password sementara, lalu hanya siswa yang ditugaskan yang terlihat.
    const loggedIn = await request.post("/api/login", { data: { id: guru.id, password: guru.password } });
    expect(loggedIn.status()).toBe(200);
    expect((await request.post("/api/password", { data: { password: guru.newPassword } })).status()).toBe(200);
    const students = await (await request.get("/api/students")).json();
    expect(students.map((student) => student.nisn)).toEqual(["2222222222"]);
    expect(errors).toEqual([]);
  });

  test("sesi aktif dan data guru tampil untuk admin", async ({ page }) => {
    const errors = trackErrors(page);
    await loginReady(page, accounts.admin);
    await page.click('.nav-item[data-view="audit"]');
    const sessions = page.locator("#active-session-table");
    await expect(sessions).toContainText("admin.sekolah");
    await expect(sessions).toContainText(guru.id);
    await expect(page.locator("#active-session-count")).toContainText("sesi");

    await page.click('.nav-item[data-view="akun"]');
    await expect(page.locator("#teacher-directory-table")).toContainText("Master guru belum diimpor");
    expect(errors).toEqual([]);
  });

  test("penugasan dapat dicabut", async ({ page }) => {
    await loginReady(page, accounts.admin);
    await page.click('.nav-item[data-view="akun"]');
    await page.selectOption("#assignment-student", "2222222222");
    await page.selectOption("#assignment-teacher", "");
    await page.click('#teacher-assignment-form button[type="submit"]');
    await expect(page.locator("#assignment-status")).toContainText("disimpan");
    expect(await (await page.request.get("/api/teacher-assignments")).json()).toEqual([]);
  });
});
