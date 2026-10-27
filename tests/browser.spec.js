const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const adminId = "admin.browser.test";
const adminPassword = "admin-browser-temporary-123";
const teacherId = "guru.browser.test";
const teacherPassword = "guru-browser-temporary-123";
const studentId = "0202312047";
const studentPassword = "student-browser-temporary-123";
const updatedPassword = "Browser-Updated-Password-2026!";

let runtime;
let databasePath;
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

async function waitForServer(child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}`);
    try {
      if ((await fetch(baseUrl)).status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Server startup timeout");
}

async function apiLogin(id, password) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, password }),
  });
  const result = await response.json();
  expect(response.status, result.message).toBe(200);
  return response.headers.get("set-cookie").split(";")[0];
}

async function apiRequest(cookie, endpoint, options = {}) {
  return fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      Cookie: cookie,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

async function createStudentAccount() {
  const teacherCookie = await apiLogin(teacherId, teacherPassword);
  const teacherPasswordChange = await apiRequest(teacherCookie, "/api/password", {
    method: "POST",
    body: JSON.stringify({ password: teacherPassword }),
  });
  expect(teacherPasswordChange.status).toBe(200);
  const studentImport = await apiRequest(teacherCookie, "/api/students/import", {
    method: "POST",
    headers: { "Content-Type": "text/csv" },
    body: `Nama Siswa,NISN\nSiswa Browser,${studentId}`,
  });
  const result = await studentImport.json();
  expect(studentImport.status, result.message).toBe(200);
}

async function uploadStudentReport() {
  const cookie = await apiLogin(studentId, studentId);
  const passwordChange = await apiRequest(cookie, "/api/password", {
    method: "POST",
    body: JSON.stringify({ password: studentPassword }),
  });
  expect(passwordChange.status).toBe(200);
  const report = Buffer.from("%PDF-1.4\nBrowser report test\n");
  const upload = await apiRequest(cookie, "/api/report-upload", {
    method: "POST",
    body: JSON.stringify({
      filename: "Teacher review test.pdf",
      type: "application/pdf",
      data: `data:application/pdf;base64,${report.toString("base64")}`,
    }),
  });
  expect(upload.status).toBe(201);
}

async function loginInBrowser(page, role, id, password) {
  await page.goto(baseUrl);
  await page.locator("#login-role").selectOption(role);
  await page.locator("#login-id").fill(id);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: /Masuk ke dashboard/ }).click();
  await expect(page.locator("#app-shell")).toHaveClass(/authenticated/);
}

async function changeRequiredPassword(page) {
  await expect(page.locator("#password-change-dialog")).toBeVisible();
  await page.locator("#new-password").fill(updatedPassword);
  await page.locator("#confirm-password").fill(updatedPassword);
  await page.getByRole("button", { name: "Simpan password" }).click();
  await expect(page.locator("#password-change-dialog")).not.toBeVisible();
}

async function addAttendanceRecord() {
  const filename = "presensi-browser-test.jpg";
  fs.writeFileSync(path.join(runtime, "images", filename), Buffer.from("browser-test-image"));
  const database = new DatabaseSync(databasePath);
  const timestamp = new Date().toISOString();
  database.prepare(`
    INSERT INTO attendance_records (
      filename, user_id, role, status, attendance_type, outside_radius,
      attendance_date, captured_at, received_at, latitude, longitude, accuracy,
      location_address, image_width, image_height, image_size_bytes, image_type, user_agent
    ) VALUES (?, ?, 'siswa', 'Hadir', 'masuk', 0, ?, ?, ?, NULL, NULL, NULL, NULL, 640, 480, 18, 'image/jpeg', 'browser test')
  `).run(filename, studentId, timestamp.slice(0, 10), timestamp, timestamp);
  database.close();
}

test.beforeEach(async () => {
  runtime = fs.mkdtempSync(path.join(os.tmpdir(), "presensi-browser-"));
  databasePath = path.join(runtime, "presensi.sqlite");
  const seedDatabase = new DatabaseSync(databasePath);
  seedDatabase.exec(`
    CREATE TABLE students (
      nisn TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_phone TEXT NOT NULL DEFAULT ''
    )
  `);
  seedDatabase.prepare("INSERT INTO students (nisn, name) VALUES (?, ?)").run(studentId, "Siswa Browser");
  seedDatabase.prepare("INSERT INTO students (nisn, name) VALUES (?, ?)").run("202312052", "Siswa Lain");
  seedDatabase.close();

  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: databasePath,
      IMAGE_DIRECTORY: path.join(runtime, "images"),
      REPORT_DIRECTORY: path.join(runtime, "reports"),
      DATA_DIRECTORY: runtime,
      ADMIN_ID: adminId,
      ADMIN_PASSWORD: adminPassword,
      GURU_ID: teacherId,
      GURU_PASSWORD: teacherPassword,
    },
    stdio: "ignore",
  });
  await waitForServer(server);
  const database = new DatabaseSync(databasePath);
  const location = database.prepare(`
    INSERT INTO pkl_locations (company_name, address, created_at)
    VALUES (?, ?, ?)
  `).run("Perusahaan Uji", "Alamat Uji", new Date().toISOString());
  database.prepare(`
    INSERT INTO pkl_locations (company_name, address, created_at)
    VALUES (?, ?, ?)
  `).run("Perusahaan Uji Baru", "Alamat Uji Baru", new Date().toISOString());
  database.prepare("UPDATE students SET pkl_location_id = ?").run(Number(location.lastInsertRowid));
  database.prepare(`
    INSERT INTO user_profiles (user_id, display_name, contact, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(teacherId, "Guru Uji", "", new Date().toISOString());
  database.close();
});

