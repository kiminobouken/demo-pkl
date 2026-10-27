const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

test("teacher master import creates selected accounts and transfers assignments transactionally", (t) => {
  const project = path.join(__dirname, "..");
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "presensi-teacher-import-"));
  const databasePath = path.join(runtime, "presensi.sqlite");
  const csvPath = path.join(runtime, "database_guru.csv");
  const nips = [
    "1020304051",
    "1020304052",
    "1020304053",
    "1020304054",
    "1020304055",
  ];
  const rows = [
    '"No","Nama Guru","NIP (10 digit)","No. Telepon"',
    ...Array.from({ length: 15 }, (_, index) => {
      const nip = `1020304${String(index + 51).padStart(3, "0")}`;
      return `${index + 1},"Guru ${index + 1}, S.Pd.","${nip}","0812-5550-${String(index + 1).padStart(4, "0")}"`;
    }),
  ];
  rows[3] = '3,"Guru 3, S.Pd.","1020304053","0813-5550-0103"';
  fs.writeFileSync(csvPath, `${rows.join("\r\n")}\r\n`, "utf8");
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE students (nisn TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE teacher_student_assignments (
      student_nisn TEXT PRIMARY KEY REFERENCES students(nisn),
      teacher_id TEXT NOT NULL REFERENCES users(id),
      assigned_at TEXT NOT NULL
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT,
      action TEXT NOT NULL,
      target TEXT,
      before_value TEXT,
      after_value TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO users (id, role, password_hash, must_change_password, is_active, created_at)
    VALUES ('admin.sekolah', 'admin', 'existing-admin-hash', 0, 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO users (id, role, password_hash, must_change_password, is_active, created_at)
    VALUES ('guru.pembimbing', 'guru', 'existing-guru-hash', 0, 1, '2026-01-01T00:00:00.000Z');
  `);
  const insertStudent = db.prepare("INSERT INTO students (nisn, name) VALUES (?, ?)");
  const insertAssignment = db.prepare(`
    INSERT INTO teacher_student_assignments (student_nisn, teacher_id, assigned_at)
    VALUES (?, 'guru.pembimbing', '2026-01-01T00:00:00.000Z')
  `);
  for (let index = 1; index <= 15; index += 1) {
    const nisn = String(index).padStart(10, "0");
    insertStudent.run(nisn, `Siswa ${index}`);
    insertAssignment.run(nisn);
  }
  db.close();

  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));

  const runImport = (accountNips = nips.join(","), assignmentTarget = "1020304053", adminId = "admin.kedua") => spawnSync(process.execPath, [
    path.join(project, "import-teachers.js"),
    csvPath,
    accountNips,
    assignmentTarget,
    adminId,
  ], {
    cwd: project,
    env: { ...process.env, DATABASE_PATH: databasePath },
    encoding: "utf8",
  });

  const imported = runImport();
  assert.equal(imported.status, 0, imported.stderr);
  const output = JSON.parse(imported.stdout);
  assert.equal(output.masterTeachersImported, 15);
  assert.deepEqual(output.teacherAccountsCreated, nips);
  assert.match(output.additionalAdminPassword, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(output.assignmentTarget, "1020304053");
  assert.equal(output.assignmentsUpdated, 15);

  const verify = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM teachers").get().count, 15);
  assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'guru'").get().count, 6);
  assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count, 2);
  assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM user_profiles WHERE user_id IN (?, ?, ?, ?, ?)")
    .get(...nips).count, 5);
  assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM teacher_student_assignments WHERE teacher_id = '1020304053'").get().count, 15);
  assert.equal(verify.prepare("SELECT role FROM users WHERE id = 'guru.pembimbing'").get().role, "guru");
  assert.equal(verify.prepare("SELECT password_hash FROM users WHERE id = 'guru.pembimbing'").get().password_hash, "existing-guru-hash");
  assert.equal(verify.prepare("SELECT role, must_change_password FROM users WHERE id = '1020304053'").get().must_change_password, 1);

  for (const nip of nips) {
    const row = verify.prepare("SELECT password_hash FROM users WHERE id = ?").get(nip);
    const [saltHex, keyHex] = row.password_hash.split(":");
    assert.equal(crypto.scryptSync(nip, Buffer.from(saltHex, "hex"), 64).toString("hex"), keyHex);
  }
  const admin = verify.prepare("SELECT password_hash FROM users WHERE id = 'admin.kedua'").get();
  const [saltHex, keyHex] = admin.password_hash.split(":");
  assert.equal(crypto.scryptSync(output.additionalAdminPassword, Buffer.from(saltHex, "hex"), 64).toString("hex"), keyHex);
  verify.close();

  const repeated = runImport();
  assert.equal(repeated.status, 0, repeated.stderr);
  const repeatedOutput = JSON.parse(repeated.stdout);
  assert.deepEqual(repeatedOutput.teacherAccountsCreated, []);
  assert.equal(repeatedOutput.additionalAdminPassword, null);
  assert.equal(repeatedOutput.assignmentsUpdated, 0);

  fs.appendFileSync(csvPath, '16,"Guru Baru, S.Pd.","1020304999","0812-5550-9999"\r\n', "utf8");
  const updatedMaster = runImport("", "", "");
  assert.equal(updatedMaster.status, 0, updatedMaster.stderr);
  assert.equal(JSON.parse(updatedMaster.stdout).masterTeachersImported, 16);

  const addedAccount = runImport("1020304999", "", "");
  assert.equal(addedAccount.status, 0, addedAccount.stderr);
  assert.deepEqual(JSON.parse(addedAccount.stdout).teacherAccountsCreated, ["1020304999"]);
  const afterIncrementalImport = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(afterIncrementalImport.prepare("SELECT COUNT(*) AS count FROM teachers").get().count, 16);
  assert.equal(afterIncrementalImport.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'guru'").get().count, 7);
  assert.equal(afterIncrementalImport.prepare("SELECT COUNT(*) AS count FROM teacher_student_assignments WHERE teacher_id = '1020304053'").get().count, 15);
  afterIncrementalImport.close();
});
