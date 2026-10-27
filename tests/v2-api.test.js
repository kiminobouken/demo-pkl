const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

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

async function waitForServer(baseUrl, child) {
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

async function loginInfo(baseUrl, id, password) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, password }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, result.message);
  return {
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    user: result.user,
  };
}

async function login(baseUrl, id, password) {
  return (await loginInfo(baseUrl, id, password)).cookie;
}

async function request(baseUrl, cookie, endpoint, options = {}) {
  return fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      Cookie: cookie,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

test("V2 enforces scan/correction roles and merges the latest correction", async (t) => {
  const project = path.join(__dirname, "..");
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "presensi-v2-api-"));
  const dataDirectory = path.join(runtime, "data");
  const reportDirectory = path.join(runtime, "reports");
  fs.mkdirSync(dataDirectory);
  fs.mkdirSync(reportDirectory);
  const authDatabase = new DatabaseSync(path.join(dataDirectory, "auth.sqlite"));
  authDatabase.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('siswa', 'guru', 'admin')),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE students (
      nis TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      kelas TEXT NOT NULL,
      barcode_version INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
  const legacySalt = crypto.randomBytes(16);
  const legacyHash = crypto.scryptSync("legacy-v2-password-123", legacySalt, 64);
  authDatabase.prepare("INSERT INTO users (id, role, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run("guru.v2.legacy", "guru", `${legacySalt.toString("hex")}:${legacyHash.toString("hex")}`, new Date().toISOString());
  authDatabase.close();
  const attendanceEntry = {
    id: "attendance-original",
    nis: "202312047",
    nama: "Siswa Uji",
    kelas: "XI RPL 2",
    code: "202312047",
    type: "masuk",
    status: "Terlambat",
    date: "2026-10-23",
    time: "08:15",
    createdAt: "2026-10-23T01:15:00.000Z",
    metadata: { capturedAt: "2026-10-23T01:15:00.000Z", latitude: null, longitude: null, accuracy: null },
  };
  fs.writeFileSync(path.join(dataDirectory, "presensi-log.jsonl"), `${JSON.stringify(attendanceEntry)}\n`);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.join(project, "legacy", "barcode-version", "server.js")], {
    cwd: project,
    env: {
      ...process.env,
      V2_PORT: String(port),
      V2_DATA_DIRECTORY: dataDirectory,
      V2_REPORT_DIRECTORY: reportDirectory,
      V2_ADMIN_ID: "admin.v2.test",
      V2_GURU_ID: "guru.v2.test",
      V2_SISWA_ID: "202312047",
      ADMIN_PASSWORD: "admin-v2-temporary-123",
      GURU_PASSWORD: "guru-v2-temporary-123",
      SISWA_PASSWORD: "student-v2-temporary-123",
    },
    stdio: "ignore",
  });
  t.after(async () => {
    if (server.exitCode === null) {
      server.kill();
      await new Promise((resolve) => server.once("exit", resolve));
    }
    fs.rmSync(runtime, { recursive: true, force: true });
  });
  await waitForServer(baseUrl, server);

  const legacyLogin = await loginInfo(baseUrl, "guru.v2.legacy", "legacy-v2-password-123");
  assert.equal(legacyLogin.user.mustChangePassword, false);
  const legacyLogout = await request(baseUrl, legacyLogin.cookie, "/api/logout", { method: "POST" });
  assert.equal(legacyLogout.status, 200);
  assert.equal((await request(baseUrl, legacyLogin.cookie, "/api/session")).status, 401);

  const adminLogin = await loginInfo(baseUrl, "admin.v2.test", "admin-v2-temporary-123");
  const admin = adminLogin.cookie;
  assert.equal(adminLogin.user.mustChangePassword, true);
  assert.equal((await request(baseUrl, admin, "/api/attendance-log")).status, 403);
  assert.equal((await request(baseUrl, admin, "/api/session").then((response) => response.json())).user.mustChangePassword, true);
  assert.equal((await request(baseUrl, admin, "/api/password", {
    method: "POST",
    body: JSON.stringify({ password: "short" }),
  })).status, 400);
  assert.equal((await request(baseUrl, admin, "/api/password", {
    method: "POST",
    body: JSON.stringify({ password: "admin-v2-current-password-123" }),
  })).status, 200);

  const teacherLogin = await loginInfo(baseUrl, "guru.v2.test", "guru-v2-temporary-123");
  const teacher = teacherLogin.cookie;
  assert.equal(teacherLogin.user.mustChangePassword, true);
  assert.equal((await request(baseUrl, teacher, "/api/password", {
    method: "POST",
    body: JSON.stringify({ password: "guru-v2-current-password-123" }),
  })).status, 200);
  const studentLogin = await loginInfo(baseUrl, "202312047", "student-v2-temporary-123");
  const student = studentLogin.cookie;
  assert.equal(studentLogin.user.mustChangePassword, true);
  assert.equal((await request(baseUrl, student, "/api/password", {
    method: "POST",
    body: JSON.stringify({ password: "student-v2-current-password-123" }),
  })).status, 200);
  assert.equal((await request(baseUrl, teacher, "/api/attendance-log")).status, 200);
  assert.equal((await request(baseUrl, student, "/api/attendance-log")).status, 403);
  assert.equal((await request(baseUrl, teacher, "/api/attendance-correction", {
    method: "POST",
    body: JSON.stringify({ id: attendanceEntry.id, status: "Alpha" }),
  })).status, 403);
  assert.equal((await request(baseUrl, teacher, "/api/attendance-scan", {
    method: "POST",
    body: JSON.stringify({}),
  })).status, 403);

  const invalidScan = await request(baseUrl, student, "/api/attendance-scan", {
    method: "POST",
    body: JSON.stringify({
      code: "not-the-student-code",
      metadata: { capturedAt: "2026-10-23T01:15:00.000Z", latitude: -6.2, longitude: 106.8, accuracy: 20 },
    }),
  });
  assert.equal(invalidScan.status, 422);
  const oversizedScan = await request(baseUrl, student, "/api/attendance-scan", {
    method: "POST",
    body: JSON.stringify({ payload: "x".repeat(110_000) }),
  });
  assert.equal(oversizedScan.status, 413);
  assert.equal((await request(baseUrl, admin, "/api/attendance-log")).status, 200);

  assert.equal((await request(baseUrl, admin, "/api/attendance-correction", {
    method: "POST",
    body: JSON.stringify({ id: "missing-record", status: "Alpha" }),
  })).status, 400);
  const correction = await request(baseUrl, admin, "/api/attendance-correction", {
    method: "POST",
    body: JSON.stringify({ id: attendanceEntry.id, status: "Alpha", reason: "Verifikasi pembimbing" }),
  });
  assert.equal(correction.status, 200);
  const merged = await request(baseUrl, admin, "/api/attendance-log").then((response) => response.json());
  const corrected = merged.find((entry) => entry.id === attendanceEntry.id);
  assert.equal(corrected.status, "Alpha");
  assert.equal(corrected.previousStatus, "Terlambat");
  assert.equal(corrected.correctionReason, "Verifikasi pembimbing");
  assert.equal(corrected.correctedBy, "admin.v2.test");

  assert.equal((await request(baseUrl, teacher, "/api/users/202312047/password", {
    method: "POST",
    body: JSON.stringify({ password: "student-v2-reset-password-123" }),
  })).status, 403);
  const resetResponse = await request(baseUrl, admin, "/api/users/202312047/password", {
    method: "POST",
    body: JSON.stringify({ password: "student-v2-reset-password-123" }),
  });
  assert.equal(resetResponse.status, 200);
  assert.equal((await request(baseUrl, student, "/api/my-attendance")).status, 401);
  const resetStudent = await loginInfo(baseUrl, "202312047", "student-v2-reset-password-123");
  assert.equal(resetStudent.user.mustChangePassword, true);
  assert.equal((await request(baseUrl, resetStudent.cookie, "/api/my-attendance")).status, 403);
  assert.equal((await request(baseUrl, resetStudent.cookie, "/api/password", {
    method: "POST",
    body: JSON.stringify({ password: "student-v2-recovered-password-123" }),
  })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "202312047", password: "student-v2-current-password-123" }),
  })).status, 401);
});
