const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { LoginAttemptLimiter } = require("./login-attempt-limiter");

const root = __dirname;
const publicDirectory = path.join(root, "public");
const resolveRuntimePath = (value, fallback) =>
  path.resolve(root, value || fallback);
const imageDirectory = resolveRuntimePath(process.env.IMAGE_DIRECTORY, "images");
const reportDirectory = resolveRuntimePath(process.env.REPORT_DIRECTORY, "reports");
const dataDirectory = resolveRuntimePath(process.env.DATA_DIRECTORY, "data");
const databasePath = resolveRuntimePath(
  process.env.DATABASE_PATH,
  path.join("data", "presensi.sqlite"),
);
const sessionCookieName = "presensi_session";
const loginAttempts = new LoginAttemptLimiter();
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
fs.mkdirSync(imageDirectory, { recursive: true });
fs.mkdirSync(reportDirectory, { recursive: true });
fs.mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec("PRAGMA foreign_keys = ON");
database.exec(`
  CREATE TABLE IF NOT EXISTS students (
    nisn TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_phone TEXT NOT NULL DEFAULT ''
  )
`);
database.exec(`
  CREATE TABLE IF NOT EXISTS pkl_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    address TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
    UNIQUE(company_name, address)
  )
`);
for (const column of ["latitude", "longitude"]) {
  if (!database.prepare("PRAGMA table_info(pkl_locations)").all().some((item) => item.name === column)) {
    database.exec(`ALTER TABLE pkl_locations ADD COLUMN ${column} REAL`);
  }
}
if (!database
  .prepare("PRAGMA table_info(pkl_locations)")
  .all()
  .some((column) => column.name === "created_at")) {
  database.exec("ALTER TABLE pkl_locations ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'");
  database.prepare("UPDATE pkl_locations SET created_at = ?").run(new Date().toISOString());
}
if (!database.prepare("PRAGMA table_info(students)").all().some((column) => column.name === "pkl_location_id")) {
  database.exec(
    "ALTER TABLE students ADD COLUMN pkl_location_id INTEGER REFERENCES pkl_locations(id)",
  );
}
database.exec(`
  CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Hadir',
    attendance_type TEXT NOT NULL DEFAULT 'masuk' CHECK (attendance_type IN ('masuk', 'pulang')),
    outside_radius INTEGER NOT NULL DEFAULT 0,
    attendance_date TEXT,
    captured_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    accuracy REAL,
    location_address TEXT,
    image_width INTEGER,
    image_height INTEGER,
    image_size_bytes INTEGER NOT NULL,
    image_type TEXT NOT NULL,
    user_agent TEXT NOT NULL
  )
`);
if (!database.prepare("PRAGMA table_info(attendance_records)").all().some((column) => column.name === "attendance_type")) {
  database.exec("ALTER TABLE attendance_records ADD COLUMN attendance_type TEXT NOT NULL DEFAULT 'masuk'");
}
if (!database.prepare("PRAGMA table_info(attendance_records)").all().some((column) => column.name === "outside_radius")) {
  database.exec("ALTER TABLE attendance_records ADD COLUMN outside_radius INTEGER NOT NULL DEFAULT 0");
}
if (!database.prepare("PRAGMA table_info(attendance_records)").all().some((column) => column.name === "attendance_date")) {
  database.exec("ALTER TABLE attendance_records ADD COLUMN attendance_date TEXT");
}
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('siswa', 'guru', 'admin')),
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    before_value TEXT,
    after_value TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notification_reads (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id TEXT NOT NULL,
    read_at TEXT NOT NULL,
    PRIMARY KEY (user_id, notification_id)
  );
`);
database.exec(`
  CREATE TABLE IF NOT EXISTS pkl_location_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_nisn TEXT NOT NULL REFERENCES students(nisn) ON DELETE CASCADE,
    company_name TEXT NOT NULL,
    address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL
  )
`);
if (!database
  .prepare("PRAGMA table_info(users)")
  .all()
  .some((column) => column.name === "must_change_password")) {
  database.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1");
}
if (!database
  .prepare("PRAGMA table_info(attendance_records)")
  .all()
  .some((column) => column.name === "location_address")) {
  database.exec("ALTER TABLE attendance_records ADD COLUMN location_address TEXT");
}

database.exec(`
  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS teacher_classes (
    teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    PRIMARY KEY (teacher_id, class_id)
  );
  CREATE TABLE IF NOT EXISTS report_reviews (
    filename TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('valid', 'perlu_revisi')),
    note TEXT NOT NULL DEFAULT '',
    reviewer_id TEXT NOT NULL,
    reviewed_at TEXT NOT NULL
  );
