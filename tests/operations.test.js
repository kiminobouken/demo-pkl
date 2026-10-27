const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

test("SQLite and JSONL backup restores into a new directory without overwriting", (t) => {
  const project = path.join(__dirname, "..");
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "presensi-backup-"));
  const sourceData = path.join(runtime, "source-data");
  const sourceReports = path.join(runtime, "source-reports");
  const sourceV2 = path.join(runtime, "source-v2");
  const backup = path.join(runtime, "backup");
  const restored = path.join(runtime, "restored");
  fs.mkdirSync(sourceData);
  fs.mkdirSync(sourceReports);
  fs.mkdirSync(sourceV2);
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));

  const databasePath = path.join(sourceData, "presensi.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE backup_fixture (value TEXT NOT NULL)");
  database.prepare("INSERT INTO backup_fixture (value) VALUES (?)").run("before backup");
  database.close();
  fs.writeFileSync(path.join(sourceReports, "laporan-log.jsonl"), '{"filename":"report.pdf"}\n');
  fs.writeFileSync(path.join(sourceV2, "presensi-log.jsonl"), '{"id":"attendance-1"}\n');
  fs.writeFileSync(path.join(sourceV2, "presensi-koreksi.jsonl"), '{"id":"attendance-1","status":"Hadir"}\n');
  const v2Database = new DatabaseSync(path.join(sourceV2, "auth.sqlite"));
  v2Database.exec("CREATE TABLE account_fixture (value TEXT NOT NULL)");
  v2Database.prepare("INSERT INTO account_fixture (value) VALUES (?)").run("V2 account");
  v2Database.close();

  const env = {
    ...process.env,
    DATABASE_PATH: databasePath,
    REPORT_DIRECTORY: sourceReports,
    V2_DATA_DIRECTORY: sourceV2,
  };
  const backupRun = spawnSync(process.execPath, [path.join(project, "backup.js"), backup], {
    cwd: project,
    env,
    encoding: "utf8",
  });
  assert.equal(backupRun.status, 0, backupRun.stderr);

  const sourceAfterBackup = new DatabaseSync(databasePath);
  sourceAfterBackup.prepare("UPDATE backup_fixture SET value = ?").run("after backup");
  sourceAfterBackup.close();

  const restoreRun = spawnSync(process.execPath, [path.join(project, "restore-backup.js"), backup, restored], {
    cwd: project,
    encoding: "utf8",
  });
  assert.equal(restoreRun.status, 0, restoreRun.stderr);
  const restoredDb = new DatabaseSync(path.join(restored, "data", "presensi.sqlite"), { readOnly: true });
  assert.equal(restoredDb.prepare("SELECT value FROM backup_fixture").get().value, "before backup");
  assert.equal(restoredDb.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  restoredDb.close();
  const restoredV2Db = new DatabaseSync(path.join(restored, "v2-data", "auth.sqlite"), { readOnly: true });
  assert.equal(restoredV2Db.prepare("SELECT value FROM account_fixture").get().value, "V2 account");
  restoredV2Db.close();
  assert.equal(fs.readFileSync(path.join(restored, "reports", "laporan-log.jsonl"), "utf8"), '{"filename":"report.pdf"}\n');
  assert.equal(fs.readFileSync(path.join(restored, "v2-data", "presensi-log.jsonl"), "utf8"), '{"id":"attendance-1"}\n');

  const repeatRestore = spawnSync(process.execPath, [path.join(project, "restore-backup.js"), backup, restored], {
    cwd: project,
    encoding: "utf8",
  });
  assert.equal(repeatRestore.status, 1);
  assert.match(repeatRestore.stderr, /tidak menimpa/);
});