test.afterEach(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  if (runtime && fs.existsSync(runtime)) fs.rmSync(runtime, { recursive: true, force: true });
});

test("admin login, automatic student account management, help, theme, and mobile layout", async ({ page }) => {
  await loginInBrowser(page, "admin", adminId, adminPassword);
  await changeRequiredPassword(page);
  await expect(page.getByRole("button", { name: /Manajemen akun/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Audit & sesi/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Rekap presensi/ })).toBeHidden();
  await expect(page.locator("#open-qr")).toBeHidden();

  await page.getByRole("button", { name: /Manajemen akun/ }).click();
  await expect(page.locator("#admin-user-form")).toBeVisible();
  await expect(page.locator("#admin-user-table")).toContainText(studentId);
  await expect(page.locator("#admin-user-role option[value='siswa']")).toHaveCount(0);
  const resetAccount = page.locator(`[data-admin-action="reset"][data-user-id="${studentId}"]`);
  await resetAccount.click();
  await page.locator("#reset-password-value").fill("student-reset-browser-123");
  await page.locator("#admin-reset-form").getByRole("button", { name: "Reset password" }).click();
  await expect(page.locator("#admin-reset-status")).toContainText("Password direset");
  page.on("dialog", (dialog) => dialog.accept());
  await page.locator(`[data-admin-action="active"][data-user-id="${studentId}"]`).click();
  await expect(page.locator("#admin-user-table")).toContainText("Nonaktif");
  await page.getByRole("button", { name: /Audit & sesi/ }).click();
  await expect(page.locator("#active-session-table")).toContainText(adminId);

  await page.locator("#open-top-account-menu").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#account-menu-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#account-menu-dialog")).not.toBeVisible();
  await page.locator("#open-top-account-menu").click();
  await expect(page.locator("#account-menu-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Tutorial penggunaan" }).click();
  await expect(page.locator("#tutorial-dialog")).toBeVisible();
  await expect(page.locator("#tutorial-dialog")).toContainText("Guru memantau siswa bimbingan");
  await page.getByRole("button", { name: "Tutup" }).click();
  await page.getByRole("button", { name: /Butuh bantuan/ }).click();
  await expect(page.locator("#help-dialog")).toBeVisible();
  await page.locator("#help-dialog").getByRole("button", { name: "Tutup" }).click();
  await page.locator("#open-top-account-menu").click();
  await page.locator("#account-menu-dialog").getByRole("button", { name: "Profil akun" }).click();
  await expect(page.locator("#teacher-profile-title")).toHaveText("Profil akun");

  await page.getByRole("button", { name: /Pengaturan/ }).click();
  await page.locator("#open-password-change").click();
  await page.locator("#new-password").fill("Admin-Settings-Password-2026!");
  await page.locator("#confirm-password").fill("Admin-Settings-Password-2026!");
  await page.locator("#password-change-form").getByRole("button", { name: "Simpan password" }).click();
  await expect(page.locator("#password-change-dialog")).not.toBeVisible();
  await page.locator('[data-theme="ocean"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
  await page.setViewportSize({ width: 390, height: 844 });
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBe(false);
});

test("teacher profile persists, assigned attendance photo is visible, and report review works", async ({ page }) => {
  await createStudentAccount();
  await uploadStudentReport();
  await addAttendanceRecord();

  await loginInBrowser(page, "guru", teacherId, teacherPassword);
  await expect(page.locator("#welcome-title")).toHaveText("Selamat datang, Guru Uji.");
  await expect(page.getByRole("button", { name: /Profil guru/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Manajemen akun/ })).toBeHidden();
  await expect(page.locator("#open-qr")).toBeHidden();
  await expect(page.locator("#students-table-body")).toContainText("Siswa Browser");

  await page.getByRole("button", { name: /Profil guru/ }).click();
  await page.locator("#teacher-profile-name-input").fill("Guru Pembimbing Uji");
  await page.locator("#teacher-profile-contact").fill("guru@example.test");
  await page.getByRole("button", { name: "Simpan profil" }).click();
  await expect(page.locator("#teacher-profile-status")).toContainText("Profil berhasil disimpan");
  await page.reload();
  await expect(page.locator("#welcome-title")).toHaveText("Selamat datang, Guru Pembimbing Uji.");
  await expect(page.locator("#teacher-profile-name-input")).toHaveValue("Guru Pembimbing Uji");

  await page.getByRole("button", { name: /Rekap presensi/ }).click();
  await expect(page.locator(".attendance-photo-thumb")).toBeVisible();
  await expect(page.locator(".attendance-photo-thumb")).toHaveAttribute("alt", /Siswa Browser/);

  await page.getByRole("button", { name: /Laporan PKL/ }).click();
  const reviewForm = page.locator('[data-report-review]');
  await expect(reviewForm).toBeVisible();
  await reviewForm.locator('select[name="status"]').selectOption("Disetujui");
  await reviewForm.locator('input[name="note"]').fill("Sudah diperiksa.");
  await reviewForm.getByRole("button", { name: "Simpan" }).click();
  await expect(reviewForm.locator('[role="status"]')).toContainText("berhasil disimpan");
  await expect(reviewForm.locator("..")).toContainText("Disetujui");

  await page.locator("#open-notifications").click();
  await expect(page.locator("#notifikasi-view")).toBeVisible();
  await expect(page.locator("#notification-nav-count")).toBeVisible();
  await page.getByRole("button", { name: "Tandai dibaca" }).click();
  await page.reload();
  await expect(page.locator("#notification-nav-count")).toBeHidden();
});

test("student camera/location mocks, upload persistence, attendance filters, download, and role visibility", async ({ page, context }) => {
  await createStudentAccount();
  await context.grantPermissions(["geolocation"], { origin: baseUrl });
  await context.setGeolocation({ latitude: -6.2, longitude: 106.8 });
  await page.addInitScript(() => {
    const NativeDate = Date;
    const fixedTime = "2026-10-19T07:00:00+07:00";
    globalThis.Date = class extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedTime]));
      }
      static now() {
        return new NativeDate(fixedTime).getTime();
      }
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success, error) {
          error({ code: 1 });
        },
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        async getUserMedia() {
          const track = { stop() {}, getSettings() { return { facingMode: "user" }; } };
          return { getTracks: () => [track], getVideoTracks: () => [track] };
        },
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get() { return this._testSrcObject || null; },
      set(value) { this._testSrcObject = value; },
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
      configurable: true,
      get() { return this.srcObject ? 640 : 0; },
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
      configurable: true,
      get() { return this.srcObject ? 480 : 0; },
    });
    globalThis.__cameraCanvasTransforms = [];
    const context2d = {
      fillStyle: "",
      textBaseline: "",
      font: "",
      save() { globalThis.__cameraCanvasTransforms.push("save"); },
      translate(x, y) { globalThis.__cameraCanvasTransforms.push(["translate", x, y]); },
      scale(x, y) { globalThis.__cameraCanvasTransforms.push(["scale", x, y]); },
      restore() { globalThis.__cameraCanvasTransforms.push("restore"); },
      fillRect() {},
      fillText() {},
      drawImage() {},
      measureText(text) { return { width: text.length * 6 }; },
    };
    HTMLCanvasElement.prototype.getContext = () => context2d;
    HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,/9j/2Q==";
  });
  await loginInBrowser(page, "Siswa/Siswi", studentId, studentId);
  await changeRequiredPassword(page);
  await expect(page.locator("#open-qr")).toBeVisible();
  await expect(page.getByRole("button", { name: /Manajemen akun/ })).toBeHidden();
  await expect(page.getByRole("button", { name: /Profil guru/ })).toBeHidden();
  await page.locator('nav [data-view="siswa"]').click();
  await expect(page.locator("#student-profile-name")).toHaveText("Siswa Browser");
  await expect(page.locator(".student-list-panel")).toBeHidden();
  await page.locator("#edit-student-location").click();
  await expect(page.locator("#student-location-dialog")).toBeVisible();
  await page.locator("#student-location-choice").selectOption({ label: "Perusahaan Uji Baru · Alamat Uji Baru" });
  await page.locator("#save-student-location").click();
  await expect(page.locator("#student-location-dialog")).not.toBeVisible();
  await page.reload();
  await page.locator('nav [data-view="siswa"]').click();
  await expect(page.locator("#profile-pkl-company")).toHaveText("Perusahaan Uji Baru");

  await page.locator('nav [data-view="dashboard"]').click();
  await page.locator("#open-qr").click();
  await expect(page.locator("#location-status")).toContainText("Izin lokasi ditolak");
  await page.locator("#enable-camera").click();
  await expect(page.locator("#camera-status")).toContainText("Kamera aktif");
  await expect(page.locator("#capture-face")).toBeEnabled();
  await expect.poll(() => page.locator("#camera-preview").evaluate((video) => getComputedStyle(video).transform))
    .toBe("matrix(-1, 0, 0, 1, 0, 0)");
  const desktopCameraModalWidth = await page.locator("#qr-modal .modal").evaluate((modal) =>
    Number.parseFloat(getComputedStyle(modal).width));
  expect(desktopCameraModalWidth).toBeGreaterThanOrEqual(500);
  await page.locator("#capture-face").click();
  expect(await page.evaluate(() => globalThis.__cameraCanvasTransforms)).toContainEqual(["scale", -1, 1]);
  await expect(page.locator("#camera-status")).toContainText("Foto wajah siap disimpan");
  await page.locator("#save-attendance").click();
  await expect(page.locator("#toast")).toHaveClass(/show/);

  await page.reload();
  await page.getByRole("button", { name: /Rekap presensi/ }).click();
  await expect(page.locator("#attendance-summary-count")).toContainText("1 catatan");
  await page.locator("#period-filter").selectOption("three-months");
  await page.locator("#status-filter").selectOption("Hadir");
  await expect(page.locator("#attendance-summary-count")).toContainText("1 catatan");
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#download-attendance").click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("rekap-presensi.csv");
  expect(fs.readFileSync(await download.path(), "utf8")).toContain(studentId);

  await page.getByRole("button", { name: /Laporan PKL/ }).click();
  await page.locator("#report-file").setInputFiles({
    name: "Browser Report.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nBrowser upload test\n"),
  });
  await page.getByRole("button", { name: /Upload laporan/ }).click();
  await expect(page.locator("#report-empty")).toContainText("Browser_Report.pdf");
  await page.reload();
  await page.getByRole("button", { name: /Laporan PKL/ }).click();
  await expect(page.locator("#report-empty")).toContainText("Browser_Report.pdf");
  await page.getByRole("button", { name: /Pengaturan/ }).click();
  await page.locator('[data-theme="terracotta"]').click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "terracotta");
  await page.setViewportSize({ width: 390, height: 844 });
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBe(false);
});
