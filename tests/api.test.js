const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, recentWeekdayIso, tinyJpeg, tinyPdf } = require("./support/server");

const csv = [
  "Nama Siswa,NISN,No. HP Orang Tua,Kelas",
  "Budi Santoso,1111111111,081234567890,XII-A",
  "Citra Lestari,2222222222,081234567891,XII-B",
  "Dewi Anggraini,3333333333,081234567892,XII-A",
].join("\n");

test("API: autentikasi, RBAC server-side, scoping kelas, usulan lokasi, review laporan, persistensi", async (t) => {
  const server = startTestServer();
  t.after(async () => { await server.stop(); server.cleanup(); });
  await server.start();
  const { api } = server;

  const admin = await server.ready("admin.sekolah", "admin-password-123");
  const guruA = await server.ready("guru.a", "guru-a-password-123");

  // --- setup: kelas, guru B, penugasan, siswa, akun siswa
  const classA = (await api("POST", "/api/classes", { cookie: admin, json: { name: "XII-A" } })).data.class.id;
  const classB = (await api("POST", "/api/classes", { cookie: admin, json: { name: "XII-B" } })).data.class.id;
  assert.equal((await api("POST", "/api/classes", { cookie: admin, json: { name: "xii-a" } })).status, 400, "nama kelas unik");
  assert.equal((await api("POST", "/api/users", { cookie: admin, json: { id: "guru.b", role: "guru", password: "guru-b-password-123" } })).status, 201);
  assert.equal((await api("POST", `/api/classes/${classA}/teachers`, { cookie: admin, json: { teacherId: "guru.a" } })).status, 201);
  assert.equal((await api("POST", `/api/classes/${classB}/teachers`, { cookie: admin, json: { teacherId: "guru.b" } })).status, 201);
  assert.equal((await api("POST", "/api/students/import", { cookie: admin, text: csv })).status, 200);
  for (const nisn of ["1111111111", "2222222222", "3333333333"]) {
    // Import membuat akun siswa otomatis; admin lalu menetapkan password sementara yang dikenal tes.
    assert.equal((await api("POST", `/api/users/${nisn}/reset-password`, { cookie: admin, json: { password: `${nisn}-temp-pass` } })).status, 200);
  }
  const guruB = await server.ready("guru.b", "guru-b-password-123");

  await t.test("login: salah password ditolak, akun sementara wajib ganti password", async () => {
    assert.equal((await server.login("1111111111", "salah-salah-salah")).status, 401);
    const first = await server.login("1111111111", "1111111111-temp-pass");
    assert.equal(first.status, 200);
    assert.equal(first.data.user.mustChangePassword, true);
    assert.equal((await api("GET", "/api/attendance-records", { cookie: first.cookie })).status, 403, "API diblokir sebelum ganti password");
    assert.equal((await api("POST", "/api/password", { cookie: first.cookie, json: { password: "pendek" } })).status, 400);
    assert.equal((await api("POST", "/api/password", { cookie: first.cookie, json: { password: "password-baru-siswa-1" } })).status, 200);
    assert.equal((await api("GET", "/api/attendance-records", { cookie: first.cookie })).status, 200);
  });

  const siswa1 = (await server.login("1111111111", "password-baru-siswa-1")).cookie;
  const siswa2 = await server.ready("2222222222", "2222222222-temp-pass");

  await t.test("RBAC: siswa tidak bisa mengakses endpoint guru/admin", async () => {
    for (const [method, route] of [
      ["GET", "/api/students"], ["GET", "/api/users"], ["GET", "/api/audit-logs"], ["GET", "/api/notifications"],
      ["GET", "/api/students/2222222222"], ["POST", "/api/students/import"], ["POST", "/api/classes"],
    ]) {
      assert.equal((await api(method, route, { cookie: siswa1, json: method === "POST" ? {} : undefined })).status, 403, `${method} ${route}`);
    }
  });

  await t.test("RBAC: guru tidak bisa memakai fitur admin dan tidak bisa presensi/upload", async () => {
    for (const [method, route] of [["GET", "/api/users"], ["GET", "/api/audit-logs"], ["POST", "/api/classes"]]) {
      assert.equal((await api(method, route, { cookie: guruA, json: method === "POST" ? {} : undefined })).status, 403, `${method} ${route}`);
    }
    assert.equal((await api("POST", "/api/users", { cookie: guruA, json: { id: "guru.x", role: "guru", password: "password-guru-x-1" } })).status, 403);
    assert.equal((await api("POST", "/api/users", { cookie: guruA, json: { id: "admin.x", role: "admin", password: "password-admin-x1" } })).status, 403);
    const photo = { photo: tinyJpeg, image: { width: 640, height: 480 }, capturedAt: recentWeekdayIso() };
    for (const [name, cookie] of [["guru", guruA], ["admin", admin]]) {
      assert.equal((await api("POST", "/api/attendance-photo", { cookie, json: photo })).status, 403, `presensi ${name}`);
      assert.equal((await api("POST", "/api/report-upload", { cookie, json: { filename: "x.pdf", data: tinyPdf } })).status, 403, `upload ${name}`);
    }
  });

  await t.test("akun siswa hanya untuk NISN yang ada di master", async () => {
    const result = await api("POST", "/api/users", { cookie: admin, json: { id: "9999999999", role: "siswa", password: "password-sembilan-1" } });
    assert.equal(result.status, 400);
    assert.match(result.data.message, /master siswa/);
    const other = await api("POST", "/api/users", { cookie: guruA, json: { id: "2222222222", role: "siswa", password: "password-sembilan-2" } });
    assert.ok([400, 403].includes(other.status));
  });

  await t.test("no HP orang tua dimasking di API", async () => {
    const students = (await api("GET", "/api/students", { cookie: admin })).data;
    assert.equal(students.length, 3);
    assert.ok(students.every((s) => s.parentPhone === undefined && s.parentPhoneMasked.includes("*")));
  });

  await t.test("scoping: guru hanya melihat siswa di kelasnya", async () => {
    assert.deepEqual((await api("GET", "/api/students", { cookie: guruA })).data.map((s) => s.nisn).sort(), ["1111111111", "3333333333"]);
    assert.deepEqual((await api("GET", "/api/students", { cookie: guruB })).data.map((s) => s.nisn), ["2222222222"]);
    assert.equal((await api("GET", "/api/students/2222222222", { cookie: guruA })).status, 403);
    assert.equal((await api("PUT", "/api/students/2222222222/location", { cookie: guruA, json: { locationId: 1 } })).status, 403);
  });

  await t.test("impor CSV oleh guru: otomatis ke kelas guru, atomik, tidak bisa kelas lain", async () => {
    const ok = await api("POST", "/api/students/import", { cookie: guruA, text: "Nama Siswa,NISN\nEko Prasetyo,4444444444\n" });
    assert.equal(ok.status, 200);
    assert.equal((await api("GET", "/api/students/4444444444", { cookie: guruA })).data.className, "XII-A");
    const bad = await api("POST", "/api/students/import", { cookie: guruA, text: "Nama Siswa,NISN\nFajar Nugroho,5555555555\nBukan Sepuluh,123\n" });
    assert.equal(bad.status, 400);
    assert.equal((await api("GET", "/api/students/5555555555", { cookie: admin })).status, 404, "impor gagal tidak menyimpan sebagian");
    const otherClass = await api("POST", "/api/students/import", { cookie: guruA, text: "Nama Siswa,NISN,Kelas\nCitra Baru,2222222222,XII-B\n" });
    assert.equal(otherClass.status, 400);
    const takeover = await api("POST", "/api/students/import", { cookie: guruA, text: "Nama Siswa,NISN\nCitra Lestari,2222222222\n" });
    assert.equal(takeover.status, 400, "tidak boleh mengambil siswa kelas lain");
  });

  // --- presensi & laporan oleh siswa
  const capturedAt = recentWeekdayIso();
  const presensi = await api("POST", "/api/attendance-photo", {
    cookie: siswa1,
    json: { photo: tinyJpeg, image: { width: 640, height: 480 }, capturedAt, userId: "2222222222", role: "guru" },
  });
  assert.equal(presensi.status, 201, presensi.raw);
  assert.equal(presensi.data.record.userId, "1111111111", "userId/role dari body diabaikan");
  assert.equal(presensi.data.record.role, "siswa");
  const photoName = presensi.data.record.filename;
  const upload = await api("POST", "/api/report-upload", { cookie: siswa1, json: { filename: "laporan budi.pdf", data: tinyPdf } });
  assert.equal(upload.status, 201);
  const reportName = upload.data.filename;
  assert.equal((await api("POST", "/api/report-upload", { cookie: siswa1, json: { filename: "palsu.pdf", data: `data:application/pdf;base64,${Buffer.from("bukan pdf").toString("base64")}` } })).status, 400);

  await t.test("scoping presensi, laporan, notifikasi, dan file foto/laporan", async () => {
    const recordsA = (await api("GET", "/api/attendance-records", { cookie: guruA })).data;
    assert.equal(recordsA.length, 1);
    assert.equal(recordsA[0].studentName, "Budi Santoso");
    assert.equal((await api("GET", "/api/attendance-records", { cookie: guruB })).data.length, 0);
    assert.equal((await api("GET", "/api/attendance-records", { cookie: siswa2 })).data.length, 0);
    assert.equal((await api("GET", "/api/attendance-records", { cookie: admin })).data.length, 1);
    assert.equal((await api("GET", "/api/reports", { cookie: guruA })).data.length, 1);
    assert.equal((await api("GET", "/api/reports", { cookie: guruB })).data.length, 0);
    assert.equal((await api("GET", "/api/notifications", { cookie: guruB })).data.notifications.length, 0);
    assert.equal((await api("GET", "/api/notifications", { cookie: guruA })).data.notifications.length, 2);
    // file
    assert.equal((await api("GET", `/images/${photoName}`, { cookie: siswa1 })).status, 200);
    assert.equal((await api("GET", `/images/${photoName}`, { cookie: guruA })).status, 200);
    assert.equal((await api("GET", `/images/${photoName}`, { cookie: admin })).status, 200);
    assert.equal((await api("GET", `/images/${photoName}`, { cookie: guruB })).status, 403);
    assert.equal((await api("GET", `/images/${photoName}`, { cookie: siswa2 })).status, 403);
    assert.equal((await api("GET", `/images/${photoName}`)).status, 401);
    assert.equal((await api("GET", `/reports/${reportName}`, { cookie: guruB })).status, 403);
    assert.equal((await api("GET", "/reports/laporan-log.jsonl", { cookie: admin })).status, 404, "log internal tidak bisa diunduh");
  });

  await t.test("review laporan: hanya guru kelas terkait", async () => {
    const route = `/api/reports/${reportName}/review`;
    assert.equal((await api("POST", route, { cookie: siswa1, json: { status: "valid" } })).status, 403);
    assert.equal((await api("POST", route, { cookie: admin, json: { status: "valid" } })).status, 403);
    assert.equal((await api("POST", route, { cookie: guruB, json: { status: "valid" } })).status, 403);
    assert.equal((await api("POST", route, { cookie: guruA, json: { status: "asal" } })).status, 400);
    assert.equal((await api("POST", route, { cookie: guruA, json: { status: "perlu_revisi", note: "Tambahkan dokumentasi." } })).status, 200);
    const own = (await api("GET", "/api/reports", { cookie: siswa1 })).data[0];
    assert.equal(own.review.status, "perlu_revisi");
    assert.equal(own.review.note, "Tambahkan dokumentasi.");
    assert.equal((await api("POST", route, { cookie: guruA, json: { status: "valid" } })).status, 200);
    assert.equal((await api("GET", "/api/reports", { cookie: guruA })).data[0].review.status, "valid");
  });

  await t.test("usulan lokasi PKL: kirim, daftar, setujui, muncul di pilihan", async () => {
    const body = { companyName: "PT Contoh Digital", address: "Jalan Merdeka No. 10, Bandung" };
    assert.equal((await api("POST", "/api/pkl-location-requests", { cookie: guruA, json: body })).status, 403);
    assert.equal((await api("POST", "/api/pkl-location-requests", { cookie: siswa1, json: { companyName: "A", address: "x" } })).status, 400);
    const sent = await api("POST", "/api/pkl-location-requests", { cookie: siswa1, json: body });
    assert.equal(sent.status, 202);
    assert.equal((await api("POST", "/api/pkl-location-requests", { cookie: siswa1, json: body })).status, 400, "duplikat pending ditolak");
    const id = sent.data.request.id;
    assert.equal((await api("GET", "/api/pkl-location-requests", { cookie: guruA })).data.length, 1);
    assert.equal((await api("GET", "/api/pkl-location-requests", { cookie: guruB })).data.length, 0);
    assert.equal((await api("GET", "/api/pkl-location-requests", { cookie: siswa2 })).data.length, 0);
    assert.equal((await api("POST", `/api/pkl-location-requests/${id}/approve`, { cookie: siswa1 })).status, 403);
    assert.equal((await api("POST", `/api/pkl-location-requests/${id}/approve`, { cookie: guruB })).status, 403);
    const approved = await api("POST", `/api/pkl-location-requests/${id}/approve`, { cookie: guruA });
    assert.equal(approved.status, 200);
    assert.equal((await api("POST", `/api/pkl-location-requests/${id}/approve`, { cookie: guruA })).status, 409);
    const locations = (await api("GET", "/api/pkl-locations", { cookie: siswa1 })).data;
    assert.ok(locations.some((item) => item.companyName === "PT Contoh Digital" || item.company_name === "PT Contoh Digital"));
    assert.equal((await api("PUT", "/api/students/1111111111/location", { cookie: siswa1, json: { locationId: approved.data.locationId } })).status, 200);
    assert.equal((await api("PUT", "/api/students/2222222222/location", { cookie: siswa1, json: { locationId: approved.data.locationId } })).status, 403);
    assert.equal((await api("GET", "/api/students/1111111111", { cookie: siswa1 })).data.pklCompanyName, "PT Contoh Digital");
  });

  await t.test("admin: reset password, nonaktifkan akun, audit", async () => {
    assert.equal((await api("POST", "/api/users/2222222222/reset-password", { cookie: guruA, json: { password: "password-reset-123" } })).status, 403);
    assert.equal((await api("POST", "/api/users/2222222222/reset-password", { cookie: admin, json: { password: "pendek" } })).status, 400);
    assert.equal((await api("POST", "/api/users/2222222222/reset-password", { cookie: admin, json: { password: "password-reset-123" } })).status, 200);
    assert.equal((await api("GET", "/api/students/2222222222", { cookie: siswa2 })).status, 401, "sesi lama dicabut setelah reset");
    const relogin = await server.login("2222222222", "password-reset-123");
    assert.equal(relogin.data.user.mustChangePassword, true);
    assert.equal((await api("POST", "/api/users/2222222222/active", { cookie: admin, json: { active: false } })).status, 200);
    assert.equal((await server.login("2222222222", "password-reset-123")).status, 401, "akun nonaktif tidak bisa login");
    assert.equal((await api("GET", "/api/session", { cookie: relogin.cookie })).status, 401);
    assert.equal((await api("POST", "/api/users/admin.sekolah/active", { cookie: admin, json: { active: false } })).status, 400, "tidak bisa menonaktifkan diri sendiri");
    assert.equal((await api("POST", "/api/users/2222222222/active", { cookie: admin, json: { active: true } })).status, 200);
    const audit = (await api("GET", "/api/audit-logs", { cookie: admin })).data;
    for (const action of ["user_created", "password_reset", "user_deactivated", "report_reviewed", "location_request_approved"]) {
      assert.ok(audit.actions.includes(action), `audit memuat ${action}`);
    }
    assert.ok(!JSON.stringify(audit.logs).includes("password-reset-123"), "password tidak masuk audit");
    const users = (await api("GET", "/api/users", { cookie: admin })).data;
    assert.ok(users.every((user) => user.passwordHash === undefined && user.password_hash === undefined));
  });

  await t.test("healthz, body terlalu besar, URL rusak tidak mematikan server", async () => {
    assert.equal((await api("GET", "/healthz")).data.status, "ok");
    await fetch(`${server.baseUrl}/api/classes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: admin },
      body: JSON.stringify({ name: "x".repeat(50_000) }),
    }).catch(() => {});
    const bad = await fetch(`${server.baseUrl}/api/students/%E0%A4%A`, { headers: { Cookie: guruA } });
    assert.ok([400, 404].includes(bad.status));
    assert.equal((await api("GET", "/healthz")).status, 200);
  });

  await t.test("persistensi: data tetap ada setelah server di-restart", async () => {
    await server.stop();
    await server.start();
    const cookie = (await server.login("1111111111", "password-baru-siswa-1")).cookie;
    assert.equal((await api("GET", "/api/attendance-records", { cookie })).data.length, 1);
    const reports = (await api("GET", "/api/reports", { cookie })).data;
    assert.equal(reports.length, 1);
    assert.equal(reports[0].review.status, "valid");
    assert.equal((await api("GET", "/api/students/1111111111", { cookie })).data.pklCompanyName, "PT Contoh Digital");
    assert.equal((await api("GET", `/images/${photoName}`, { cookie })).status, 200);
  });
});
