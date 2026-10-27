const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { startTestServer, tinyPdf } = require("./support/server");

const projectRoot = path.join(__dirname, "..");
const runScript = (script, args, env) =>
  spawnSync(process.execPath, [path.join(projectRoot, "scripts", script), ...args], { env: { ...process.env, ...env }, encoding: "utf8" });

test("log terstruktur: rotasi berdasarkan ukuran, tanpa password", async (t) => {
  const server = startTestServer({ LOG_MAX_BYTES: "1500", LOG_MAX_FILES: "3" });
  t.after(async () => { await server.stop(); server.cleanup(); });
  await server.start();
  await server.login("admin.sekolah", "S3cretPw-Zzz-123"); // password salah, harus tidak muncul di log
  for (let i = 0; i < 60; i += 1) await server.api("GET", "/healthz");
  for (let i = 0; i < 40; i += 1) await server.api("GET", "/api/session");

  const logDirectory = path.join(server.runtime, "logs");
  const files = fs.readdirSync(logDirectory).sort();
  assert.ok(files.includes("app.log"));
  assert.ok(files.includes("app.log.1"), "log dirotasi");
  assert.ok(files.length <= 4, `maksimal app.log + 3 rotasi, ada: ${files}`);
  const all = files.map((name) => fs.readFileSync(path.join(logDirectory, name), "utf8")).join("\n");
  const lines = all.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(lines.some((line) => line.event === "request" && line.path === "/api/session" && line.status === 401));
  assert.ok(lines.every((line) => line.time && line.level && line.event));
  assert.ok(!all.includes("S3cretPw-Zzz-123"));
});

test("backup dan restore: SQLite, foto/laporan, JSONL, dengan pengaman", async (t) => {
  const server = startTestServer();
  t.after(async () => { await server.stop(); server.cleanup(); });
  await server.start();
  const { api } = server;
  const admin = await server.ready("admin.sekolah", "admin-password-123");
  await api("POST", "/api/students/import", { cookie: admin, text: "Nama Siswa,NISN\nBudi Santoso,1111111111\n" });
  // Akun siswa dibuat otomatis saat import; admin menetapkan password sementara yang dikenal tes.
  await api("POST", "/api/users/1111111111/reset-password", { cookie: admin, json: { password: "temp-password-budi-1" } });
  const siswa = await server.ready("1111111111", "temp-password-budi-1");
  const upload = await api("POST", "/api/report-upload", { cookie: siswa, json: { filename: "laporan.pdf", data: tinyPdf } });
  assert.equal(upload.status, 201);

  const env = {
    DATABASE_PATH: path.join(server.runtime, "presensi.sqlite"),
    IMAGE_DIRECTORY: path.join(server.runtime, "images"),
    REPORT_DIRECTORY: path.join(server.runtime, "reports"),
    BACKUP_DIRECTORY: path.join(server.runtime, "backups"),
    BACKUP_KEEP: "2",
  };
  for (let i = 0; i < 3; i += 1) {
    const result = runScript("backup.js", [], env); // aman saat server hidup
    assert.equal(result.status, 0, result.stderr);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const backups = fs.readdirSync(env.BACKUP_DIRECTORY).sort();
  assert.equal(backups.length, 2, "hanya BACKUP_KEEP terbaru yang disimpan");
  const latest = path.join(env.BACKUP_DIRECTORY, backups[backups.length - 1]);
  assert.ok(fs.existsSync(path.join(latest, "reports", upload.data.filename)));
  assert.ok(fs.readFileSync(path.join(latest, "reports", "laporan-log.jsonl"), "utf8").includes(upload.data.filename));
  const snapshot = new DatabaseSync(path.join(latest, "presensi.sqlite"));
  assert.equal(snapshot.prepare("SELECT name FROM students WHERE nisn = '1111111111'").get().name, "Budi Santoso");
  snapshot.close();

  // Restore ke lokasi lain (server uji tetap berjalan, jadi PORT diarahkan ke port kosong)
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "presensi-restore-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const restoreEnv = {
    DATABASE_PATH: path.join(target, "data", "presensi.sqlite"),
    IMAGE_DIRECTORY: path.join(target, "images"),
    REPORT_DIRECTORY: path.join(target, "reports"),
    PORT: "1",
  };
  assert.notEqual(runScript("restore.js", [latest], restoreEnv).status, 0, "tanpa --yes ditolak");
  assert.notEqual(runScript("restore.js", ["/tidak/ada", "--yes"], restoreEnv).status, 0);
  const blocked = runScript("restore.js", [latest, "--yes"], { ...restoreEnv, PORT: new URL(server.baseUrl).port });
  assert.notEqual(blocked.status, 0, "ditolak saat server masih berjalan");
  assert.match(blocked.stderr, /Hentikan server/);

  fs.mkdirSync(path.dirname(restoreEnv.DATABASE_PATH), { recursive: true });
  fs.writeFileSync(restoreEnv.DATABASE_PATH, "data lama");
  const restored = runScript("restore.js", [latest, "--yes"], restoreEnv);
  assert.equal(restored.status, 0, restored.stderr);
  const kept = fs.readdirSync(path.dirname(restoreEnv.DATABASE_PATH)).filter((name) => name.includes("sebelum-restore"));
  assert.equal(kept.length, 1, "data lama disimpan, tidak dihapus");
  const db = new DatabaseSync(restoreEnv.DATABASE_PATH);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM students").get().n, 1);
  db.close();
  assert.ok(fs.existsSync(path.join(restoreEnv.REPORT_DIRECTORY, upload.data.filename)));
});
