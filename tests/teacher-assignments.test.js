const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { startTestServer } = require("./support/server");

// Fitur gabungan: penugasan guru-siswa (versi A) berdampingan dengan kelas (versi B).
// Aturan akses: guru melihat siswa yang ditugaskan langsung kepadanya ATAU yang ada di kelas yang ia ampu.
const csv = [
  "Nama Siswa,NISN,No. HP Orang Tua,Kelas",
  "Budi Santoso,1111111111,081234567890,XII-A",
  "Citra Lestari,2222222222,081234567891,XII-B",
  "Dewi Anggraini,3333333333,081234567892,",
].join("\n");

const visibleNisns = async (api, cookie) =>
  (await api("GET", "/api/students", { cookie })).data.map((student) => student.nisn).sort();

test("penugasan guru-siswa digabung dengan kelas, data guru, sesi aktif, dan akun siswa otomatis", async (t) => {
  const server = startTestServer();
  t.after(async () => { await server.stop(); server.cleanup(); });
  await server.start();
  const { api } = server;

  const admin = await server.ready("admin.sekolah", "admin-password-123");
  const guruA = await server.ready("guru.a", "guru-a-password-123");
  const classA = (await api("POST", "/api/classes", { cookie: admin, json: { name: "XII-A" } })).data.class.id;
  await api("POST", "/api/classes", { cookie: admin, json: { name: "XII-B" } });

  await t.test("import membuat akun siswa otomatis dengan password sementara = NISN", async () => {
    const imported = await api("POST", "/api/students/import", { cookie: admin, text: csv });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.imported, 3);
    assert.equal(imported.data.accountsCreated, 3);
    const first = await server.login("1111111111", "1111111111");
    assert.equal(first.status, 200);
    assert.equal(first.data.user.role, "siswa");
    assert.equal(first.data.user.mustChangePassword, true);
    const again = await api("POST", "/api/students/import", { cookie: admin, text: csv });
    assert.equal(again.data.accountsCreated, 0, "import ulang tidak membuat akun ganda");
    const duplicate = await api("POST", "/api/users", { cookie: admin, json: { id: "1111111111", role: "siswa", password: "password-duplikat-1" } });
    assert.equal(duplicate.status, 400, "akun yang sudah dibuat otomatis tidak dibuat ulang manual");
  });

  await t.test("guru tanpa kelas dan tanpa penugasan tidak melihat siswa", async () => {
    assert.deepEqual(await visibleNisns(api, guruA), []);
  });

  await t.test("guru melihat siswa kelasnya (kelas) dan siswa yang ditugaskan langsung (penugasan)", async () => {
    assert.equal((await api("POST", `/api/classes/${classA}/teachers`, { cookie: admin, json: { teacherId: "guru.a" } })).status, 201);
    assert.deepEqual(await visibleNisns(api, guruA), ["1111111111"], "lewat kelas");

    const assigned = await api("PUT", "/api/teacher-assignments", { cookie: admin, json: { studentNisn: "3333333333", teacherId: "guru.a" } });
    assert.equal(assigned.status, 200);
    assert.deepEqual(await visibleNisns(api, guruA), ["1111111111", "3333333333"], "kelas + penugasan langsung");

    const list = (await api("GET", "/api/teacher-assignments", { cookie: admin })).data;
    assert.deepEqual(list.map((item) => [item.studentNisn, item.teacherId]), [["3333333333", "guru.a"]]);

    const cleared = await api("PUT", "/api/teacher-assignments", { cookie: admin, json: { studentNisn: "3333333333", teacherId: "" } });
    assert.equal(cleared.status, 200);
    assert.deepEqual(await visibleNisns(api, guruA), ["1111111111"], "penugasan dicabut");
  });

  await t.test("validasi dan RBAC penugasan", async () => {
    const put = (cookie, json) => api("PUT", "/api/teacher-assignments", { cookie, json });
    assert.equal((await put(guruA, { studentNisn: "3333333333", teacherId: "guru.a" })).status, 403, "guru tidak boleh menugaskan");
    assert.equal((await put(admin, { studentNisn: "9999999999", teacherId: "guru.a" })).status, 400, "NISN tidak ada");
    assert.equal((await put(admin, { studentNisn: "3333333333", teacherId: "tidak.ada" })).status, 400, "guru tidak ada");
    assert.equal((await put(admin, { studentNisn: "3333333333", teacherId: "admin.sekolah" })).status, 400, "hanya akun guru");
    assert.equal((await api("GET", "/api/teacher-assignments", { cookie: guruA })).status, 403);
    assert.equal((await api("GET", "/api/teachers", { cookie: guruA })).status, 403);
    assert.equal((await api("GET", "/api/teachers", { cookie: admin })).status, 200);
    assert.deepEqual((await api("GET", "/api/teachers", { cookie: admin })).data, [], "master guru kosong pada database baru");
  });

  await t.test("penugasan tercatat di audit", async () => {
    const audit = (await api("GET", "/api/audit-logs", { cookie: admin })).data;
    assert.ok(audit.actions.includes("teacher_student_assignment_changed"));
  });

  await t.test("guru tanpa kelas dapat mengimpor: siswanya ditugaskan langsung kepadanya", async () => {
    assert.equal((await api("POST", "/api/users", { cookie: admin, json: { id: "guru.c", role: "guru", password: "guru-c-password-123" } })).status, 201);
    const guruC = await server.ready("guru.c", "guru-c-password-123");
    const own = ["Nama Siswa,NISN,No. HP Orang Tua", "Eko Prasetyo,4444444444,081234567893", "Fitri Handayani,5555555555,081234567894"].join("\n");
    const imported = await api("POST", "/api/students/import", { cookie: guruC, text: own });
    assert.equal(imported.status, 200, imported.raw);
    assert.equal(imported.data.accountsCreated, 2);
    assert.deepEqual(await visibleNisns(api, guruC), ["4444444444", "5555555555"]);
    assert.deepEqual(await visibleNisns(api, guruA), ["1111111111"], "guru lain tidak melihatnya");

    const stolen = await api("POST", "/api/students/import", { cookie: guruC, text: ["Nama Siswa,NISN,No. HP Orang Tua", "Budi Santoso,1111111111,081234567890"].join("\n") });
    assert.equal(stolen.status, 400, "siswa milik kelas lain tidak dapat diambil alih");
    assert.match(stolen.data.message, /pembimbing atau kelas lain/);
  });

  await t.test("sesi aktif hanya untuk admin", async () => {
    const sessions = await api("GET", "/api/sessions", { cookie: admin });
    assert.equal(sessions.status, 200);
    const users = sessions.data.map((item) => item.userId);
    assert.ok(users.includes("admin.sekolah") && users.includes("guru.a"));
    assert.ok(sessions.data.every((item) => item.role && item.createdAt && item.expiresAt));
    assert.equal((await api("GET", "/api/sessions", { cookie: guruA })).status, 403);
    assert.equal((await api("GET", "/api/sessions")).status, 401);
  });

  await t.test("respons sesi memuat profil, dan /api/health serta /healthz tersedia", async () => {
    const me = (await api("GET", "/api/session", { cookie: admin })).data.user;
    assert.equal(me.id, "admin.sekolah");
    assert.ok("displayName" in me && "contact" in me);
    const health = await api("GET", "/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.data, { ok: true, status: "healthy" });
    assert.equal((await api("GET", "/healthz")).data.status, "ok");
  });
});

