// Pulihkan data dari folder backup yang dibuat scripts/backup.js.
//   node scripts/restore.js backups/presensi-2026-10-25T10-00-00-000Z --yes
// PENTING: hentikan server dulu. Data lama tidak dihapus: database lama disimpan sebagai
// "<database>.sebelum-restore-<waktu>" sebelum diganti. Foto/laporan dengan nama sama akan ditimpa.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const resolveRuntimePath = (value, fallback) => path.resolve(root, value || fallback);
const databasePath = resolveRuntimePath(process.env.DATABASE_PATH, path.join("data", "presensi.sqlite"));
const imageDirectory = resolveRuntimePath(process.env.IMAGE_DIRECTORY, "images");
const reportDirectory = resolveRuntimePath(process.env.REPORT_DIRECTORY, "reports");
const port = Number(process.env.PORT) || 3000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function copyFiles(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
    count += 1;
  }
  return count;
}

(async () => {
  const source = process.argv[2] && !process.argv[2].startsWith("--") ? path.resolve(process.argv[2]) : null;
  if (!source) fail("Pemakaian: node scripts/restore.js <folder-backup> --yes");
  if (!fs.existsSync(path.join(source, "presensi.sqlite"))) fail(`Bukan folder backup yang valid (presensi.sqlite tidak ada): ${source}`);
  if (!process.argv.includes("--yes")) {
    fail(`Restore akan mengganti database di ${databasePath}. Jalankan ulang dengan --yes setelah server dihentikan.`);
  }
  const running = await fetch(`http://localhost:${port}/healthz`, { signal: AbortSignal.timeout(700) })
    .then((response) => response.ok)
    .catch(() => false);
  if (running) fail(`Server masih berjalan di port ${port}. Hentikan server terlebih dahulu.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(databasePath + suffix)) {
      fs.renameSync(databasePath + suffix, `${databasePath}${suffix}.sebelum-restore-${stamp}`);
    }
  }
  fs.copyFileSync(path.join(source, "presensi.sqlite"), databasePath);
  const images = copyFiles(path.join(source, "images"), imageDirectory);
  const reports = copyFiles(path.join(source, "reports"), reportDirectory);
  console.log(`Restore selesai dari ${source}`);
  console.log(`Database dipulihkan. Foto: ${images}, laporan: ${reports}.`);
  console.log(`Database lama disimpan di ${databasePath}.sebelum-restore-${stamp}`);
})();
