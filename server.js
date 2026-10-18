const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

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
const loginAttempts = new Map();
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
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
    WHERE sessions.id = ? AND sessions.expires_at > ?
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
  const servesRuntimeFile =
    requestedPath.startsWith("/images/") || requestedPath.startsWith("/reports/");
  const baseDirectory = servesRuntimeFile ? root : publicDirectory;
  const filePath = path.resolve(baseDirectory, `.${requestedPath}`);
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
    if (session.role === "siswa") {
      const filename = path.basename(filePath);
      const ownsPhoto = Boolean(database.prepare(
        "SELECT id FROM attendance_records WHERE filename = ? AND user_id = ?",
      ).get(filename, session.user_id));
      const reportLogPath = path.join(reportDirectory, "laporan-log.jsonl");
      const ownsReport = fs.existsSync(reportLogPath) && fs.readFileSync(reportLogPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .some((line) => {
          try {
            const report = JSON.parse(line);
            return report.filename === filename && report.userId === session.user_id;
          } catch {
            return false;
          }
        });
      if ((requestedPath.startsWith("/images/") && !ownsPhoto) ||
          (requestedPath.startsWith("/reports/") && !ownsReport)) {
        forbidden(response);
        return;
      }
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
      mimeTypes[path.extname(filePath)] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  const session = getSession(request);
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
        const attempts = loginAttempts.get(id) || [];
        const recentAttempts = attempts.filter((timestamp) => now - timestamp < 20 * 60 * 1000);
        if (recentAttempts.length >= 5) throw new Error("Terlalu banyak percobaan login. Coba lagi dalam 20 menit.");
        const user = database.prepare("SELECT id, role, password_hash, must_change_password FROM users WHERE id = ?").get(id);
        if (!user || !verifyPassword(password, user.password_hash)) {
          recentAttempts.push(now);
          loginAttempts.set(id, recentAttempts);
          audit(request, "login_failed", id || "unknown");
          throw new Error("ID atau password tidak valid.");
        }
        loginAttempts.delete(id);
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
        writeJson(response, 200, { ok: true, user: { id: user.id, role: user.role, mustChangePassword: Boolean(user.must_change_password) } }, {
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
    writeJson(response, 200, { ok: true, user: { id: session.user_id, role: session.role, mustChangePassword: Boolean(session.mustChangePassword) } });
    return;
  }
  if (url.pathname.startsWith("/api/") && !session) {
    unauthorized(response);
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
        audit(request, "password_changed", session.user_id, null, null, session.user_id);
        writeJson(response, 200, { ok: true });
      } catch (error) {
        writeJson(response, 400, { ok: false, message: error.message });
      }
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/users") {
    if (!hasRole(session, ["guru", "admin"])) return forbidden(response);
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const id = String(payload.id || "").trim();
        const role = String(payload.role || "").trim();
        const password = String(payload.password || "");
        if (!id || !["siswa", "guru", "admin"].includes(role) || (role === "admin" && session.role !== "admin") || password.length < 12) {
          throw new Error("ID, role, dan password minimal 12 karakter tidak valid.");
        }
        if (database.prepare("SELECT id FROM users WHERE id = ?").get(id)) throw new Error("ID sudah terdaftar.");
        database.prepare(
          "INSERT INTO users (id, role, password_hash, must_change_password, created_at) VALUES (?, ?, ?, 1, ?)",
        ).run(id, role, hashPassword(password), new Date().toISOString());
        audit(request, "user_created", id, null, { role }, session.user_id);
        writeJson(response, 201, { ok: true, user: { id, role } });
      } catch (error) {
        writeJson(response, 400, { ok: false, message: error.message });
      }
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
    const reportsPath = path.join(reportDirectory, "laporan-log.jsonl");
    const reports = fs.existsSync(reportsPath)
      ? fs.readFileSync(reportsPath, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
          try { return [JSON.parse(line)]; } catch { return []; }
        })
      : [];
    const attendance = database.prepare(`
      SELECT filename, user_id AS userId, status, received_at AS date
      FROM attendance_records WHERE role = 'siswa' ORDER BY received_at DESC
    `).all();
    const notifications = [
      ...attendance.map((record) => ({
        id: `attendance:${record.filename}`,
        category: "Presensi siswa",
        title: "Presensi siswa tercatat",
        detail: `${record.userId} · ${record.status}`,
        date: record.date,
        target: "rekap",
      })),
      ...reports.map((report) => ({
        id: `report:${report.filename}`,
        category: "Laporan PKL",
        title: "Laporan PKL baru diunggah",
        detail: report.originalName || report.filename,
        date: report.createdAt,
        filename: report.filename,
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
          locations.id AS pklLocationId,
          locations.company_name AS pklCompanyName,
          locations.address AS pklAddress
         FROM students
         LEFT JOIN pkl_locations AS locations
           ON locations.id = students.pkl_location_id
         ORDER BY students.name`,
      )
      .all();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(students));
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
      if (request.method === "POST" && url.pathname === "/api/pkl-location-requests") {
        if (!hasRole(session, ["siswa"])) return forbidden(response);
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
          if (body.length > 20_000) request.destroy();
        });
        request.on("end", () => {
          try {
            const payload = JSON.parse(body);
            const companyName = String(payload.companyName || "").trim().slice(0, 120);
            const address = String(payload.address || "").trim().slice(0, 500);
            if (companyName.length < 2 || !address || address.length < 5) throw new Error("Nama PT dan alamat wajib diisi.");
            database.prepare(`
              INSERT INTO pkl_location_requests (student_nisn, company_name, address, created_at)
              VALUES (?, ?, ?, ?)
            `).run(session.user_id, companyName, address, new Date().toISOString());
            audit(request, "location_requested", session.user_id, null, { companyName, address }, session.user_id);
            writeJson(response, 202, { ok: true, message: "Usulan lokasi dikirim untuk persetujuan Guru/Admin." });
          } catch (error) {
            writeJson(response, 400, { ok: false, message: error.message });
          }
        });
        return;
      }
    });
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/api/students/")) {
    const nisn = decodeURIComponent(url.pathname.slice("/api/students/".length));
    if (session.role === "siswa" && session.user_id !== nisn) return forbidden(response);
    const student = database
      .prepare(`
        SELECT students.nisn, students.name,
          locations.id AS pklLocationId,
          locations.company_name AS pklCompanyName,
          locations.address AS pklAddress
        FROM students
        LEFT JOIN pkl_locations AS locations
          ON locations.id = students.pkl_location_id
        WHERE students.nisn = ?
      `)
      .get(nisn);
    response.writeHead(student ? 200 : 404, { "Content-Type": "application/json" });
    response.end(JSON.stringify(student || { message: "NISN belum terdaftar." }));
    return;
  }
  if (request.method === "PUT" && url.pathname.startsWith("/api/students/") && url.pathname.endsWith("/location")) {
    if (!hasRole(session, ["guru", "admin"]) && session.user_id !== decodeURIComponent(url.pathname.slice("/api/students/".length, -"/location".length))) {
      return forbidden(response);
    }
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const encodedNisn = url.pathname.slice("/api/students/".length, -"/location".length);
        const nisn = decodeURIComponent(encodedNisn);
        const payload = JSON.parse(body);
        const locationId = Number(payload.locationId);
        const locationExists = database.prepare("SELECT id FROM pkl_locations WHERE id = ?").get(locationId);
        if (!locationExists) throw new Error("Pilih lokasi PKL yang tersedia.");
        const result = database
          .prepare("UPDATE students SET pkl_location_id = ? WHERE nisn = ?")
          .run(locationId, nisn);
        if (!result.changes) throw new Error("NISN belum terdaftar.");
        audit(request, "student_location_changed", nisn, null, { locationId }, session.user_id);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, message: error.message }));
      }
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
          return { name, nisn, parentPhone };
        });

        const insertStudent = database.prepare(`
          INSERT INTO students (nisn, name, parent_phone)
          VALUES (?, ?, ?)
          ON CONFLICT(nisn) DO UPDATE SET
            name = excluded.name,
            parent_phone = excluded.parent_phone
        `);
        database.exec("BEGIN");
        try {
          for (const student of students) {
            insertStudent.run(student.nisn, student.name, student.parentPhone);
          }
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }

        const total = database.prepare("SELECT COUNT(*) AS count FROM students").get().count;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, imported: students.length, total }));
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, message: error.message }));
      }
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/attendance-records") {
    const records = database
      .prepare(session.role === "siswa"
        ? "SELECT * FROM attendance_records WHERE user_id = ? ORDER BY captured_at DESC"
        : "SELECT * FROM attendance_records ORDER BY captured_at DESC")
      .all(...(session.role === "siswa" ? [session.user_id] : []))
      .map((record) => ({
        filename: record.filename,
        userId: record.user_id,
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
        response.end(JSON.stringify({ ok: true, filename }));
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, message: "File laporan tidak valid" }));
      }
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/reports") {
    if (session.role === "siswa") {
      const logPath = path.join(reportDirectory, "laporan-log.jsonl");
      const ownReports = fs.existsSync(logPath)
        ? fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
            try {
              const report = JSON.parse(line);
              return report.userId === session.user_id ? [report] : [];
            } catch {
              return [];
            }
          }).reverse()
        : [];
      audit(request, "reports_accessed", session.user_id, null, null, session.user_id);
      return writeJson(response, 200, ownReports);
    }
    audit(request, "reports_accessed", "all", null, null, session.user_id);
    const logPath = path.join(reportDirectory, "laporan-log.jsonl");
    const reports = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        }).reverse()
      : [];
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(reports));
    return;
  }
  serveFile(request, response);
});

const port = Number(process.env.PORT) || 3000;
seedAdmin();
seedConfiguredUser(process.env.GURU_ID || "guru.pembimbing", "guru", process.env.GURU_PASSWORD);
cleanupExpiredData();
server.listen(port, () => {
 console.log(`Presensi PKL berjalan di http://localhost:${port}`);
 backfillLocationAddresses().catch((error) => {
   console.error("Pengisian alamat lokasi lama gagal:", error.message);
 });
});
