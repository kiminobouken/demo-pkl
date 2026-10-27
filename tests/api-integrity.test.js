const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startTestServer, recentWeekdayIso, tinyJpeg, tinyPdf } = require("./support/server");

test("integritas: constraint database, rollback upload, batas presensi, batas body, traversal, rate limit", async (t) => {
  const server = startTestServer();
  t.after(async () => { await server.stop(); server.cleanup(); });
  await server.start();
  const { api } = server;
  const admin = await server.ready("admin.sekolah", "admin-password-123");
  const guru = await server.ready("guru.a", "guru-a-password-123");
  const classId = (await api("POST", "/api/classes", { cookie: admin, json: { name: "XII-A" } })).data.class.id;
  await api("POST", `/api/classes/${classId}/teachers`, { cookie: admin, json: { teacherId: "guru.a" } });
  await api("POST", "/api/students/import", { cookie: admin, text: "Nama Siswa,NISN,Kelas\nBudi Santoso,1111111111,XII-A\n" });
  // Akun siswa dibuat otomatis saat import; admin menetapkan password sementara yang dikenal tes.
  await api("POST", "/api/users/1111111111/reset-password", { cookie: admin, json: { password: "temp-password-budi-1" } });
  const siswa = await server.ready("1111111111", "temp-password-budi-1");

  await t.test("constraint database dan validasi impor CSV", async () => {
    assert.equal((await api("POST", `/api/classes/${classId}/teachers`, { cookie: admin, json: { teacherId: "guru.a" } })).status, 400, "penugasan ganda");
    assert.equal((await api("POST", `/api/classes/${classId}/teachers`, { cookie: admin, json: { teacherId: "1111111111" } })).status, 400, "hanya akun guru");
    assert.equal((await api("POST", "/api/classes/9999/teachers", { cookie: admin, json: { teacherId: "guru.a" } })).status, 404);
    assert.equal((await api("POST", "/api/users", { cookie: admin, json: { id: "guru.a", role: "guru", password: "password-duplikat-1" } })).status, 400, "ID unik");
    assert.equal((await api("POST", "/api/users", { cookie: admin, json: { id: "x y", role: "guru", password: "password-spasi-123" } })).status, 400);
    assert.equal((await api("POST", "/api/users", { cookie: admin, json: { id: "roleaneh", role: "kepsek", password: "password-spasi-123" } })).status, 400);
    assert.equal((await api("PUT", "/api/students/1111111111/class", { cookie: admin, json: { classId: 9999 } })).status, 400, "FK kelas");
    assert.equal((await api("PUT", "/api/students/1111111111/location", { cookie: siswa, json: { locationId: 424242 } })).status, 400, "FK lokasi");
    const cases = [
      ["header ganda", "Nama Siswa,NISN,NISN\nA B,1234567890,1234567890"],
      ["NISN dobel di CSV", "Nama Siswa,NISN\nAnita Dua,1234567890\nBudi Dua,1234567890"],
      ["NISN bukan 10 digit", "Nama Siswa,NISN\nAnita Dua,12345"],
      ["HP tidak valid", "Nama Siswa,NISN,No. HP Orang Tua\nAnita Dua,1234567890,12"],
      ["kolom wajib hilang", "Nama\nAnita Dua"],
    ];
    for (const [label, csv] of cases) {
      assert.equal((await api("POST", "/api/students/import", { cookie: admin, text: csv })).status, 400, label);
    }
    assert.equal((await api("GET", "/api/students/1234567890", { cookie: admin })).status, 404, "tidak ada data parsial");
  });

  await t.test("presensi: validasi foto, batas harian, hari kerja", async () => {
    const base = { image: { width: 640, height: 480 }, capturedAt: recentWeekdayIso() };
    assert.equal((await api("POST", "/api/attendance-photo", { cookie: siswa, json: { ...base, photo: "bukan-foto" } })).status, 400);
    assert.equal((await api("POST", "/api/attendance-photo", { cookie: siswa, json: { ...base, photo: tinyJpeg, image: { width: 100, height: 100 } } })).status, 400);
    assert.equal((await api("POST", "/api/attendance-photo", { cookie: siswa, json: { ...base, photo: tinyJpeg, capturedAt: "bukan-tanggal" } })).status, 400);
    const sunday = new Date(Date.UTC(2026, 9, 25, 3, 0, 0)).toISOString();
    assert.equal((await api("POST", "/api/attendance-photo", { cookie: siswa, json: { ...base, photo: tinyJpeg, capturedAt: sunday } })).status, 422, "akhir pekan ditolak");
    const first = await api("POST", "/api/attendance-photo", { cookie: siswa, json: { ...base, photo: tinyJpeg } });
    const second = await api("POST", "/api/attendance-photo", { cookie: siswa, json: { ...base, photo: tinyJpeg } });
    assert.equal(first.data.record.attendanceType, "masuk");
    assert.equal(second.data.record.attendanceType, "pulang");
    assert.equal((await api("POST", "/api/attendance-photo", { cookie: siswa, json: { ...base, photo: tinyJpeg } })).status, 409, "maksimal dua per hari");
    const records = (await api("GET", "/api/attendance-records", { cookie: guru })).data;
    assert.equal(records.length, 2);
    const names = fs.readdirSync(path.join(server.runtime, "images"));
    assert.equal(names.length, 2, "tidak ada foto yatim dari permintaan yang ditolak");
  });

  await t.test("upload laporan: rollback file saat log gagal, format dan ukuran", async () => {
    const reportsDir = path.join(server.runtime, "reports");
    const before = fs.readdirSync(reportsDir).length;
    fs.mkdirSync(path.join(reportsDir, "laporan-log.jsonl")); // membuat append log gagal
    const failed = await api("POST", "/api/report-upload", { cookie: siswa, json: { filename: "gagal.pdf", data: tinyPdf } });
    assert.equal(failed.status, 400);
    assert.deepEqual(fs.readdirSync(reportsDir).filter((name) => name.endsWith(".pdf")), [], "file dihapus kembali (rollback)");
    fs.rmdirSync(path.join(reportsDir, "laporan-log.jsonl"));
    assert.equal(fs.readdirSync(reportsDir).length, before);

    assert.equal((await api("POST", "/api/report-upload", { cookie: siswa, json: { filename: "../../etc/passwd.pdf", data: tinyPdf } })).status, 201, "nama dibersihkan, bukan ditulis ke luar folder");
    assert.ok(fs.readdirSync(reportsDir).every((name) => !name.includes("/") && !name.includes("..") || name === "laporan-log.jsonl"));
    assert.equal((await api("POST", "/api/report-upload", { cookie: siswa, json: { filename: "x.exe", data: "data:application/octet-stream;base64,AAAA" } })).status, 400);
    assert.equal((await api("POST", "/api/report-upload", { cookie: siswa, json: { filename: "x.pdf", data: `data:application/pdf;base64,${Buffer.from("bukan pdf").toString("base64")}` } })).status, 400, "tanda tangan file diperiksa");
  });

  await t.test("batas body: permintaan terlalu besar tidak menumbangkan server", async () => {
    const huge = JSON.stringify({ filename: "x.pdf", data: `data:application/pdf;base64,${"A".repeat(15_500_000)}` });
    const result = await fetch(`${server.baseUrl}/api/report-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: siswa },
      body: huge,
    }).then((response) => response.status).catch(() => "putus");
    assert.notEqual(result, 201);
    assert.equal((await api("GET", "/healthz")).status, 200);
  });

  await t.test("path traversal dan file runtime", async () => {
    for (const route of ["/images/..%2fserver.js", "/reports/%2e%2e/server.js", "/images/%2e%2e%2f%2e%2e%2fpackage.json", "/..%2fserver.js", "/.env", "/images/.hidden"]) {
      const result = await api("GET", route, { cookie: admin });
      assert.ok([400, 401, 403, 404].includes(result.status), `${route} -> ${result.status}`);
      assert.ok(!result.raw.includes("DatabaseSync"), route);
    }
    assert.equal((await api("GET", "/server.js")).status, 404, "kode server tidak disajikan");
  });

  await t.test("rate limit login", async () => {
    let last;
    for (let i = 0; i < 7; i += 1) last = await server.login("guru.a", `salah-salah-${i}-xx`);
    assert.notEqual(last.status, 200);
    assert.match(last.data.message, /Terlalu banyak percobaan/);
    assert.notEqual((await server.login("guru.a", "guru-a-password-123-changed")).status, 200, "akun terkunci sementara");
  });
});
