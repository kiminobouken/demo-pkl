const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const source = process.argv[2] ? path.resolve(process.argv[2]) : null;
const destination = process.argv[3] ? path.resolve(process.argv[3]) : null;
const backupDatabasePath = source && path.join(source, "v1", "presensi.sqlite");
const v2AuthDatabasePath = source && path.join(source, "v2", "data", "auth.sqlite");

function validateJsonl(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const [index, line] of fs.readFileSync(filePath, "utf8").split(/\r?\n/).entries()) {
    if (!line) continue;
    try {
      JSON.parse(line);
    } catch {
      throw new Error(`JSONL tidak valid pada ${filePath}, baris ${index + 1}.`);
    }
  }
}

function validateDatabase(filePath) {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    const result = database.prepare("PRAGMA integrity_check").get();
    if (result.integrity_check !== "ok") throw new Error("Backup SQLite gagal integrity_check.");
  } finally {
    database.close();
  }
}

if (!source || !destination) {
  console.error("Gunakan: node restore-backup.js <folder-backup> <folder-pemulihan-baru>");
  process.exitCode = 1;
} else if (!fs.existsSync(backupDatabasePath)) {
  console.error("Backup SQLite V1 tidak ditemukan.");
  process.exitCode = 1;
} else if (fs.existsSync(destination)) {
  console.error(`Folder tujuan sudah ada; pemulihan tidak menimpa: ${destination}`);
  process.exitCode = 1;
} else {
  try {
    validateDatabase(backupDatabasePath);
    if (fs.existsSync(v2AuthDatabasePath)) validateDatabase(v2AuthDatabasePath);
    validateJsonl(path.join(source, "v1", "reports", "laporan-log.jsonl"));
    for (const filename of ["presensi-log.jsonl", "presensi-koreksi.jsonl", "laporan-log.jsonl"]) {
      validateJsonl(path.join(source, "v2", "data", filename));
    }

    fs.mkdirSync(destination, { recursive: false });
    fs.mkdirSync(path.join(destination, "data"), { recursive: true });
    fs.mkdirSync(path.join(destination, "reports"), { recursive: true });
    fs.mkdirSync(path.join(destination, "v2-data"), { recursive: true });
    fs.copyFileSync(backupDatabasePath, path.join(destination, "data", "presensi.sqlite"), fs.constants.COPYFILE_EXCL);
    if (fs.existsSync(v2AuthDatabasePath)) {
      fs.copyFileSync(v2AuthDatabasePath, path.join(destination, "v2-data", "auth.sqlite"), fs.constants.COPYFILE_EXCL);
    }

    const v1ReportLog = path.join(source, "v1", "reports", "laporan-log.jsonl");
    if (fs.existsSync(v1ReportLog)) {
      fs.copyFileSync(v1ReportLog, path.join(destination, "reports", "laporan-log.jsonl"), fs.constants.COPYFILE_EXCL);
    }
    for (const filename of ["presensi-log.jsonl", "presensi-koreksi.jsonl", "laporan-log.jsonl"]) {
      const sourceFile = path.join(source, "v2", "data", filename);
      if (fs.existsSync(sourceFile)) {
        fs.copyFileSync(sourceFile, path.join(destination, "v2-data", filename), fs.constants.COPYFILE_EXCL);
      }
    }
    console.log(`Pemulihan selesai di folder baru: ${destination}`);
  } catch (error) {
    console.error(`Pemulihan gagal: ${error.message}`);
    process.exitCode = 1;
  }
}
