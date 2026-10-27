const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const resolveRuntimePath = (value, fallback) => path.resolve(root, value || fallback);
const databasePath = resolveRuntimePath(process.env.DATABASE_PATH, path.join("data", "presensi.sqlite"));
const reportDirectory = resolveRuntimePath(process.env.REPORT_DIRECTORY, "reports");
const v2DataDirectory = resolveRuntimePath(
  process.env.V2_DATA_DIRECTORY,
  path.join("legacy", "barcode-version", "data"),
);
const destination = process.argv[2] ? path.resolve(process.argv[2]) : null;

function copyIfPresent(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
}

function backupDatabase(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const database = new DatabaseSync(source);
  try {
    const escapedTarget = target.replace(/'/g, "''");
    database.exec(`VACUUM INTO '${escapedTarget}'`);
  } finally {
    database.close();
  }
}

if (!destination) {
  console.error("Gunakan: node backup.js <folder-backup-baru>");
  process.exitCode = 1;
} else if (!fs.existsSync(databasePath)) {
  console.error(`Database V1 tidak ditemukan: ${databasePath}`);
  process.exitCode = 1;
} else if (fs.existsSync(destination)) {
  console.error(`Folder tujuan sudah ada; backup tidak menimpa: ${destination}`);
  process.exitCode = 1;
} else {
  try {
    fs.mkdirSync(destination, { recursive: false });
    backupDatabase(databasePath, path.join(destination, "v1", "presensi.sqlite"));
    const v2AuthDatabase = path.join(v2DataDirectory, "auth.sqlite");
    if (fs.existsSync(v2AuthDatabase)) {
      backupDatabase(v2AuthDatabase, path.join(destination, "v2", "data", "auth.sqlite"));
    }
    copyIfPresent(
      path.join(reportDirectory, "laporan-log.jsonl"),
      path.join(destination, "v1", "reports", "laporan-log.jsonl"),
    );
    for (const filename of ["presensi-log.jsonl", "presensi-koreksi.jsonl", "laporan-log.jsonl"]) {
      copyIfPresent(
        path.join(v2DataDirectory, filename),
        path.join(destination, "v2", "data", filename),
      );
    }
    console.log(`Backup SQLite dan JSONL selesai: ${destination}`);
  } catch (error) {
    console.error(`Backup gagal: ${error.message}`);
    process.exitCode = 1;
  }
}