test("database format B (kolom users.active) dimigrasi ke is_active tanpa mengaktifkan akun nonaktif", async (t) => {
  const server = startTestServer();
  t.after(async () => { await server.stop(); server.cleanup(); });
  const hash = (password) => {
    const salt = crypto.randomBytes(16);
    return `${salt.toString("hex")}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
  };
  const legacy = new DatabaseSync(path.join(server.runtime, "presensi.sqlite"));
  legacy.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('siswa', 'guru', 'admin')),
    password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)`);
  const insert = legacy.prepare("INSERT INTO users (id, role, password_hash, must_change_password, created_at, active) VALUES (?, 'guru', ?, 0, ?, ?)");
  insert.run("guru.aktif", hash("guru-aktif-password-1"), new Date().toISOString(), 1);
  insert.run("guru.nonaktif", hash("guru-nonaktif-password-1"), new Date().toISOString(), 0);
  legacy.close();

  await server.start();
  assert.equal((await server.login("guru.aktif", "guru-aktif-password-1")).status, 200);
  assert.equal((await server.login("guru.nonaktif", "guru-nonaktif-password-1")).status, 401, "akun nonaktif tetap nonaktif");
  const admin = await server.ready("admin.sekolah", "admin-password-123");
  const users = (await server.api("GET", "/api/users", { cookie: admin })).data;
  assert.equal(users.find((user) => user.id === "guru.nonaktif").active, false);
  assert.equal(users.find((user) => user.id === "guru.aktif").active, true);
  assert.ok(fs.existsSync(path.join(server.runtime, "presensi.sqlite")));
});
