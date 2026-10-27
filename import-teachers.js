const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const csvPath = path.resolve(root, process.argv[2] || "data/database_guru.csv");
const selectedNips = String(process.argv[3] || "").split(",").map((value) => value.trim()).filter(Boolean);
const assignmentTarget = String(process.argv[4] || "").trim();
const additionalAdminId = String(process.argv[5] || "").trim();
const databasePath = path.resolve(root, process.env.DATABASE_PATH || "data/presensi.sqlite");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value);
      value = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("CSV memiliki tanda kutip yang tidak berpasangan.");
  if (value.length || row.length) {
    row.push(value);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

if (new Set(selectedNips).size !== selectedNips.length) {
  throw new Error("NIP akun guru tidak boleh duplikat.");
}
if (assignmentTarget && !/^\d{10}$/.test(assignmentTarget)) {
  throw new Error("NIP guru tujuan penugasan harus terdiri dari 10 angka.");
}
if (additionalAdminId && !/^[A-Za-z0-9._-]{3,80}$/.test(additionalAdminId)) {
  throw new Error("ID admin tambahan harus terdiri dari 3-80 huruf, angka, titik, garis bawah, atau tanda hubung.");
}
if (!fs.existsSync(csvPath)) throw new Error(`File master guru tidak ditemukan: ${csvPath}`);

const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
if (rows.length < 2) throw new Error("CSV master guru belum berisi data.");
const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
const nameIndex = headers.indexOf("namaguru");
const nipIndex = headers.findIndex((header) => header.startsWith("nip"));
const phoneIndex = headers.findIndex((header) => header.includes("telepon") || header.includes("telp"));
if (nameIndex < 0 || nipIndex < 0 || phoneIndex < 0) {
  throw new Error("CSV wajib memiliki kolom Nama Guru, NIP, dan No. Telepon.");
}

const seen = new Set();
const teachers = rows.slice(1).map((cells, index) => {
  if (cells.length > headers.length) throw new Error(`Jumlah kolom tidak sesuai pada baris ${index + 2}.`);
  const name = (cells[nameIndex] || "").trim();
  const nip = (cells[nipIndex] || "").trim();
  const phone = (cells[phoneIndex] || "").trim();
  const phoneDigits = phone.replace(/\D/g, "");
  if (name.length < 2 || name.length > 120) throw new Error(`Nama guru pada baris ${index + 2} tidak valid.`);
  if (!/^\d{10}$/.test(nip)) throw new Error(`NIP pada baris ${index + 2} harus terdiri dari 10 angka.`);
  if (phoneDigits.length < 10 || phoneDigits.length > 15) throw new Error(`Nomor telepon pada baris ${index + 2} tidak valid.`);
  if (seen.has(nip)) throw new Error(`NIP ${nip} tercantum lebih dari sekali.`);
  seen.add(nip);
  return { nip, name, phone };
});
if (!teachers.length) throw new Error("Master guru belum berisi data.");
for (const nip of [...selectedNips, ...(assignmentTarget ? [assignmentTarget] : [])]) {
  if (!seen.has(nip)) throw new Error(`NIP ${nip} tidak ditemukan pada master guru.`);
}

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON");
const hashPassword = (password) => {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
};
const now = new Date().toISOString();
const generatedAdminPassword = additionalAdminId ? crypto.randomBytes(24).toString("base64url") : null;
const createdTeacherAccounts = [];
let updatedAssignments = 0;
let createdAdditionalAdmin = false;

db.exec(`
  CREATE TABLE IF NOT EXISTS teachers (
    nip TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )
`);
db.exec("BEGIN IMMEDIATE");
try {
  const upsertTeacher = db.prepare(`
    INSERT INTO teachers (nip, name, phone, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(nip) DO UPDATE SET name = excluded.name, phone = excluded.phone
  `);
  const findUser = db.prepare("SELECT role FROM users WHERE id = ?");
  const insertUser = db.prepare(`
    INSERT INTO users (id, role, password_hash, must_change_password, is_active, created_at)
    VALUES (?, ?, ?, 1, 1, ?)
  `);
  const insertProfile = db.prepare(`
    INSERT INTO user_profiles (user_id, display_name, contact, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      display_name = excluded.display_name, contact = excluded.contact, updated_at = excluded.updated_at
  `);
  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (actor_id, action, target, before_value, after_value, created_at)
    VALUES (NULL, ?, ?, ?, ?, ?)
  `);

  for (const teacher of teachers) upsertTeacher.run(teacher.nip, teacher.name, teacher.phone, now);

  for (const nip of selectedNips) {
    const teacher = teachers.find((item) => item.nip === nip);
    const existing = findUser.get(nip);
    if (existing && existing.role !== "guru") throw new Error(`ID ${nip} sudah digunakan oleh role ${existing.role}.`);
    if (!existing) {
      insertUser.run(nip, "guru", hashPassword(nip), now);
      createdTeacherAccounts.push(nip);
      insertAudit.run("user_created_from_teacher_master", nip, null, JSON.stringify({ role: "guru" }), now);
    }
    insertProfile.run(nip, teacher.name, teacher.phone, now);
  }

  if (additionalAdminId) {
    const existingAdmin = findUser.get(additionalAdminId);
    if (existingAdmin && existingAdmin.role !== "admin") {
      throw new Error(`ID admin ${additionalAdminId} sudah digunakan oleh role ${existingAdmin.role}.`);
    }
    if (!existingAdmin) {
      insertUser.run(additionalAdminId, "admin", hashPassword(generatedAdminPassword), now);
      insertProfile.run(additionalAdminId, "Admin Sekolah 2", "", now);
      insertAudit.run("user_created_locally", additionalAdminId, null, JSON.stringify({ role: "admin" }), now);
      createdAdditionalAdmin = true;
    }
  }

  if (assignmentTarget) {
    const target = findUser.get(assignmentTarget);
    if (!target || target.role !== "guru") throw new Error("Akun guru tujuan penugasan belum tersedia.");
    const assignments = db.prepare("SELECT student_nisn AS studentNisn, teacher_id AS teacherId FROM teacher_student_assignments").all();
    const moveAssignment = db.prepare(`
      UPDATE teacher_student_assignments SET teacher_id = ?, assigned_at = ?
      WHERE student_nisn = ? AND teacher_id != ?
    `);
    for (const assignment of assignments) {
      const result = moveAssignment.run(assignmentTarget, now, assignment.studentNisn, assignmentTarget);
      if (result.changes) {
        updatedAssignments += result.changes;
        insertAudit.run(
          "teacher_student_assignment_changed",
          assignment.studentNisn,
          JSON.stringify({ teacherId: assignment.teacherId }),
          JSON.stringify({ teacherId: assignmentTarget }),
          now,
        );
      }
    }
  }
  insertAudit.run(
    "teacher_master_imported",
    "database_guru.csv",
    null,
    JSON.stringify({ imported: teachers.length, accountNips: selectedNips, assignmentTarget }),
    now,
  );
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  db.close();
  throw error;
}

const result = {
  masterTeachersImported: teachers.length,
  teacherAccountsCreated: createdTeacherAccounts,
  teacherPasswords: "Password sementara akun guru sama dengan NIP; wajib diganti saat login pertama.",
  additionalAdminId: additionalAdminId || null,
  additionalAdminPassword: createdAdditionalAdmin ? generatedAdminPassword : null,
  assignmentTarget,
  assignmentsUpdated: updatedAssignments,
  databasePath,
};
db.close();
console.log(JSON.stringify(result, null, 2));
