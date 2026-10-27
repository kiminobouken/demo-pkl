const { test, expect } = require("@playwright/test");
const { accounts, trackErrors, login, loginReady } = require("./helpers");

test.describe.serial("menu akun, bantuan, tutorial, password", () => {
  test("menu akun dapat dipakai dengan keyboard dan mouse", async ({ page }) => {
    const errors = trackErrors(page);
    await loginReady(page, accounts.dewi);
    const trigger = page.locator("#account-menu-button");
    await trigger.click();
    const menu = page.locator("#account-menu");
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await page.locator("#current-user-mini-avatar").click();
    await menu.getByRole("menuitem", { name: "Pengaturan" }).click();
    await expect(page.locator("#pengaturan-view")).toHaveClass(/active/);
    await page.locator("#current-user-mini-avatar").click();
    await page.mouse.click(5, 400);
    await expect(menu).toBeHidden();
    await page.locator("#current-user-mini-avatar").click();
    await menu.getByRole("menuitem", { name: "Profil" }).click();
    await expect(page.locator("#siswa-view")).toHaveClass(/active/);
    expect(errors).toEqual([]);
  });

  test("tutorial per peran dan bantuan memakai kontak dari server", async ({ page }) => {
    await loginReady(page, accounts.dewi);
    await page.click("#open-help");
    const help = page.locator("#help-dialog");
    await expect(help).toBeVisible();
    await expect(help).toContainText("Admin Sekolah");
    await expect(help.locator('a[href="mailto:admin@example.sch.id"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();

    await page.click('.nav-item[data-view="pengaturan"]');
    await page.click("#open-tutorial");
    const tutorial = page.locator("#tutorial-dialog");
    await expect(tutorial.getByRole("tab", { name: "Siswa" })).toHaveAttribute("aria-selected", "true");
    await expect(tutorial).toContainText("Presensi sekarang");
    await tutorial.getByRole("tab", { name: "Guru" }).click();
    await expect(tutorial).toContainText("Periksa");
    await tutorial.getByRole("tab", { name: "Admin" }).click();
    await expect(tutorial).toContainText("Log audit");
    await tutorial.getByRole("button", { name: "Tutup" }).click();
    await expect(tutorial).toBeHidden();
  });

  test("detail lokasi: terisi dan kosong", async ({ page }) => {
    await loginReady(page, accounts.dewi);
    await page.click("#show-location");
    await expect(page.locator("#location-detail-dialog")).toContainText("PT Usulan Baru");
    await expect(page.locator("#location-detail-dialog")).toContainText("Jalan Braga No. 99");
    await page.keyboard.press("Escape");

    await page.click("#logout-button");
    await expect(page.locator("#app-shell")).not.toHaveClass(/authenticated/);
    await loginReady(page, accounts.citra);
    await expect(page.locator("#student-location-dialog")).toBeVisible();
    await page.click("#skip-student-location");
    await page.click("#show-location");
    await expect(page.locator("#location-detail-dialog")).toContainText("belum dimasukkan");
    await page.click("#location-detail-edit");
    await expect(page.locator("#student-location-dialog")).toBeVisible();
  });

  test("ubah password dari pengaturan, lalu login dengan password baru", async ({ page }) => {
    await loginReady(page, accounts.dewi);
    await page.click('.nav-item[data-view="pengaturan"]');
    await page.click("#open-change-password");
    const dialog = page.locator("#password-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#password-cancel")).toBeVisible();
    await page.click("#password-cancel");
    await expect(dialog).toBeHidden();

    await page.click("#open-change-password");
    await page.fill("#password-new", "dewi-password-ganti-2");
    await page.fill("#password-confirm", "dewi-password-ganti-2");
    await page.click("#password-submit");
    await expect(dialog).toBeHidden();
    await expect(page.locator("#toast")).toContainText("Password berhasil diubah");

    await page.click("#logout-button");
    await expect(page.locator("#app-shell")).not.toHaveClass(/authenticated/);
    await login(page, accounts.dewi);
    await expect(page.locator("#login-error")).not.toHaveText("");
    await login(page, accounts.dewi, "dewi-password-ganti-2");
    await expect(page.locator("#app-shell")).toHaveClass(/authenticated/);
  });

  test("tema warna tersimpan setelah refresh", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".brand-mark")).toHaveCount(2);
    await expect.poll(() => page.locator(".brand-mark").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "garden");
    await page.evaluate(() => document.querySelector('.theme-option[data-theme="ocean"]').click());
    await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
    await page.evaluate(() => document.querySelector('.theme-option[data-theme="dark"]').click());
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator('.theme-option[data-theme="dark"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#111923");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.evaluate(() => document.querySelector('.theme-option[data-theme="garden"]').click());
  });

  test("tampilan ponsel: menu avatar memberi akses bantuan dan keluar", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 700 }, permissions: ["camera", "geolocation"] });
    const page = await context.newPage();
    await login(page, { ...accounts.dewi, password: "dewi-password-ganti-2" });
    await expect(page.locator("#app-shell")).toHaveClass(/authenticated/);
    await expect(page.locator(".profile-card")).toBeHidden();
    await expect(page.locator("#logout-button")).toBeHidden();
    for (const view of ["dashboard", "rekap", "siswa", "laporan", "pengaturan"]) {
      await page.click(`.nav-item[data-view="${view}"]`);
      console.log(view, await page.evaluate(() => Object.fromEntries(
        ["#app-shell", ".main-content", ".topbar", ".content-wrap", ".view.active", "#report-empty"].map((selector) => {
          const element = document.querySelector(selector);
          if (!element) return [selector, null];
          const bounds = element.getBoundingClientRect();
          return [selector, { left: bounds.left, width: bounds.width, right: bounds.right, cssWidth: getComputedStyle(element).width }];
        }).concat([["viewport", { innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }]]),
      )));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `halaman ${view} tidak meluber ke samping`).toBeLessThanOrEqual(0);
    }
    await page.locator("#current-user-mini-avatar").click();
    const menu = page.locator("#account-menu");
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    await menu.getByRole("menuitem", { name: "Bantuan" }).click();
    await expect(page.locator("#help-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator("#current-user-mini-avatar").click();
    await menu.getByRole("menuitem", { name: "Keluar" }).click();
    await expect(page.locator("#app-shell")).not.toHaveClass(/authenticated/);
    await context.close();
  });
});
