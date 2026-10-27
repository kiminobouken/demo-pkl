// Backup aplikasi presensi: database SQLite (snapshot konsisten), foto presensi, dan laporan beserta log JSONL.
// Aman dijalankan saat server hidup. Pakai variabel lingkungan yang sama dengan server.js.
//   node scripts/backup.js
// Opsional: BACKUP_DIRECTORY (default "backups"), BACKUP_KEEP (jumlah backup terbaru yang disimpan, default 14).
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const root = path.join(__dirname, "..");
const resolveRuntimePath = (value, fallback) => path.resolve(root, value || fallback);
const databasePath = resolveRuntimePath(process.env.DATABASE_PATH, path.join("data", "presensi.sqlite"));
const imageDirectory = resolveRuntimePath(process.env.IMAGE_DIRECTORY, "images");
const reportDirectory = resolveRuntimePath(process.env.REPORT_DIRECTORY, "reports");
const backupRoot = resolveRuntimePath(process.env.BACKUP_DIRECTORY, "backups");
const keep = Math.max(Number(process.env.BACKUP_KEEP) || 14, 1);

function copyFiles(from, to) {
  fs.mkdirSync(to, { recursive: true });
  if (!fs.existsSync(from)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.includes(".tmp-")) continue;
    fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
    count += 1;
  }
  return count;
}

if (!fs.existsSync(databasePath)) {
  console.error(`Database tidak ditemukan: ${databasePath}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(backupRoot, `presensi-${stamp}`);
fs.mkdirSync(target, { recursive: true });

const database = new DatabaseSync(databasePath);
try {
  database.prepare("VACUUM INTO ?").run(path.join(target, "presensi.sqlite"));
} finally {
  database.close();
}
const images = copyFiles(imageDirectory, path.join(target, "images"));
const reports = copyFiles(reportDirectory, path.join(target, "reports"));
fs.writeFileSync(
  path.join(target, "manifest.json"),
  JSON.stringify({ createdAt: new Date().toISOString(), images, reports, database: "presensi.sqlite" }, null, 2),
);

const old = fs.readdirSync(backupRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^presensi-\d{4}-/.test(entry.name))
  .map((entry) => entry.name)
  .sort();
for (const name of old.slice(0, Math.max(old.length - keep, 0))) {
  fs.rmSync(path.join(backupRoot, name), { recursive: true, force: true });
}

console.log(`Backup selesai: ${target}`);
console.log(`Database: 1 file, foto: ${images}, laporan (termasuk log): ${reports}. Menyimpan ${Math.min(old.length, keep)} backup terbaru.`);
