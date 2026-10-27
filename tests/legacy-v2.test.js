const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

// V2 (legacy/barcode-version) dijalankan terpisah; log presensi diisi lebih dulu agar tes tidak bergantung pada jam/hari.
test("V2: scan, koreksi admin yang di-merge, dan role", async (t) => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "presensi-v2-"));
  const dataDir = path.join(runtime, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const seeded = { id: "entri-uji-1", nis: "202312047", nama: "Raka Aditya", kelas: "XI RPL 2", code: "202312047", type: "masuk", status: "Terlambat", date: "2026-10-20", time: "08:20", createdAt: "2026-10-20T01:20:00.000Z", metadata: { capturedAt: "2026-10-20T01:20:00.000Z", latitude: null, longitude: null, accuracy: null } };
  fs.writeFileSync(path.join(dataDir, "presensi-log.jsonl"), `${JSON.stringify(seeded)}\n`);
  const port = 5100 + Math.floor(Math.random() * 800);
  const base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["--require", path.join(__dirname, "support", "fixed-clock.js"), path.join(__dirname, "..", "legacy", "barcode-version", "server.js")], {
    stdio: "ignore",
    env: { ...process.env, FIXED_NOW: "2026-10-23T01:30:00.000Z", V2_PORT: String(port), V2_DATA_DIRECTORY: dataDir, V2_REPORT_DIRECTORY: path.join(runtime, "reports"), ADMIN_PASSWORD: "admin-v2-password-1", GURU_PASSWORD: "guru-v2-password-12", SISWA_PASSWORD: "siswa-v2-password-1" },
  });
  t.after(async () => { const exited = new Promise((resolve) => child.once("exit", resolve)); child.kill(); await exited; fs.rmSync(runtime, { recursive: true, force: true }); });
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`${base}/api/session`)).status === 401) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const call = async (method, route, { cookie, json } = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(json ? { "Content-Type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : undefined });
    const text = await response.text();
    let data = null; try { data = JSON.parse(text); } catch {}
    return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const login = async (id, password) => (await call("POST", "/api/login", { json: { id, password } })).cookie;
  const admin = await login("admin.sekolah", "admin-v2-password-1");
  const guru = await login("198507122010012003", "guru-v2-password-12");
  const siswa = await login("202312047", "siswa-v2-password-1");
  assert.ok(admin && guru && siswa);
  // Server V2 mewajibkan ganti password sementara sebelum fitur lain dipakai (seperti tes V2 lainnya).
  for (const cookie of [admin, guru, siswa]) {
    assert.equal((await call("POST", "/api/password", { cookie, json: { password: "v2-password-baru-123" } })).status, 200);
  }

  const metadata = { capturedAt: new Date().toISOString(), latitude: -6.2, longitude: 106.8, accuracy: 10 };
  assert.equal((await call("POST", "/api/attendance-scan", { json: { code: "202312047", metadata } })).status, 401);
  assert.equal((await call("POST", "/api/attendance-scan", { cookie: guru, json: { code: "202312047", metadata } })).status, 403, "guru tidak memindai");
  assert.equal((await call("POST", "/api/attendance-scan", { cookie: admin, json: { code: "202312047", metadata } })).status, 403, "admin tidak memindai");
  assert.equal((await call("POST", "/api/attendance-scan", { cookie: siswa, json: { code: "99999", metadata } })).status, 422, "barcode milik siswa lain");
  assert.equal((await call("POST", "/api/attendance-scan", { cookie: siswa, json: { code: "202312047", metadata: { capturedAt: "bukan-tanggal" } } })).status, 400);
  assert.equal((await call("POST", "/api/attendance-scan", { cookie: siswa, json: { metadata } })).status, 400);

  // Jalur sukses (jam dibekukan: Jumat 08:30 WIB): masuk terlambat, pulang sebelum 15:00 ditolak
  assert.equal((await call("POST", "/api/attendance-scan", { cookie: siswa, json: { code: "202312047", metadata: { ...metadata, latitude: 200 } } })).status, 422, "lokasi wajib valid untuk presensi masuk");
  const scan = await call("POST", "/api/attendance-scan", { cookie: siswa, json: { code: "202312047|v1", metadata } });
  assert.equal(scan.status, 201);
  assert.equal(scan.data.type, "masuk");
  assert.equal(scan.data.date, "2026-10-23");
  assert.equal(scan.data.time, "08:30");
  assert.equal((await call("POST", "/api/attendance-scan", { cookie: siswa, json: { code: "202312047", metadata } })).status, 422, "pulang sebelum 15:00 ditolak");
  const scanned = (await call("GET", "/api/my-attendance", { cookie: siswa })).data.find((entry) => entry.date === "2026-10-23" && entry.type === "masuk");
  assert.equal(scanned.nis, "202312047");
  assert.equal(scanned.status, "Terlambat", "scan pukul 08:30 melewati batas 08:00");

  // Koreksi: hanya admin, dan hasilnya di-merge ke log tanpa mengubah entri asli
  const log = (cookie) => call("GET", "/api/attendance-log", { cookie });
  assert.equal((await log(siswa)).status, 403);
  const before = (await log(admin)).data.find((entry) => entry.id === "entri-uji-1");
  assert.equal(before.corrected, false);
  const correction = { id: "entri-uji-1", status: "Hadir", reason: "Bukti surat izin keterlambatan" };
  assert.equal((await call("POST", "/api/attendance-correction", { cookie: guru, json: correction })).status, 403);
  assert.equal((await call("POST", "/api/attendance-correction", { cookie: siswa, json: correction })).status, 403);
  assert.equal((await call("POST", "/api/attendance-correction", { cookie: admin, json: { ...correction, status: "Bolos" } })).status, 400, "status harus dikenal");
  assert.equal((await call("POST", "/api/attendance-correction", { cookie: admin, json: { ...correction, id: "tidak-ada" } })).status, 400);
  assert.equal((await call("POST", "/api/attendance-correction", { cookie: admin, json: { ...correction, reason: "x".repeat(501) } })).status, 400);
  assert.equal((await call("POST", "/api/attendance-correction", { cookie: admin, json: correction })).status, 200);
  const after = (await log(guru)).data.find((entry) => entry.id === "entri-uji-1");
  assert.equal(after.status, "Hadir");
  assert.equal(after.corrected, true);
  assert.equal(after.correctedBy, "admin.sekolah");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "presensi-log.jsonl"), "utf8").split("\n")[0]).status, "Terlambat", "log asli tidak diubah");
  const mine = (await call("GET", "/api/my-attendance", { cookie: siswa })).data;
  assert.ok(mine.every((entry) => entry.nis === "202312047"));
  assert.equal(mine.find((entry) => entry.id === "entri-uji-1").status, "Hadir");
});
