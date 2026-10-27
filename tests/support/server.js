const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.join(__dirname, "..", "..");

function startTestServer(extraEnv = {}) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "presensi-test-"));
  // Rentang 7000-9999 tidak tumpang tindih dengan tes lain yang memilih port sendiri (3900-4399, 5100-5899).
  const pickPort = () => 7000 + Math.floor(Math.random() * 3000);
  let port = pickPort();
  let baseUrl = `http://localhost:${port}`;
  let child = null;

  async function start() {
    // Bila port ternyata terpakai atau server gagal siap, coba port lain (maksimal 3 kali).
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (await tryStart()) return;
      await stop();
      port = pickPort();
      baseUrl = `http://localhost:${port}`;
    }
    throw new Error("server startup timeout");
  }

  async function tryStart() {
    child = spawn(process.execPath, [path.join(projectRoot, "server.js")], {
      cwd: projectRoot,
      stdio: "ignore",
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_PATH: path.join(runtime, "presensi.sqlite"),
        IMAGE_DIRECTORY: path.join(runtime, "images"),
        REPORT_DIRECTORY: path.join(runtime, "reports"),
        DATA_DIRECTORY: runtime,
        ADMIN_ID: "admin.sekolah",
        ADMIN_PASSWORD: "admin-password-123",
        GURU_ID: "guru.a",
        GURU_PASSWORD: "guru-a-password-123",
        ...extraEnv,
      },
    });
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) return false;
      try {
        if ((await fetch(`${baseUrl}/healthz`)).status === 200) {
          // Pastikan yang menjawab adalah proses ini, bukan server lain yang kebetulan memakai port itu.
          await new Promise((resolve) => setTimeout(resolve, 150));
          return child.exitCode === null;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  async function stop() {
    if (!child) return;
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
    child = null;
  }

  async function api(method, route, { cookie, json, text } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    let body;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (text !== undefined) {
      headers["Content-Type"] = "text/csv";
      body = text;
    }
    const response = await fetch(`${baseUrl}${route}`, { method, headers, body });
    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch {}
    return { status: response.status, data, raw, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }

  async function login(id, password) {
    const result = await api("POST", "/api/login", { json: { id, password } });
    return result;
  }

  // Login and, when a temporary password is in use, replace it. Returns the session cookie.
  async function ready(id, password, newPassword = `${password}-changed`) {
    const result = await login(id, password);
    if (result.status !== 200) throw new Error(`login ${id} failed: ${result.status}`);
    if (result.data?.user?.mustChangePassword) {
      const changed = await api("POST", "/api/password", { cookie: result.cookie, json: { password: newPassword } });
      if (changed.status !== 200) throw new Error(`password change ${id} failed: ${changed.status}`);
    }
    return result.cookie;
  }

  function cleanup() {
    fs.rmSync(runtime, { recursive: true, force: true });
  }

  return { baseUrl, runtime, start, stop, api, login, ready, cleanup };
}

// A Monday-Friday timestamp at 10:00 WIB within the last week, for attendance tests.
function recentWeekdayIso() {
  const date = new Date();
  for (let i = 0; i < 7; i += 1) {
    const candidate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - i, 3, 0, 0));
    const day = new Date(candidate.getTime() + 7 * 3600e3).getUTCDay();
    if (day >= 1 && day <= 5 && candidate.getTime() < Date.now() - 3600e3) return candidate.toISOString();
  }
  throw new Error("no weekday found");
}

const tinyJpeg = `data:image/jpeg;base64,${Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9,
]).toString("base64")}`;
const tinyPdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n%test\n").toString("base64")}`;

module.exports = { startTestServer, recentWeekdayIso, tinyJpeg, tinyPdf };
