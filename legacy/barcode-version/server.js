const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const resolveRuntimePath = (value, fallback) =>
  path.resolve(root, value || fallback);
const dataDirectory = resolveRuntimePath(
  process.env.V2_DATA_DIRECTORY,
  "data",
);
const reportDirectory = resolveRuntimePath(
  process.env.V2_REPORT_DIRECTORY,
  "reports",
);
const attendanceLog = path.join(dataDirectory, "presensi-log.jsonl");
const correctionLog = path.join(dataDirectory, "presensi-koreksi.jsonl");
const reportLog = path.join(dataDirectory, "laporan-log.jsonl");
fs.mkdirSync(dataDirectory, { recursive: true });
fs.mkdirSync(reportDirectory, { recursive: true });
const authDatabase = new DatabaseSync(path.join(dataDirectory, "auth.sqlite"));
const sessionCookieName = "presensi_v2_session";
authDatabase.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('siswa', 'guru', 'admin')),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS students (
    nis TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    kelas TEXT NOT NULL,
    barcode_version INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
`);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const allowedReportExtensions = [".pdf", ".doc", ".docx"];
const maxReportBytes = 10 * 1024 * 1024;
const attendanceStatuses = ["Hadir", "Terlambat", "Alpha", "Pulang"];

function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password, stored) {
  const [saltHex, keyHex] = String(stored).split(":");
  if (!saltHex || !keyHex) return false;
  const actual = Buffer.from(keyHex, "hex");
  const expected = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function seedUser(id, role, password) {
  if (!id || !password || password.length < 12 || authDatabase.prepare("SELECT id FROM users WHERE id = ?").get(id)) return;
  authDatabase.prepare("INSERT INTO users (id, role, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(id, role, passwordHash(password), new Date().toISOString());
}

seedUser(process.env.V2_ADMIN_ID || "admin.sekolah", "admin", process.env.ADMIN_PASSWORD);
seedUser(process.env.V2_GURU_ID || "198507122010012003", "guru", process.env.GURU_PASSWORD);
seedUser(process.env.V2_SISWA_ID || "202312047", "siswa", process.env.SISWA_PASSWORD);

function seedStudent(nis, nama, kelas) {
  if (!nis || !nama || !kelas || authDatabase.prepare("SELECT nis FROM students WHERE nis = ?").get(nis)) return;
  authDatabase.prepare(
    "INSERT INTO students (nis, nama, kelas, barcode_version, active, created_at) VALUES (?, ?, ?, 1, 1, ?)",
  ).run(nis, nama, kelas, new Date().toISOString());
}

seedStudent(process.env.V2_SISWA_ID || "202312047", "Raka Aditya", "XI RPL 2");
[
  ["202312052", "Nadia Safitri", "XI RPL 2"],
  ["202312061", "Bima Prasetyo", "XI RPL 1"],
  ["202312068", "Citra Maharani", "XI TKJ 1"],
  ["202312075", "Dimas Ardiansyah", "XI TKJ 2"],
].forEach(([nis, nama, kelas]) => seedStudent(nis, nama, kelas));

function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => {
    const [name, ...value] = part.trim().split("=");
    return [name, value.join("=")];
  }).filter(([name, value]) => name && value));
}

function getSession(request) {
  const id = cookies(request)[sessionCookieName];
  if (!id) return null;
  return authDatabase.prepare(
    "SELECT id, user_id AS userId, role FROM sessions WHERE id = ? AND expires_at > ?",
  ).get(id, new Date().toISOString()) || null;
}

function requireRole(session, roles, response) {
  if (!session) {
    sendJson(response, 401, { ok: false, message: "Sesi login diperlukan." });
    return false;
  }
  if (!roles.includes(session.role)) {
    sendJson(response, 403, { ok: false, message: "Anda tidak memiliki akses." });
    return false;
  }
  return true;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendJsonl(file, record) {
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

function readBody(request, limit = 15_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(payload));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function localStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function attendanceWithCorrections() {
  const corrections = new Map();
  readJsonl(correctionLog).forEach((item) => corrections.set(item.id, item));
  const rows = readJsonl(attendanceLog)
    .map((entry) => {
      const correction = corrections.get(entry.id);
      return {
        ...entry,
        status: correction
          ? correction.status
          : entry.type === "pulang"
            ? "Pulang"
            : "Hadir",
        corrected: Boolean(correction),
        correctedBy: correction ? correction.correctedBy : null,
        correctedAt: correction ? correction.correctedAt : null,
      };
    })
    .reverse();
  const students = authDatabase.prepare("SELECT nis, nama, kelas FROM students WHERE active = 1").all();
  const today = localStamp().date;
  const day = new Date(`${today}T00:00:00Z`);
  for (let offset = 1; offset <= 30; offset += 1) {
    const date = new Date(day);
    date.setUTCDate(day.getUTCDate() - offset);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const dateText = date.toISOString().slice(0, 10);
    students.forEach((student) => {
      if (!rows.some((entry) => entry.nis === student.nis && entry.date === dateText))
        rows.push({
          id: `alpha-${student.nis}-${dateText}`,
          nis: student.nis,
          nama: student.nama,
          kelas: student.kelas,
          type: "alpha",
          date: dateText,
          time: null,
          status: "Alpha",
          corrected: false,
          correctedBy: null,
          correctedAt: null,
          source: "derived",
        });
    });
  }
  return rows.sort((a, b) => `${b.date} ${b.time || ""}`.localeCompare(`${a.date} ${a.time || ""}`));
}

// Presensi: barcode pada kartu siswa dipindai, kode dicocokkan dengan NIS.
// Pemindaian pertama hari itu = masuk, kedua = pulang.
async function handleScan(request, response) {
  try {
    const payload = JSON.parse(await readBody(request, 100_000));
    const code = String(payload.code || "").trim();
    const session = getSession(request);
    const nis = session.userId;
    const metadata = payload.metadata;
    const student = authDatabase.prepare(
      "SELECT nis, nama, kelas, barcode_version FROM students WHERE nis = ? AND active = 1",
    ).get(nis);
    if (
      !code ||
      code.length > 64 ||
      !student ||
      !metadata ||
      typeof metadata.capturedAt !== "string" ||
      Number.isNaN(Date.parse(metadata.capturedAt))
    ) {
      throw new Error("invalid");
    }
    const expectedCodes = [student.nis, `${student.nis}|v${student.barcode_version}`];
    if (!expectedCodes.includes(code)) {
      sendJson(response, 422, {
        ok: false,
        message: "Barcode tidak cocok dengan akun siswa ini",
      });
      return;
    }
    const { date, time } = localStamp();
    const isWeekday = ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
    if (!isWeekday) {
      sendJson(response, 422, { ok: false, message: "Presensi hanya dapat dilakukan pada hari kerja." });
      return;
    }
    const todayCount = readJsonl(attendanceLog).filter(
      (entry) => entry.nis === nis && entry.date === date,
    ).length;
    const hasLocation =
      Number.isFinite(metadata.latitude) &&
      metadata.latitude >= -90 &&
      metadata.latitude <= 90 &&
      Number.isFinite(metadata.longitude) &&
      metadata.longitude >= -180 &&
      metadata.longitude <= 180 &&
      Number.isFinite(metadata.accuracy) &&
      metadata.accuracy >= 0;
    if (todayCount === 0 && !hasLocation) {
      sendJson(response, 422, { ok: false, message: "Lokasi wajib tersedia untuk presensi masuk." });
      return;
    }
    if (todayCount >= 2) {
      sendJson(response, 409, {
        ok: false,
        message: "Presensi masuk dan pulang hari ini sudah tercatat",
      });
      return;
    }
    if (todayCount === 1 && time < "15:00") {
      sendJson(response, 422, { ok: false, message: "Presensi pulang hanya dapat dilakukan mulai pukul 15:00." });
      return;
    }
    const entry = {
      id: crypto.randomUUID(),
      nis,
      nama: student.nama,
      kelas: student.kelas,
      code,
      type: todayCount === 0 ? "masuk" : "pulang",
      status: todayCount === 0 && time > "08:00" ? "Terlambat" : todayCount === 0 ? "Hadir" : "Pulang",
      date,
      time,
      createdAt: new Date().toISOString(),
      metadata: {
        capturedAt: new Date(metadata.capturedAt).toISOString(),
        latitude: hasLocation ? metadata.latitude : null,
        longitude: hasLocation ? metadata.longitude : null,
        accuracy: hasLocation ? metadata.accuracy : null,
      },
    };
    appendJsonl(attendanceLog, entry);
    sendJson(response, 201, { ok: true, type: entry.type, time, date });
  } catch {
    sendJson(response, 400, { ok: false, message: "Data presensi tidak valid" });
  }
}

async function handleCorrection(request, response) {
  try {
    const payload = JSON.parse(await readBody(request, 100_000));
    const exists = readJsonl(attendanceLog).some(
      (entry) => entry.id === payload.id,
    );
    const reason = String(payload.reason || "").trim();
    if (!exists || !attendanceStatuses.includes(payload.status) || reason.length > 500)
      throw new Error("invalid");
    appendJsonl(correctionLog, {
      id: payload.id,
      status: payload.status,
      correctedBy: getSession(request).userId,
      previousStatus: attendanceWithCorrections().find((entry) => entry.id === payload.id)?.status || null,
      reason: reason || null,
      correctedAt: new Date().toISOString(),
    });
    sendJson(response, 200, { ok: true, status: payload.status });
  } catch {
    sendJson(response, 400, { ok: false, message: "Koreksi tidak valid" });
  }
}

async function handleReportUpload(request, response) {
  try {
    const payload = JSON.parse(await readBody(request));
    const nis = String(payload.nis || "").trim();
    const nama = String(payload.nama || "").trim();
    const kelas = String(payload.kelas || "").trim();
    const originalName = path.basename(String(payload.fileName || ""));
    const extension = path.extname(originalName).toLowerCase();
    const match = /^data:[^;,]*;base64,(.+)$/.exec(payload.data || "");
    if (!nis || !nama || !match || !allowedReportExtensions.includes(extension))
      throw new Error("invalid");
    const buffer = Buffer.from(match[1], "base64");
    if (!buffer.length || buffer.length > maxReportBytes)
      throw new Error("size");
    const safeBase = path
      .basename(originalName, extension)
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 60);
    const filename = `${nis}-${Date.now()}-${safeBase}${extension}`;
    fs.writeFileSync(path.join(reportDirectory, filename), buffer);
    const record = {
      nis,
      nama,
      kelas,
      originalName,
      filename,
      size: buffer.length,
      createdAt: new Date().toISOString(),
    };
    appendJsonl(reportLog, record);
    sendJson(response, 201, { ok: true, ...record });
  } catch {
    sendJson(response, 400, {
      ok: false,
      message: "Laporan tidak valid. Gunakan PDF/DOC/DOCX maksimal 10 MB.",
    });
  }
}

function serveFile(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  if (pathname === "/") pathname = "/login.html";
  const filePath = path.normalize(path.join(root, pathname));
  const relative = path.relative(root, filePath);
  const blocked =
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).some((part) => part.startsWith(".")) ||
    relative === "server.js" ||
    relative.startsWith(`data${path.sep}`);
  if (
    blocked ||
    !fs.existsSync(filePath) ||
    !fs.statSync(filePath).isFile()
  ) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type":
      mimeTypes[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  const { pathname } = new URL(request.url, "http://localhost");
  const session = getSession(request);
  if (request.method === "POST" && pathname === "/api/login") {
    return readBody(request, 20_000).then((body) => {
      try {
        const payload = JSON.parse(body);
        const id = String(payload.id || "").trim();
        const password = String(payload.password || "");
        const user = authDatabase.prepare("SELECT id, role, password_hash FROM users WHERE id = ?").get(id);
        if (!user || !passwordMatches(password, user.password_hash)) {
          sendJson(response, 401, { ok: false, message: "ID atau password tidak valid." });
          return;
        }
        const sessionId = crypto.randomBytes(32).toString("hex");
        authDatabase.prepare("INSERT INTO sessions (id, user_id, role, expires_at) VALUES (?, ?, ?, ?)")
          .run(sessionId, user.id, user.role, new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString());
        sendJson(response, 200, { ok: true, user: { id: user.id, role: user.role } }, {
          "Set-Cookie": `${sessionCookieName}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
        });
      } catch {
        sendJson(response, 400, { ok: false, message: "Data login tidak valid." });
      }
    }).catch(() => sendJson(response, 400, { ok: false, message: "Data login tidak valid." }));
  }
  if (request.method === "POST" && pathname === "/api/logout") {
    if (session) authDatabase.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    sendJson(response, 200, { ok: true }, {
      "Set-Cookie": `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    });
    return;
  }
  if (request.method === "GET" && pathname === "/api/session") {
    if (!session) return sendJson(response, 401, { ok: false, message: "Sesi login diperlukan." });
    return sendJson(response, 200, { ok: true, user: { id: session.userId, role: session.role } });
  }
  if (request.method === "POST" && pathname === "/api/attendance-scan")
    return requireRole(session, ["siswa"], response) && handleScan(request, response);
  if (request.method === "POST" && pathname === "/api/attendance-correction")
    return requireRole(session, ["admin"], response) && handleCorrection(request, response);
  if (request.method === "GET" && pathname === "/api/attendance-log")
    return requireRole(session, ["guru", "admin"], response) && sendJson(response, 200, attendanceWithCorrections());
  if (request.method === "GET" && pathname === "/api/my-attendance")
    return requireRole(session, ["siswa"], response) && sendJson(response, 200, attendanceWithCorrections().filter((entry) => entry.nis === session.userId));
  if (request.method === "GET" && pathname === "/api/students")
    return requireRole(session, ["guru", "admin"], response) && sendJson(response, 200, authDatabase.prepare("SELECT nis, nama, kelas, barcode_version AS barcodeVersion FROM students WHERE active = 1 ORDER BY nama").all());
  if (request.method === "GET" && pathname === "/api/students")
    return requireRole(session, ["guru", "admin"], response) && sendJson(response, 200, authDatabase.prepare("SELECT nis, nama, kelas, barcode_version AS barcodeVersion FROM students WHERE active = 1 ORDER BY nama").all());
  if (request.method === "POST" && pathname === "/api/laporan-pkl")
    return requireRole(session, ["siswa"], response) && handleReportUpload(request, response);
  if (request.method === "GET" && pathname === "/api/laporan-pkl")
    return requireRole(session, ["siswa", "guru", "admin"], response) && sendJson(response, 200, readJsonl(reportLog)
      .filter((report) => session.role !== "siswa" || report.nis === session.userId).reverse());
  serveFile(request, response);
});

const port = Number(process.env.V2_PORT) || 3001;
server.listen(port, () =>
  console.log(`Presensi PKL barcode berjalan di http://localhost:${port}`),
);