`);
if (!database.prepare("PRAGMA table_info(students)").all().some((column) => column.name === "class_id")) {
  database.exec("ALTER TABLE students ADD COLUMN class_id INTEGER REFERENCES classes(id)");
}
{
  const userColumns = database.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  if (!userColumns.includes("is_active")) {
    database.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
    // Database dari versi B memakai kolom "active": salin statusnya agar akun nonaktif tetap nonaktif.
    if (userColumns.includes("active")) database.exec("UPDATE users SET is_active = active");
  }
}

const shouldSeedTeacherAssignments = !database
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'teacher_student_assignments'")
  .get();
database.exec(`
  CREATE TABLE IF NOT EXISTS account_provisioning_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS teachers (
    nip TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS teacher_student_assignments (
    student_nisn TEXT PRIMARY KEY REFERENCES students(nisn) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS teacher_student_assignments_teacher_id
    ON teacher_student_assignments (teacher_id);
  -- Siswa yang diampu guru = ditugaskan langsung (versi A) ATAU berada di kelas guru itu (versi B).
  CREATE VIEW IF NOT EXISTS teacher_visible_students AS
    SELECT teacher_id, student_nisn FROM teacher_student_assignments
    UNION
    SELECT teacher_classes.teacher_id, students.nisn
    FROM teacher_classes JOIN students ON students.class_id = teacher_classes.class_id;
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

function verifyPassword(password, storedHash) {
  const [saltHex, keyHex] = String(storedHash).split(":");
  if (!saltHex || !keyHex) return false;
  const expected = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const actual = Buffer.from(keyHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function seedConfiguredUser(id, role, password) {
  if (!id || !password || password.length < 12) return;
  if (database.prepare("SELECT id FROM users WHERE id = ?").get(id)) return;
  database.prepare(
    "INSERT INTO users (id, role, password_hash, must_change_password, created_at) VALUES (?, ?, ?, 1, ?)",
  ).run(id, role, hashPassword(password), new Date().toISOString());
  console.log(`Akun ${role} ${id} dibuat dari environment.`);
}

function seedAdmin() {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminPassword && adminPassword.length >= 12) {
    seedConfiguredUser(
      String(process.env.ADMIN_ID || "admin.sekolah").trim(),
      "admin",
      adminPassword,
    );
  } else if (!database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()) {
    console.warn("Akun admin belum dibuat. Set ADMIN_PASSWORD minimal 12 karakter lalu restart server.");
  }
  seedConfiguredUser(
    String(process.env.GURU_ID || "").trim(),
    "guru",
    process.env.GURU_PASSWORD,
  );
}

function getUserProfile(userId) {
  return database.prepare(
    "SELECT display_name AS displayName, contact FROM user_profiles WHERE user_id = ?",
  ).get(userId) || { displayName: "", contact: "" };
}

function seedMissingStudentAccounts() {
  const migrationName = "student-nisn-temporary-password-v1";
  if (database.prepare("SELECT 1 FROM account_provisioning_migrations WHERE name = ?").get(migrationName)) return;
  const students = database.prepare("SELECT nisn FROM students").all();
  const insertStudentAccount = database.prepare(`
    INSERT OR IGNORE INTO users (id, role, password_hash, must_change_password, created_at)
    VALUES (?, 'siswa', ?, 1, ?)
  `);
  const existingAccount = database.prepare("SELECT role, must_change_password AS mustChangePassword FROM users WHERE id = ?");
  const setTemporaryStudentPassword = database.prepare(`
    UPDATE users SET password_hash = ? WHERE id = ? AND role = 'siswa' AND must_change_password = 1
  `);
  let created = 0;
  let initialized = 0;
  database.exec("BEGIN");
  try {
    for (const student of students) {
      const storedAccount = existingAccount.get(student.nisn);
      const passwordHash = hashPassword(student.nisn);
      if (!storedAccount) {
        created += insertStudentAccount.run(student.nisn, passwordHash, new Date().toISOString()).changes;
      } else if (storedAccount.role === "siswa" && storedAccount.mustChangePassword) {
        initialized += setTemporaryStudentPassword.run(passwordHash, student.nisn).changes;
      }
    }
    database.prepare("INSERT INTO account_provisioning_migrations (name, applied_at) VALUES (?, ?)")
      .run(migrationName, new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  if (created || initialized) {
    console.log(`${created} akun siswa otomatis dibuat; ${initialized} password sementara siswa diinisialisasi dari NISN.`);
  }
}

// Hanya untuk database lama tanpa tabel penugasan: bila ada tepat satu guru aktif,
// siswa yang belum punya kelas ditugaskan kepadanya. Siswa yang sudah berkelas tidak disentuh.
function seedInitialTeacherAssignments() {
  if (!shouldSeedTeacherAssignments) return;
  const teachers = database.prepare("SELECT id FROM users WHERE role = 'guru' AND is_active = 1").all();
  if (teachers.length !== 1) return;
  const now = new Date().toISOString();
  const assignStudent = database.prepare(`
    INSERT OR IGNORE INTO teacher_student_assignments (student_nisn, teacher_id, assigned_at)
    VALUES (?, ?, ?)
  `);
  database.exec("BEGIN");
  try {
    for (const { nisn } of database.prepare("SELECT nisn FROM students WHERE class_id IS NULL ORDER BY nisn").all()) {
      assignStudent.run(nisn, teachers[0].id, now);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value)
      .map(([name, ...value]) => [name, decodeURIComponent(value.join("="))]),
  );
}

function getSession(request) {
  const sessionId = parseCookies(request)[sessionCookieName];
  if (!sessionId) return null;
  const session = database.prepare(`
    SELECT sessions.id, sessions.expires_at, users.id AS user_id, users.role,
      users.must_change_password AS mustChangePassword
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ? AND sessions.expires_at > ? AND users.is_active = 1
  `).get(sessionId, new Date().toISOString());
  return session || null;
}

function writeJson(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function audit(request, action, target, beforeValue = null, afterValue = null, actorId = null) {
  database.prepare(`
    INSERT INTO audit_logs (actor_id, action, target, before_value, after_value, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    actorId,
    action,
    target,
    beforeValue ? JSON.stringify(beforeValue) : null,
    afterValue ? JSON.stringify(afterValue) : null,
    request.socket.remoteAddress
      ? `${request.socket.remoteAddress} | ${String(request.headers["user-agent"] || "").slice(0, 300)}`
      : String(request.headers["user-agent"] || "").slice(0, 300) || null,
    new Date().toISOString(),
  );
}

function unauthorized(response) {
  writeJson(response, 401, { ok: false, message: "Sesi login diperlukan." });
}

function forbidden(response) {
  writeJson(response, 403, { ok: false, message: "Anda tidak memiliki akses untuk tindakan ini." });
}

function hasRole(session, roles) {
  return session && roles.includes(session.role);
}

const logDirectory = path.join(dataDirectory, "logs");
const logFile = path.join(logDirectory, "app.log");
const maxLogBytes = Number(process.env.LOG_MAX_BYTES) || 5 * 1024 * 1024;
const maxLogFiles = Math.max(Number(process.env.LOG_MAX_FILES) || 5, 1);
fs.mkdirSync(logDirectory, { recursive: true });

function rotateLogIfNeeded() {
  if (!fs.existsSync(logFile) || fs.statSync(logFile).size < maxLogBytes) return;
  fs.rmSync(`${logFile}.${maxLogFiles}`, { force: true });
  for (let index = maxLogFiles - 1; index >= 1; index -= 1) {
    if (fs.existsSync(`${logFile}.${index}`)) fs.renameSync(`${logFile}.${index}`, `${logFile}.${index + 1}`);
  }
  fs.renameSync(logFile, `${logFile}.1`);
}

function logEvent(level, event, fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  (level === "error" ? console.error : console.log)(line);
  try {
    rotateLogIfNeeded();
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    // Logging must never break a request.
  }
}

function withJsonBody(request, response, handler, limit = 20_000) {
  let body = "";
  let tooLarge = false;
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > limit) {
      tooLarge = true;
      request.destroy();
    }
  });
  request.on("end", () => {
    if (tooLarge) return;
    try {
      let payload;
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        throw new Error("Format permintaan tidak valid.");
      }
      handler(payload);
    } catch (error) {
      writeJson(response, error.status || 400, { ok: false, message: error.message });
    }
  });
}

const guruStudentScope = "students.nisn IN (SELECT student_nisn FROM teacher_visible_students WHERE teacher_id = ?)";

function attendanceScope(session) {
  if (session.role === "admin") return { clause: "1 = 1", params: [] };
  if (session.role === "guru") {
    return { clause: `user_id IN (SELECT nisn FROM students WHERE ${guruStudentScope})`, params: [session.user_id] };
  }
  return { clause: "user_id = ?", params: [session.user_id] };
}

function canAccessStudent(session, nisn) {
  if (session.role === "admin") return true;
  if (session.role === "siswa") return session.user_id === nisn;
  if (session.role !== "guru") return false;
  return Boolean(database.prepare(`SELECT 1 FROM students WHERE nisn = ? AND ${guruStudentScope}`).get(nisn, session.user_id));
}

function visibleNisns(session) {
  if (session.role === "admin") return null;
  if (session.role === "guru") {
    return new Set(database.prepare(`SELECT nisn FROM students WHERE ${guruStudentScope}`).all(session.user_id).map((row) => row.nisn));
  }
  return new Set([session.user_id]);
}

function maskPhone(value) {
  const phone = String(value || "");
  if (!phone) return "";
  if (phone.length <= 7) return "*".repeat(phone.length);
  return `${phone.slice(0, 4)}${"*".repeat(phone.length - 7)}${phone.slice(-3)}`;
}

function readReportLog() {
  const logPath = path.join(reportDirectory, "laporan-log.jsonl");
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function listReportsFor(session) {
  const visible = visibleNisns(session);
  const names = new Map(database.prepare("SELECT nisn, name FROM students").all().map((row) => [row.nisn, row.name]));
  const reviews = new Map(database.prepare(
    "SELECT filename, status, note, reviewer_id AS reviewerId, reviewed_at AS reviewedAt FROM report_reviews",
  ).all().map((row) => [row.filename, row]));
  return readReportLog()
    .filter((report) => !visible || visible.has(report.userId))
    .map((report) => ({ ...report, studentName: names.get(report.userId) || "", review: reviews.get(report.filename) || null }))
    .reverse();
}

function cleanupExpiredData() {
  const now = new Date();
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
  database.prepare("DELETE FROM audit_logs WHERE created_at < ?").run(
    new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString(),
  );
  const photoCutoff = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const oldPhotos = database.prepare("SELECT id, filename FROM attendance_records WHERE received_at < ?").all(photoCutoff);
  for (const record of oldPhotos) {
    fs.rmSync(path.join(imageDirectory, record.filename), { force: true });
    database.prepare("DELETE FROM attendance_records WHERE id = ?").run(record.id);
  }
  const reportLogPath = path.join(reportDirectory, "laporan-log.jsonl");
  if (fs.existsSync(reportLogPath)) {
    const reportCutoff = new Date(now.getFullYear() - 1, 6, 1);
    const retainedReports = fs.readFileSync(reportLogPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter((report) => report && (!report.createdAt || new Date(report.createdAt) >= reportCutoff));
    fs.writeFileSync(reportLogPath, retainedReports.map((report) => JSON.stringify(report)).join("\n") + (retainedReports.length ? "\n" : ""));
  }
  database.prepare(`
    DELETE FROM pkl_locations
    WHERE created_at < ?
      AND id NOT IN (SELECT pkl_location_id FROM students WHERE pkl_location_id IS NOT NULL)
  `).run(new Date(now.getFullYear() - 3, now.getMonth(), now.getDate()).toISOString());
}

async function reverseGeocode(latitude, longitude) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Demo-Sistem-Presensi-PKL/1.0",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`Reverse geocoding failed with HTTP ${response.status}`);
    }
    const result = await response.json();
    return typeof result.display_name === "string" ? result.display_name : null;
  } catch (error) {
    console.warn("Alamat lokasi tidak dapat diperoleh:", error.message);
    return null;
  }
}

async function backfillLocationAddresses() {
  const records = database
    .prepare(`
      SELECT id, latitude, longitude
      FROM attendance_records
      WHERE location_address IS NULL
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      ORDER BY captured_at
      LIMIT 20
    `)
    .all();

  for (const record of records) {
    const address = await reverseGeocode(record.latitude, record.longitude);
    if (address) {
      database
        .prepare("UPDATE attendance_records SET location_address = ? WHERE id = ?")
        .run(address, record.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const text = content.replace(/^\uFEFF/, "");

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      if (field.length) throw new Error("Format CSV tidak valid.");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("Ada tanda kutip CSV yang belum ditutup.");
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(header) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function jakartaParts(value = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday,
  };
}

function distanceInMeters(latitude1, longitude1, latitude2, longitude2) {
  const radians = (value) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const deltaLatitude = radians(latitude2 - latitude1);
  const deltaLongitude = radians(longitude2 - longitude1);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(latitude1)) * Math.cos(radians(latitude2))
    * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isValidIndonesianPhone(value) {
  return value === "" || /^(?:\+62|62|08)\d{6,18}$/.test(value);
}

function hasValidReportSignature(extension, buffer) {
  if (extension === ".pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if (extension === ".doc") return buffer.subarray(0, 8).equals(Buffer.from("D0CF11E0A1B11AE1", "hex"));
  if (extension === ".docx") return buffer.subarray(0, 4).equals(Buffer.from("504B0304", "hex"));
  return false;
}

function safeReportName(name) {
  const base = path.basename(String(name || ""));
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function workingDaysElapsed(now = new Date()) {
  const jakarta = jakartaParts(now);
  const start = new Date(`${jakarta.date}T00:00:00+07:00`);
  let count = 0;
  for (let cursor = new Date(start); cursor <= now; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function renderIndex() {
  const template = fs.readFileSync(path.join(publicDirectory, "index.html"), "utf8");
  return template.replace(
    /    <!-- include:(views\/[^ ]+) -->/g,
    (_, partialPath) =>
      fs.readFileSync(path.join(publicDirectory, partialPath), "utf8"),
  );
}

function serveFile(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const servesImage = requestedPath.startsWith("/images/");
  const servesReport = requestedPath.startsWith("/reports/");
  const servesRuntimeFile = servesImage || servesReport;
  const baseDirectory = servesImage ? imageDirectory : servesReport ? reportDirectory : publicDirectory;
  const relativeRequest = servesImage
    ? requestedPath.slice("/images/".length)
    : servesReport
      ? requestedPath.slice("/reports/".length)
      : requestedPath.slice(1);
  const filePath = path.resolve(baseDirectory, relativeRequest);
  const relativePath = path.relative(baseDirectory, filePath);
  const blockedTraversal =
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    relativePath.split(path.sep).some((part) => part.startsWith("."));
  if (blockedTraversal) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  if (servesRuntimeFile) {
    const session = getSession(request);
    if (!session) {
      unauthorized(response);
      return;
    }
    if (session.mustChangePassword) {
      writeJson(response, 403, { ok: false, code: "must_change_password", message: "Ganti password sementara terlebih dahulu." });
      return;
    }
    const filename = path.basename(filePath);
    const extension = path.extname(filename).toLowerCase();
    const allowedExtensions = servesImage ? [".jpg", ".jpeg", ".png"] : [".pdf", ".doc", ".docx"];
    if (path.dirname(filePath) !== baseDirectory || !allowedExtensions.includes(extension)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const ownerId = servesImage
      ? database.prepare("SELECT user_id FROM attendance_records WHERE filename = ?").get(filename)?.user_id
      : readReportLog().find((report) => report.filename === filename)?.userId;
    if (!ownerId) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    if (!canAccessStudent(session, ownerId)) {
      forbidden(response);
      return;
    }
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  if (path.basename(filePath) === "index.html") {
    response.writeHead(200, { "Content-Type": mimeTypes[".html"] });
    response.end(renderIndex());
    return;
  }
  response.writeHead(200, {
    "Content-Type":
      mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    ...(servesRuntimeFile ? { "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } : {}),
  });
  fs.createReadStream(filePath).pipe(response);
}

function handleRequest(request, response) {
  const url = new URL(request.url || "/", "http://localhost");
  const startedAt = Date.now();
  const session = getSession(request);
  if (request.method === "GET" && url.pathname === "/healthz") {
    try {
      database.prepare("SELECT 1").get();
      writeJson(response, 200, { ok: true, status: "ok", uptimeSeconds: Math.round(process.uptime()) });
    } catch {
      writeJson(response, 503, { ok: false, status: "database_error" });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    try {
      database.prepare("SELECT 1").get();
      writeJson(response, 200, { ok: true, status: "healthy" });
    } catch {
      writeJson(response, 503, { ok: false, status: "unavailable" });
    }
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/images/") || url.pathname.startsWith("/reports/")) {
    response.on("finish", () => logEvent("info", "request", {
      method: request.method,
      path: url.pathname,
      status: response.statusCode,
      durationMs: Date.now() - startedAt,
      user: session?.user_id || null,
    }));
  }
  if (request.method === "POST" && url.pathname === "/api/login") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const id = String(payload.id || "").trim();
        const password = String(payload.password || "");
        const now = Date.now();
        const activeLockout = loginAttempts.getLockoutDuration(id, now);
        if (activeLockout !== null) {
          const minutes = Math.ceil(activeLockout / 60_000);
          throw new Error(`Terlalu banyak percobaan login. Coba lagi dalam ${minutes} menit.`);
        }
        const user = database.prepare("SELECT id, role, password_hash, must_change_password, is_active FROM users WHERE id = ?").get(id);
        if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
          audit(request, "login_failed", id || "unknown");
          const lockoutDuration = loginAttempts.recordFailure(id, now);
          if (lockoutDuration !== null) {
            const minutes = Math.ceil(lockoutDuration / 60_000);
            throw new Error(`Terlalu banyak percobaan login. Coba lagi dalam ${minutes} menit.`);
          }
          throw new Error("ID atau password tidak valid.");
        }
        loginAttempts.reset(id);
        const sessionId = crypto.randomBytes(32).toString("hex");
        const createdAt = new Date();
        database.prepare(
          "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        ).run(
          sessionId,
          user.id,
          new Date(createdAt.getTime() + 8 * 60 * 60 * 1000).toISOString(),
          createdAt.toISOString(),
        );
        audit(request, "login_success", user.id, null, null, user.id);
        const profile = getUserProfile(user.id);
        writeJson(response, 200, { ok: true, user: {
          id: user.id,
          role: user.role,
          mustChangePassword: Boolean(user.must_change_password),
          displayName: profile.displayName,
          contact: profile.contact,
        } }, {
          "Set-Cookie": `${sessionCookieName}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
        });
      } catch (error) {
        writeJson(response, 401, { ok: false, message: error.message });
      }
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/logout") {
    if (session) {
      audit(request, "logout", session.user_id, null, null, session.user_id);
      database.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    }
    writeJson(response, 200, { ok: true }, {
      "Set-Cookie": `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/session") {
    if (!session) return unauthorized(response);
    const profile = getUserProfile(session.user_id);
    writeJson(response, 200, { ok: true, user: {
      id: session.user_id,
      role: session.role,
      mustChangePassword: Boolean(session.mustChangePassword),
      displayName: profile.displayName,
      contact: profile.contact,
    } });
    return;
  }
  if (url.pathname.startsWith("/api/") && !session) {
    unauthorized(response);
    return;
  }
  if (url.pathname.startsWith("/api/") && session.mustChangePassword && url.pathname !== "/api/password") {
    writeJson(response, 403, {
      ok: false,
      code: "must_change_password",
      message: "Ganti password sementara terlebih dahulu.",
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/location-address") {
    const latitude = Number(url.searchParams.get("lat"));
    const longitude = Number(url.searchParams.get("lon"));
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      writeJson(response, 400, { ok: false, message: "Koordinat lokasi tidak valid." });
      return;
    }
    reverseGeocode(latitude, longitude).then((address) => {
      writeJson(response, 200, { address });
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/password") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const password = String(payload.password || "");
        if (password.length < 12) throw new Error("Password minimal 12 karakter.");
        database.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?")
          .run(hashPassword(password), session.user_id);
        database.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(session.user_id, session.id);
        audit(request, "password_changed", session.user_id, null, null, session.user_id);
        writeJson(response, 200, { ok: true });
      } catch (error) {
        writeJson(response, 400, { ok: false, message: error.message });
      }
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/config") {
    writeJson(response, 200, {
      helpContact: {
        name: String(process.env.HELP_CONTACT_NAME || "").trim(),
        email: String(process.env.HELP_CONTACT_EMAIL || "").trim(),
        phone: String(process.env.HELP_CONTACT_PHONE || "").trim(),
        note: String(process.env.HELP_CONTACT_NOTE || "").trim(),
      },
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/users") {
    if (!hasRole(session, ["admin"])) return forbidden(response);
    const users = database.prepare(`
      SELECT users.id, users.role, users.is_active AS active, users.must_change_password AS mustChangePassword,
        users.created_at AS createdAt,
        COALESCE(NULLIF(user_profiles.display_name, ''), students.name, '') AS displayName
      FROM users
      LEFT JOIN user_profiles ON user_profiles.user_id = users.id
      LEFT JOIN students ON students.nisn = users.id
      ORDER BY users.role, users.id
    `).all().map((user) => ({
      ...user,
      active: Boolean(user.active),
      mustChangePassword: Boolean(user.mustChangePassword),
    }));
    writeJson(response, 200, users);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/users") {
    if (!hasRole(session, ["guru", "admin"])) return forbidden(response);
    withJsonBody(request, response, (payload) => {
      const id = String(payload.id || "").trim();
      const role = String(payload.role || "").trim();
      const password = String(payload.password || "");
      if (!/^[A-Za-z0-9._-]{3,64}$/.test(id)) {
        throw new Error("ID hanya boleh huruf, angka, titik, garis bawah, atau tanda hubung (3-64 karakter).");
      }
      if (!["siswa", "guru", "admin"].includes(role)) throw new Error("Role tidak valid.");
      if (session.role === "guru" && role !== "siswa") {
        const error = new Error("Guru hanya dapat membuat akun siswa.");
        error.status = 403;
        throw error;
      }
      if (password.length < 12) throw new Error("Password sementara minimal 12 karakter.");
      if (role === "siswa") {
        if (!database.prepare("SELECT nisn FROM students WHERE nisn = ?").get(id)) {
          throw new Error("NISN belum terdaftar di master siswa.");
        }
        if (!canAccessStudent(session, id)) {
          const error = new Error("Siswa ini bukan bagian dari kelas Anda.");
          error.status = 403;
          throw error;
        }
      }
      if (database.prepare("SELECT id FROM users WHERE id = ?").get(id)) throw new Error("ID sudah terdaftar.");
      database.prepare(
        "INSERT INTO users (id, role, password_hash, must_change_password, created_at) VALUES (?, ?, ?, 1, ?)",
      ).run(id, role, hashPassword(password), new Date().toISOString());
      audit(request, "user_created", id, null, { role }, session.user_id);
      writeJson(response, 201, { ok: true, user: { id, role } });
    });
    return;
  }
  const userAction = /^\/api\/users\/([^/]+)\/(reset-password|active)$/.exec(url.pathname);
  if (request.method === "POST" && userAction) {
    if (!hasRole(session, ["admin"])) return forbidden(response);
    let targetId;
    try {
      targetId = decodeURIComponent(userAction[1]);
    } catch {
      return writeJson(response, 400, { ok: false, message: "ID akun tidak valid." });
    }
    withJsonBody(request, response, (payload) => {
      const target = database.prepare("SELECT id, role, is_active AS active FROM users WHERE id = ?").get(targetId);
      if (!target) {
        const error = new Error("Akun tidak ditemukan.");
        error.status = 404;
        throw error;
      }
      if (userAction[2] === "reset-password") {
        const password = String(payload.password || "");
        if (password.length < 12) throw new Error("Password sementara minimal 12 karakter.");
        database.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?")
          .run(hashPassword(password), target.id);
        database.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
        audit(request, "password_reset", target.id, null, null, session.user_id);
        writeJson(response, 200, { ok: true });
        return;
      }
      if (typeof payload.active !== "boolean") throw new Error("Status aktif tidak valid.");
      const active = payload.active;
      if (target.id === session.user_id && !active) throw new Error("Anda tidak dapat menonaktifkan akun sendiri.");
      if (!active && target.role === "admin" && target.active) {
        const otherAdmins = database.prepare(
          "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?",
        ).get(target.id).count;
        if (!otherAdmins) throw new Error("Harus ada minimal satu admin aktif.");
      }
      database.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(active ? 1 : 0, target.id);
      if (!active) database.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
      audit(request, active ? "user_activated" : "user_deactivated", target.id, { active: !active }, { active }, session.user_id);
      writeJson(response, 200, { ok: true, active });
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/teachers") {
    if (!hasRole(session, ["admin"])) return forbidden(response);
    const teachers = database.prepare(`
      SELECT teachers.nip, teachers.name, teachers.phone,
        users.id AS accountId, users.is_active AS isActive,
        COUNT(DISTINCT visible.student_nisn) AS assignedStudentCount
      FROM teachers
      LEFT JOIN users ON users.id = teachers.nip AND users.role = 'guru'
      LEFT JOIN teacher_visible_students AS visible ON visible.teacher_id = users.id
      GROUP BY teachers.nip
      ORDER BY teachers.name
    `).all().map((teacher) => ({
      ...teacher,
      isActive: teacher.accountId ? Boolean(teacher.isActive) : false,
      assignedStudentCount: Number(teacher.assignedStudentCount),
    }));
    writeJson(response, 200, teachers);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/teacher-assignments") {
    if (!hasRole(session, ["admin"])) return forbidden(response);
    const assignments = database.prepare(`
      SELECT assignments.student_nisn AS studentNisn,
        assignments.teacher_id AS teacherId, students.name AS studentName
      FROM teacher_student_assignments AS assignments
      JOIN students ON students.nisn = assignments.student_nisn
      ORDER BY students.name
    `).all();
    writeJson(response, 200, assignments);
    return;
  }
  if (request.method === "PUT" && url.pathname === "/api/teacher-assignments") {
    if (!hasRole(session, ["admin"])) return forbidden(response);
    withJsonBody(request, response, (payload) => {
      const studentNisn = String(payload.studentNisn || "").trim();
      const teacherId = String(payload.teacherId || "").trim();
      if (!/^\d{10}$/.test(studentNisn) ||
          !database.prepare("SELECT 1 FROM students WHERE nisn = ?").get(studentNisn)) {
        throw new Error("NISN siswa tidak terdaftar di master.");
      }
      const before = database.prepare(
        "SELECT teacher_id AS teacherId FROM teacher_student_assignments WHERE student_nisn = ?",
      ).get(studentNisn) || null;
      if (!teacherId) {
        database.prepare("DELETE FROM teacher_student_assignments WHERE student_nisn = ?").run(studentNisn);
      } else {
        const teacher = database.prepare(
          "SELECT id FROM users WHERE id = ? AND role = 'guru' AND is_active = 1",
        ).get(teacherId);
        if (!teacher) throw new Error("Pilih akun guru aktif.");
        database.prepare(`
          INSERT INTO teacher_student_assignments (student_nisn, teacher_id, assigned_at)
          VALUES (?, ?, ?)
          ON CONFLICT(student_nisn) DO UPDATE SET
            teacher_id = excluded.teacher_id, assigned_at = excluded.assigned_at
        `).run(studentNisn, teacherId, new Date().toISOString());
      }
      audit(request, "teacher_student_assignment_changed", studentNisn, before, { teacherId: teacherId || null }, session.user_id);
      writeJson(response, 200, { ok: true, studentNisn, teacherId: teacherId || null });
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/sessions") {
    if (!hasRole(session, ["admin"])) return forbidden(response);
    const sessions = database.prepare(`
      SELECT users.id AS userId, users.role, sessions.created_at AS createdAt,
        sessions.expires_at AS expiresAt
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.expires_at > ? AND users.is_active = 1
      ORDER BY sessions.created_at DESC
    `).all(new Date().toISOString());
    writeJson(response, 200, sessions);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/audit-logs") {
    if (!hasRole(session, ["admin"])) return forbidden(response);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
    const action = String(url.searchParams.get("action") || "").trim();
    const before = Number(url.searchParams.get("before")) || null;
    const clauses = [];
    const params = [];
    if (action) { clauses.push("action = ?"); params.push(action); }
    if (before) { clauses.push("id < ?"); params.push(before); }
    const logs = database.prepare(`
      SELECT id, actor_id AS actorId, action, target, after_value AS detail, ip_address AS ip, created_at AS createdAt
      FROM audit_logs ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY id DESC LIMIT ?
    `).all(...params, limit).map((row) => ({ ...row, detail: row.detail ? row.detail.slice(0, 300) : null }));
    const actions = database.prepare("SELECT DISTINCT action FROM audit_logs ORDER BY action").all().map((row) => row.action);
    writeJson(response, 200, { logs, actions });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/classes") {
    if (!hasRole(session, ["admin", "guru"])) return forbidden(response);
    const rows = database.prepare(`
      SELECT classes.id, classes.name,
        (SELECT COUNT(*) FROM students WHERE students.class_id = classes.id) AS studentCount
      FROM classes
      ${session.role === "guru" ? "WHERE classes.id IN (SELECT class_id FROM teacher_classes WHERE teacher_id = ?)" : ""}
      ORDER BY classes.name
    `).all(...(session.role === "guru" ? [session.user_id] : []));
    const teachers = database.prepare(`
      SELECT teacher_classes.class_id AS classId, users.id,
        COALESCE(NULLIF(user_profiles.display_name, ''), users.id) AS displayName
      FROM teacher_classes
      JOIN users ON users.id = teacher_classes.teacher_id
      LEFT JOIN user_profiles ON user_profiles.user_id = users.id
      ORDER BY displayName
    `).all();
    writeJson(response, 200, rows.map((item) => ({
      ...item,
      teachers: teachers.filter((teacher) => teacher.classId === item.id).map(({ id, displayName }) => ({ id, displayName })),
    })));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/classes") {
    if (!hasRole(session, ["admin"])) return forbidden(response);
    withJsonBody(request, response, (payload) => {
      const name = String(payload.name || "").trim();
      if (name.length < 1 || name.length > 40) throw new Error("Nama kelas 1-40 karakter.");
      if (database.prepare("SELECT id FROM classes WHERE name = ? COLLATE NOCASE").get(name)) throw new Error("Nama kelas sudah ada.");
      const result = database.prepare("INSERT INTO classes (name, created_at) VALUES (?, ?)").run(name, new Date().toISOString());
      audit(request, "class_created", String(result.lastInsertRowid), null, { name }, session.user_id);
      writeJson(response, 201, { ok: true, class: { id: Number(result.lastInsertRowid), name } });
    });
    return;
  }
  const classTeacher = /^\/api\/classes\/(\d+)\/teachers(?:\/([^/]+))?$/.exec(url.pathname);
  if (classTeacher && (request.method === "POST" || request.method === "DELETE")) {
    if (!hasRole(session, ["admin"])) return forbidden(response);
    const classId = Number(classTeacher[1]);
    if (!database.prepare("SELECT id FROM classes WHERE id = ?").get(classId)) {
      return writeJson(response, 404, { ok: false, message: "Kelas tidak ditemukan." });
    }
    if (request.method === "DELETE") {
      let teacherId;
      try {
        teacherId = decodeURIComponent(classTeacher[2] || "");
      } catch {
        return writeJson(response, 400, { ok: false, message: "ID guru tidak valid." });
      }
      const result = database.prepare("DELETE FROM teacher_classes WHERE class_id = ? AND teacher_id = ?").run(classId, teacherId);
      if (!result.changes) return writeJson(response, 404, { ok: false, message: "Penugasan tidak ditemukan." });
      audit(request, "class_teacher_removed", String(classId), { teacherId }, null, session.user_id);
      return writeJson(response, 200, { ok: true });
    }
    withJsonBody(request, response, (payload) => {
      const teacherId = String(payload.teacherId || "").trim();
      const teacher = database.prepare("SELECT id FROM users WHERE id = ? AND role = 'guru' AND is_active = 1").get(teacherId);
      if (!teacher) throw new Error("Pilih akun guru yang aktif.");
      if (database.prepare("SELECT 1 FROM teacher_classes WHERE class_id = ? AND teacher_id = ?").get(classId, teacherId)) {
        throw new Error("Guru sudah ditugaskan pada kelas ini.");
      }
      database.prepare("INSERT INTO teacher_classes (teacher_id, class_id) VALUES (?, ?)").run(teacherId, classId);
      audit(request, "class_teacher_assigned", String(classId), null, { teacherId }, session.user_id);
      writeJson(response, 201, { ok: true });
    });
    return;
  }
  const reviewMatch = /^\/api\/reports\/([A-Za-z0-9._-]+)\/review$/.exec(url.pathname);
  if (request.method === "POST" && reviewMatch) {
    if (!hasRole(session, ["guru"])) return forbidden(response);
    withJsonBody(request, response, (payload) => {
      const filename = reviewMatch[1];
      const report = readReportLog().find((item) => item.filename === filename);
      if (!report) {
        const error = new Error("Laporan tidak ditemukan.");
        error.status = 404;
        throw error;
      }
      if (!canAccessStudent(session, report.userId)) {
        const error = new Error("Laporan ini bukan dari siswa di kelas Anda.");
        error.status = 403;
        throw error;
      }
      const status = String(payload.status || "");
      const note = String(payload.note || "").trim();
      if (!["valid", "perlu_revisi"].includes(status)) throw new Error("Status validasi tidak valid.");
      if (note.length > 300) throw new Error("Catatan maksimal 300 karakter.");
      const reviewedAt = new Date().toISOString();
      database.prepare(`
        INSERT INTO report_reviews (filename, status, note, reviewer_id, reviewed_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(filename) DO UPDATE SET
          status = excluded.status, note = excluded.note,
          reviewer_id = excluded.reviewer_id, reviewed_at = excluded.reviewed_at
      `).run(filename, status, note, session.user_id, reviewedAt);
      audit(request, "report_reviewed", filename, null, { status, note }, session.user_id);
      writeJson(response, 200, { ok: true, review: { status, note, reviewerId: session.user_id, reviewedAt } });
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/profile") {
    const profile = database.prepare(
      "SELECT display_name AS displayName, contact FROM user_profiles WHERE user_id = ?",
    ).get(session.user_id) || { displayName: "", contact: "" };
    writeJson(response, 200, profile);
    return;
  }
  if (request.method === "PUT" && url.pathname === "/api/profile") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const displayName = String(payload.displayName || "").trim();
        const contact = String(payload.contact || "").trim();
        if (displayName.length > 80 || contact.length > 80) throw new Error("Profil terlalu panjang.");
        database.prepare(`
          INSERT INTO user_profiles (user_id, display_name, contact, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            display_name = excluded.display_name,
            contact = excluded.contact,
            updated_at = excluded.updated_at
        `).run(session.user_id, displayName, contact, new Date().toISOString());
        audit(request, "profile_updated", session.user_id, null, { displayName, contact }, session.user_id);
        writeJson(response, 200, { ok: true, displayName, contact });
      } catch (error) {
        writeJson(response, 400, { ok: false, message: error.message });
      }
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/notifications") {
    if (!hasRole(session, ["guru", "admin"])) return forbidden(response);
    const names = new Map(database.prepare("SELECT nisn, name FROM students").all().map((row) => [row.nisn, row.name]));
    const scope = attendanceScope(session);
    const attendance = database.prepare(`
      SELECT filename, user_id AS userId, status, attendance_type AS attendanceType, received_at AS date
      FROM attendance_records WHERE role = 'siswa' AND ${scope.clause} ORDER BY received_at DESC
    `).all(...scope.params);
    const notifications = [
      ...attendance.map((record) => ({
        id: `attendance:${record.filename}`,
        category: "Presensi siswa",
        title: `Presensi ${record.attendanceType === "pulang" ? "pulang" : "masuk"} tercatat`,
        detail: `${names.get(record.userId) || record.userId} · ${record.status}`,
        date: record.date,
        target: "rekap",
      })),
      ...listReportsFor(session).map((report) => ({
        id: `report:${report.filename}`,
        category: "Laporan PKL",
        title: "Laporan PKL baru diunggah",
        detail: `${report.studentName || report.userId} · ${report.originalName || report.filename}`,
        date: report.createdAt,
        target: "laporan",
      })),
    ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const readIds = database.prepare(
      "SELECT notification_id AS id FROM notification_reads WHERE user_id = ?",
    ).all(session.user_id).map((item) => item.id);
    writeJson(response, 200, { notifications, readIds });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/notifications/read") {
    if (!hasRole(session, ["guru", "admin"])) return forbidden(response);
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const ids = Array.isArray(payload.ids) ? payload.ids.filter((id) => typeof id === "string").slice(0, 1000) : [];
        const statement = database.prepare(`
          INSERT INTO notification_reads (user_id, notification_id, read_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, notification_id) DO UPDATE SET read_at = excluded.read_at
        `);
        const now = new Date().toISOString();
        database.exec("BEGIN");
        try {
          ids.forEach((id) => statement.run(session.user_id, id, now));
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        writeJson(response, 200, { ok: true, count: ids.length });
      } catch (error) {
        writeJson(response, 400, { ok: false, message: error.message });
      }
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/students") {
    if (!hasRole(session, ["guru", "admin"])) return forbidden(response);
    const students = database
      .prepare(
        `SELECT students.nisn, students.name,
          students.parent_phone AS parentPhone,
          classes.id AS classId,
          classes.name AS className,
          locations.id AS pklLocationId,
          locations.company_name AS pklCompanyName,
          locations.address AS pklAddress
         FROM students
         LEFT JOIN classes ON classes.id = students.class_id
         LEFT JOIN pkl_locations AS locations
           ON locations.id = students.pkl_location_id
         WHERE ${session.role === "admin" ? "1 = 1" : guruStudentScope}
         ORDER BY students.name`,
      )
      .all(...(session.role === "admin" ? [] : [session.user_id]))
      .map(({ parentPhone, ...student }) => ({ ...student, parentPhoneMasked: maskPhone(parentPhone) }));
    writeJson(response, 200, students);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/pkl-locations") {
    const locations = database
      .prepare("SELECT id, company_name AS companyName, address, latitude, longitude FROM pkl_locations ORDER BY company_name")
      .all();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(locations));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/pkl-locations") {
    if (!hasRole(session, ["guru", "admin"])) return forbidden(response);
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const companyName = String(payload.companyName || "").trim();
        const address = String(payload.address || "").trim();
        const latitude = payload.latitude === undefined || payload.latitude === null || payload.latitude === "" ? null : Number(payload.latitude);
        const longitude = payload.longitude === undefined || payload.longitude === null || payload.longitude === "" ? null : Number(payload.longitude);
        if (!companyName || companyName.length < 2 || companyName.length > 120 || !address || address.length < 5 || address.length > 500 ||
            (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
            (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) ||
            ((latitude === null) !== (longitude === null))) {
          throw new Error("Nama PT 2-120 karakter, alamat 5-500 karakter, dan koordinat harus valid.");
        }
        const existing = database
          .prepare("SELECT id FROM pkl_locations WHERE company_name = ? AND address = ?")
          .get(companyName, address);
        if (existing) throw new Error("Tempat PKL tersebut sudah terdaftar.");
        const result = database
          .prepare("INSERT INTO pkl_locations (company_name, address, latitude, longitude, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(companyName, address, latitude, longitude, new Date().toISOString());
        const location = { id: Number(result.lastInsertRowid), companyName, address };
        audit(request, "location_created", String(location.id), null, location, session.user_id);
        response.writeHead(201, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          ok: true,
          location,
        }));
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, message: error.message }));
      }
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/pkl-location-requests") {
    if (!hasRole(session, ["siswa"])) return forbidden(response);
    withJsonBody(request, response, (payload) => {
      const companyName = String(payload.companyName || "").trim();
      const address = String(payload.address || "").trim();
      if (companyName.length < 2 || companyName.length > 120 || address.length < 5 || address.length > 500) {
        throw new Error("Nama PT 2-120 karakter dan alamat 5-500 karakter wajib diisi.");
      }
      if (!database.prepare("SELECT nisn FROM students WHERE nisn = ?").get(session.user_id)) {
        throw new Error("NISN belum terdaftar di master siswa.");
      }
      if (database.prepare("SELECT id FROM pkl_locations WHERE company_name = ? AND address = ?").get(companyName, address)) {
        throw new Error("Tempat PKL tersebut sudah tersedia. Pilih dari daftar lokasi.");
      }
      if (database.prepare(
        "SELECT id FROM pkl_location_requests WHERE student_nisn = ? AND company_name = ? AND address = ? AND status = 'pending'",
      ).get(session.user_id, companyName, address)) {
        throw new Error("Usulan yang sama masih menunggu persetujuan.");
      }
      const result = database.prepare(`
        INSERT INTO pkl_location_requests (student_nisn, company_name, address, created_at)
        VALUES (?, ?, ?, ?)
      `).run(session.user_id, companyName, address, new Date().toISOString());
      audit(request, "location_requested", session.user_id, null, { companyName, address }, session.user_id);
      writeJson(response, 202, {
        ok: true,
        request: { id: Number(result.lastInsertRowid), companyName, address, status: "pending" },
        message: "Usulan lokasi dikirim untuk persetujuan guru/admin.",
      });
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/pkl-location-requests") {
    const scope = session.role === "admin"
      ? { clause: "1 = 1", params: [] }
      : session.role === "guru"
        ? { clause: `r.student_nisn IN (SELECT nisn FROM students WHERE ${guruStudentScope})`, params: [session.user_id] }
        : { clause: "r.student_nisn = ?", params: [session.user_id] };
    const requests = database.prepare(`
      SELECT r.id, r.student_nisn AS studentNisn, students.name AS studentName,
        r.company_name AS companyName, r.address, r.status, r.created_at AS createdAt
      FROM pkl_location_requests AS r
      JOIN students ON students.nisn = r.student_nisn
      WHERE ${scope.clause}
      ORDER BY r.created_at DESC
    `).all(...scope.params);
    writeJson(response, 200, requests);
    return;
  }
  const requestDecision = /^\/api\/pkl-location-requests\/(\d+)\/(approve|reject)$/.exec(url.pathname);
  if (request.method === "POST" && requestDecision) {
    if (!hasRole(session, ["guru", "admin"])) return forbidden(response);
    withJsonBody(request, response, () => {
      const item = database.prepare("SELECT * FROM pkl_location_requests WHERE id = ?").get(Number(requestDecision[1]));
      if (!item) {
        const error = new Error("Usulan tidak ditemukan.");
        error.status = 404;
        throw error;
      }
      if (!canAccessStudent(session, item.student_nisn)) {
        const error = new Error("Usulan ini bukan dari siswa di kelas Anda.");
        error.status = 403;
        throw error;
      }
      if (item.status !== "pending") {
        const error = new Error("Usulan sudah diproses.");
        error.status = 409;
        throw error;
      }
      if (requestDecision[2] === "reject") {
        database.prepare("UPDATE pkl_location_requests SET status = 'rejected' WHERE id = ?").run(item.id);
        audit(request, "location_request_rejected", String(item.id), null, { companyName: item.company_name }, session.user_id);
        writeJson(response, 200, { ok: true, status: "rejected" });
        return;
      }
      let locationId;
      database.exec("BEGIN");
      try {
        const existing = database.prepare("SELECT id FROM pkl_locations WHERE company_name = ? AND address = ?")
          .get(item.company_name, item.address);
        locationId = existing
          ? existing.id
          : Number(database.prepare(
            "INSERT INTO pkl_locations (company_name, address, created_at) VALUES (?, ?, ?)",
          ).run(item.company_name, item.address, new Date().toISOString()).lastInsertRowid);
        database.prepare("UPDATE pkl_location_requests SET status = 'approved' WHERE id = ?").run(item.id);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      audit(request, "location_request_approved", String(item.id), null, { locationId, companyName: item.company_name }, session.user_id);
      writeJson(response, 200, { ok: true, status: "approved", locationId });
    });
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/api/students/") && !url.pathname.endsWith("/location") && !url.pathname.endsWith("/class") && url.pathname !== "/api/students/import") {
    let nisn;
    try {
      nisn = decodeURIComponent(url.pathname.slice("/api/students/".length));
    } catch {
      return writeJson(response, 400, { ok: false, message: "NISN tidak valid." });
    }
    if (!canAccessStudent(session, nisn)) return forbidden(response);
    const student = database
      .prepare(`
        SELECT students.nisn, students.name,
          classes.id AS classId,
          classes.name AS className,
          locations.id AS pklLocationId,
          locations.company_name AS pklCompanyName,
          locations.address AS pklAddress,
          locations.latitude AS pklLatitude,
          locations.longitude AS pklLongitude
        FROM students
        LEFT JOIN classes ON classes.id = students.class_id
        LEFT JOIN pkl_locations AS locations
          ON locations.id = students.pkl_location_id
        WHERE students.nisn = ?
      `)
      .get(nisn);
    writeJson(response, student ? 200 : 404, student || { message: "NISN belum terdaftar." });
    return;
  }
  if (request.method === "PUT" && url.pathname.startsWith("/api/students/") && url.pathname.endsWith("/class")) {
    if (!hasRole(session, ["admin"])) return forbidden(response);
    let nisn;
    try {
      nisn = decodeURIComponent(url.pathname.slice("/api/students/".length, -"/class".length));
    } catch {
      return writeJson(response, 400, { ok: false, message: "NISN tidak valid." });
    }
    withJsonBody(request, response, (payload) => {
      const classId = payload.classId === null || payload.classId === "" ? null : Number(payload.classId);
      if (classId !== null && !database.prepare("SELECT id FROM classes WHERE id = ?").get(classId)) {
        throw new Error("Kelas tidak ditemukan.");
      }
      const result = database.prepare("UPDATE students SET class_id = ? WHERE nisn = ?").run(classId, nisn);
      if (!result.changes) throw new Error("NISN belum terdaftar.");
      audit(request, "student_class_changed", nisn, null, { classId }, session.user_id);
      writeJson(response, 200, { ok: true });
    });
    return;
  }
  if (request.method === "PUT" && url.pathname.startsWith("/api/students/") && url.pathname.endsWith("/location")) {
    let nisn;
    try {
      nisn = decodeURIComponent(url.pathname.slice("/api/students/".length, -"/location".length));
    } catch {
      return writeJson(response, 400, { ok: false, message: "NISN tidak valid." });
    }
    if (!canAccessStudent(session, nisn)) return forbidden(response);
    withJsonBody(request, response, (payload) => {
      const locationId = Number(payload.locationId);
      const locationExists = database.prepare("SELECT id FROM pkl_locations WHERE id = ?").get(locationId);
      if (!locationExists) throw new Error("Pilih lokasi PKL yang tersedia.");
      const result = database
        .prepare("UPDATE students SET pkl_location_id = ? WHERE nisn = ?")
        .run(locationId, nisn);
      if (!result.changes) throw new Error("NISN belum terdaftar.");
      audit(request, "student_location_changed", nisn, null, { locationId }, session.user_id);
      writeJson(response, 200, { ok: true });
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/students/import") {
    if (!hasRole(session, ["guru", "admin"])) return forbidden(response);
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const rows = parseCsv(body);
        if (rows.length < 2) throw new Error("CSV belum berisi data siswa.");
        const headers = rows[0].map(normalizeHeader);
        if (new Set(headers).size !== headers.length) {
          throw new Error("Header CSV tidak boleh duplikat.");
        }
        const nameIndex = headers.findIndex((header) =>
          ["namasiswa", "nama"].includes(header),
        );
        const nisnIndex = headers.indexOf("nisn");
        const classIndex = headers.indexOf("kelas");
        const phoneIndex = headers.findIndex((header) =>
          ["nohporangtua", "nohportangtua", "nomorhportangtua", "nohportu"].includes(header),
        );
        if (nameIndex < 0 || nisnIndex < 0) {
          throw new Error("CSV wajib memiliki kolom Nama Siswa dan NISN.");
        }

        const seenNisn = new Set();
        const students = rows.slice(1).map((values, index) => {
          if (values.length > headers.length) {
            throw new Error(`Jumlah kolom tidak sesuai pada baris ${index + 2}.`);
          }
          const name = (values[nameIndex] || "").trim();
          const nisn = (values[nisnIndex] || "").trim();
          const parentPhone = phoneIndex < 0 ? "" : (values[phoneIndex] || "").trim().replace(/[\s()-]/g, "");
          if (name.length < 2 || name.length > 120) throw new Error(`Nama siswa pada baris ${index + 2} harus 2-120 karakter.`);
          if (!/^\d{10}$/.test(nisn)) {
            throw new Error(`NISN pada baris ${index + 2} harus terdiri dari 10 angka.`);
          }
          if (!isValidIndonesianPhone(parentPhone)) {
            throw new Error(`Nomor HP orang tua pada baris ${index + 2} tidak valid.`);
          }
          if (seenNisn.has(nisn)) {
            throw new Error(`NISN ${nisn} tercantum lebih dari sekali di CSV.`);
          }
          seenNisn.add(nisn);
          const className = classIndex < 0 ? "" : (values[classIndex] || "").trim();
          if (className.length > 40) throw new Error(`Nama kelas pada baris ${index + 2} maksimal 40 karakter.`);
          return { name, nisn, parentPhone, className, row: index + 2 };
        });

        const ownClasses = session.role === "guru"
          ? database.prepare(
            "SELECT classes.id, classes.name FROM classes JOIN teacher_classes ON teacher_classes.class_id = classes.id WHERE teacher_classes.teacher_id = ?",
          ).all(session.user_id)
          : [];
        const insertStudent = database.prepare(`
          INSERT INTO students (nisn, name, parent_phone, class_id)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(nisn) DO UPDATE SET
            name = excluded.name,
            parent_phone = CASE WHEN excluded.parent_phone <> '' THEN excluded.parent_phone ELSE students.parent_phone END,
            class_id = COALESCE(excluded.class_id, students.class_id)
        `);
        const assignImportedStudent = database.prepare(`
          INSERT INTO teacher_student_assignments (student_nisn, teacher_id, assigned_at)
          VALUES (?, ?, ?)
          ON CONFLICT(student_nisn) DO NOTHING
        `);
        const insertStudentAccount = database.prepare(`
          INSERT OR IGNORE INTO users (id, role, password_hash, must_change_password, created_at)
          VALUES (?, 'siswa', ?, 1, ?)
        `);
        let accountsCreated = 0;
        let studentsCreated = 0;
        let studentsUpdated = 0;
        database.exec("BEGIN");
        try {
          for (const student of students) {
            let classId = null;
            if (session.role === "guru") {
              if (student.className) {
                const match = ownClasses.find((item) => item.name.toLowerCase() === student.className.toLowerCase());
                if (!match) throw new Error(`Kelas "${student.className}" pada baris ${student.row} bukan kelas yang Anda ampu.`);
                classId = match.id;
              } else if (ownClasses.length === 1) {
                classId = ownClasses[0].id;
              } else if (ownClasses.length > 1) {
                throw new Error(`Kolom Kelas wajib diisi pada baris ${student.row} karena Anda memegang ${ownClasses.length} kelas.`);
              }
              // Guru tanpa kelas tetap dapat mengimpor: siswanya ditugaskan langsung kepadanya (lihat di bawah).
              const existing = database.prepare("SELECT class_id FROM students WHERE nisn = ?").get(student.nisn);
              const existingAssignment = database.prepare(
                "SELECT teacher_id FROM teacher_student_assignments WHERE student_nisn = ?",
              ).get(student.nisn);
              const inOwnClass = existing && existing.class_id !== null && ownClasses.some((item) => item.id === existing.class_id);
              const assignedToMe = existingAssignment && existingAssignment.teacher_id === session.user_id;
              const heldByOthers = existing && (existing.class_id !== null || existingAssignment);
              if (heldByOthers && !inOwnClass && !assignedToMe) {
                throw new Error(`NISN ${student.nisn} pada baris ${student.row} sudah terdaftar pada pembimbing atau kelas lain.`);
              }
            } else if (student.className) {
              const existingClass = database.prepare("SELECT id FROM classes WHERE name = ? COLLATE NOCASE").get(student.className);
              classId = existingClass
                ? existingClass.id
                : Number(database.prepare("INSERT INTO classes (name, created_at) VALUES (?, ?)")
                  .run(student.className, new Date().toISOString()).lastInsertRowid);
            }
            const alreadyExists = Boolean(database.prepare("SELECT 1 FROM students WHERE nisn = ?").get(student.nisn));
            insertStudent.run(student.nisn, student.name, student.parentPhone, classId);
            if (alreadyExists) studentsUpdated += 1; else studentsCreated += 1;
            if (!database.prepare("SELECT 1 FROM users WHERE id = ?").get(student.nisn)) {
              accountsCreated += insertStudentAccount.run(
                student.nisn,
                hashPassword(student.nisn),
                new Date().toISOString(),
              ).changes;
            }
            if (session.role === "guru" && !ownClasses.length) {
              assignImportedStudent.run(student.nisn, session.user_id, new Date().toISOString());
            }
          }
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        audit(request, "students_imported", String(students.length), null, { count: students.length }, session.user_id);

        const total = session.role === "admin"
          ? database.prepare("SELECT COUNT(*) AS count FROM students").get().count
          : database.prepare(`SELECT COUNT(*) AS count FROM students WHERE ${guruStudentScope}`).get(session.user_id).count;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          ok: true,
          imported: students.length,
          created: studentsCreated,
          updated: studentsUpdated,
          accountsCreated,
          total,
          }));
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, message: error.message }));
      }
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/attendance-records") {
    const scope = attendanceScope(session);
    const records = database
      .prepare(`
        SELECT attendance_records.*, students.name AS student_name, classes.name AS class_name
        FROM attendance_records
        LEFT JOIN students ON students.nisn = attendance_records.user_id
        LEFT JOIN classes ON classes.id = students.class_id
        WHERE ${scope.clause.replace(/^user_id/, "attendance_records.user_id")}
        ORDER BY captured_at DESC
      `)
      .all(...scope.params)
      .map((record) => ({
        filename: record.filename,
        userId: record.user_id,
        studentName: record.student_name || "",
        className: record.class_name || "",
        role: record.role,
        status: record.status,
        attendanceType: record.attendance_type,
        outsideRadius: Boolean(record.outside_radius),
        capturedAt: record.captured_at,
        receivedAt: record.received_at,
        location:
          record.latitude === null || record.longitude === null
            ? null
            : {
                latitude: record.latitude,
                longitude: record.longitude,
                accuracy: record.accuracy,
                address: record.location_address,
              },
        image: {
          width: record.image_width,
          height: record.image_height,
          sizeBytes: record.image_size_bytes,
          type: record.image_type,
        },
        userAgent: record.user_agent,
      }));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(records));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/attendance-photo") {
    if (!hasRole(session, ["siswa"])) return forbidden(response);
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) request.destroy();
    });
    request.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const match = /^data:image\/(jpeg|jpg|png);base64,(.+)$/.exec(
          payload.photo || "",
        );
        if (!match) throw new Error("Format foto harus JPEG atau PNG.");
        const imageBuffer = Buffer.from(match[2], "base64");
        if (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024) {
          throw new Error("Ukuran foto maksimal 5 MB.");
        }
        if (!Number.isInteger(payload.image?.width) || !Number.isInteger(payload.image?.height) ||
            payload.image.width < 320 || payload.image.height < 240) {
          throw new Error("Resolusi foto minimal 320x240.");
        }
        const extension = match[1] === "png" ? "png" : "jpg";
        const receivedAt = new Date().toISOString();
        const filename = `presensi-${receivedAt.replace(/[.:]/g, "-")}.${extension}`;
        const capturedAt = new Date(payload.capturedAt || receivedAt);
        if (Number.isNaN(capturedAt.getTime())) throw new Error("Waktu pengambilan foto tidak valid.");
        const timeParts = jakartaParts(capturedAt);
        if (timeParts.weekday === "Sat" || timeParts.weekday === "Sun") {
          const error = new Error("Presensi hanya dapat dicatat pada hari kerja.");
          error.status = 422;
          throw error;
        }
        const location = payload.location;
        const validLocation =
          location &&
          Number.isFinite(location.latitude) &&
          Number.isFinite(location.longitude)
            ? {
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: Number.isFinite(location.accuracy)
                  ? location.accuracy
                  : null,
              }
            : null;
        const studentLocation = database.prepare(`
          SELECT locations.latitude, locations.longitude
          FROM students
          LEFT JOIN pkl_locations AS locations ON locations.id = students.pkl_location_id
          WHERE students.nisn = ?
        `).get(session.user_id);
        const outsideRadius = Boolean(
          validLocation &&
          studentLocation?.latitude !== null &&
          studentLocation?.longitude !== null &&
          distanceInMeters(validLocation.latitude, validLocation.longitude, studentLocation.latitude, studentLocation.longitude) > 200,
        );
        const dailyCount = database.prepare(`
          SELECT COUNT(*) AS count
          FROM attendance_records
          WHERE user_id = ? AND (attendance_date = ? OR (attendance_date IS NULL AND substr(captured_at, 1, 10) = ?))
        `).get(session.user_id, timeParts.date, timeParts.date).count;
        if (dailyCount >= 2) {
          const error = new Error("Presensi masuk dan pulang hari ini sudah tercatat.");
          error.status = 409;
          throw error;
        }
        const attendanceType = dailyCount === 0 ? "masuk" : "pulang";
        const status = timeParts.hour > 8 || (timeParts.hour === 8 && timeParts.minute > 0)
          ? "Terlambat"
          : "Hadir";
        const locationAddress = validLocation
          ? await reverseGeocode(validLocation.latitude, validLocation.longitude)
          : null;
        const record = {
          filename,
          userId: session.user_id,
          role: session.role,
          status,
          attendanceType,
          outsideRadius,
          location: validLocation,
          locationAddress,
          capturedAt: capturedAt.toISOString(),
          receivedAt,
          image: {
            width: Number.isInteger(payload.image?.width)
              ? payload.image.width
              : null,
            height: Number.isInteger(payload.image?.height)
              ? payload.image.height
              : null,
            sizeBytes: imageBuffer.length,
            type: `image/${extension === "jpg" ? "jpeg" : extension}`,
          },
          userAgent: String(payload.userAgent || "Tidak diketahui").slice(0, 500),
        };
        fs.writeFileSync(
          path.join(imageDirectory, filename),
          imageBuffer,
        );
        try {
          database
            .prepare(`
              INSERT INTO attendance_records (
                filename, user_id, role, status, attendance_type, outside_radius, attendance_date, captured_at, received_at,
                latitude, longitude, accuracy, location_address, image_width, image_height,
                image_size_bytes, image_type, user_agent
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              record.filename,
              record.userId,
              record.role,
              record.status,
              record.attendanceType,
              record.outsideRadius ? 1 : 0,
              timeParts.date,
              record.capturedAt,
              record.receivedAt,
              record.location?.latitude ?? null,
              record.location?.longitude ?? null,
              record.location?.accuracy ?? null,
              record.locationAddress,
              record.image.width,
              record.image.height,
              record.image.sizeBytes,
              record.image.type,
              record.userAgent,
            );
        } catch (error) {
          fs.rmSync(path.join(imageDirectory, filename), { force: true });
          throw error;
        }
        audit(request, "attendance_photo_created", filename, null, record, session.user_id);
        response.writeHead(201, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, record }));
      } catch (error) {
        response.writeHead(error.status || 400, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ ok: false, message: error.message || "Foto tidak valid" }),
        );
      }
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/report-upload") {
    if (!hasRole(session, ["siswa"])) return forbidden(response);
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 14_500_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const safeName = safeReportName(payload.filename);
        const extension = path.extname(safeName).toLowerCase();
        const allowedExtensions = [".pdf", ".doc", ".docx"];
        const match = /^data:(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document);base64,(.+)$/.exec(payload.data || "");
        if (!safeName || !allowedExtensions.includes(extension) || !match) throw new Error("File laporan tidak valid.");
        const buffer = Buffer.from(match[2], "base64");
        if (!buffer.length || buffer.length > 10 * 1024 * 1024 || !hasValidReportSignature(extension, buffer)) {
          throw new Error("Isi file tidak sesuai format atau melebihi 10 MB.");
        }
        const filename = `laporan-${Date.now()}-${safeName}`;
        const targetPath = path.join(reportDirectory, filename);
        const tempPath = `${targetPath}.tmp-${crypto.randomBytes(8).toString("hex")}`;
        fs.writeFileSync(tempPath, buffer, { flag: "wx" });
        fs.renameSync(tempPath, targetPath);
        const report = { filename, originalName: safeName, userId: session.user_id, createdAt: new Date().toISOString() };
        try {
          fs.appendFileSync(path.join(reportDirectory, "laporan-log.jsonl"), `${JSON.stringify(report)}\n`);
        } catch (error) {
          fs.rmSync(targetPath, { force: true });
          throw error;
        }
        audit(request, "report_uploaded", filename, null, report, session.user_id);
        response.writeHead(201, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, filename, originalName: safeName }));
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, message: "File laporan tidak valid" }));
      }
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/reports") {
    audit(request, "reports_accessed", session.role === "siswa" ? session.user_id : "scoped", null, null, session.user_id);
    writeJson(response, 200, listReportsFor(session));
    return;
  }
  serveFile(request, response);
}

const server = http.createServer((request, response) => {
  try {
    handleRequest(request, response);
  } catch (error) {
    logEvent("error", "unhandled_request_error", { message: error.message });
    if (!response.headersSent) {
      writeJson(response, 500, { ok: false, message: "Terjadi kesalahan pada server." });
    } else {
      response.end();
    }
  }
});

const port = Number(process.env.PORT) || 3000;
seedAdmin();
seedConfiguredUser(process.env.GURU_ID || "guru.pembimbing", "guru", process.env.GURU_PASSWORD);
cleanupExpiredData();
seedMissingStudentAccounts();
seedInitialTeacherAssignments();
server.listen(port, () => {
 console.log(`Presensi PKL berjalan di http://localhost:${port}`);
 logEvent("info", "server_started", { port });
 backfillLocationAddresses().catch((error) => {
   console.error("Pengisian alamat lokasi lama gagal:", error.message);
 });
});
