const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

test("location address lookup requires a session and validates coordinates", async (t) => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "presensi-location-"));
  const port = 3900 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: path.join(runtime, "presensi.sqlite"),
      IMAGE_DIRECTORY: path.join(runtime, "images"),
      REPORT_DIRECTORY: path.join(runtime, "reports"),
      DATA_DIRECTORY: runtime,
      ADMIN_PASSWORD: "test-password-123",
    },
    stdio: "ignore",
  });
  t.after(async () => {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
    fs.rmSync(runtime, { recursive: true, force: true });
  });

  const baseUrl = `http://localhost:${port}`;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server startup timeout")), 5000);
    server.on("error", reject);
    const poll = async () => {
      try {
        if ((await fetch(baseUrl)).status === 200) {
          clearTimeout(timeout);
          resolve();
          return;
        }
      } catch {}
      setTimeout(poll, 50);
    };
    poll();
  });

  const unauthenticated = await fetch(`${baseUrl}/api/location-address?lat=91&lon=0`);
  assert.equal(unauthenticated.status, 401);

  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "admin.sekolah", password: "test-password-123" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  const blocked = await fetch(`${baseUrl}/api/location-address?lat=91&lon=0`, { headers: { Cookie: cookie } });
  assert.equal(blocked.status, 403);
  const changed = await fetch(`${baseUrl}/api/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ password: "test-password-changed-123" }),
  });
  assert.equal(changed.status, 200);

  const invalidCoordinates = await fetch(
    `${baseUrl}/api/location-address?lat=91&lon=0`,
    { headers: { Cookie: cookie } },
  );
  assert.equal(invalidCoordinates.status, 400);
  assert.deepEqual(await invalidCoordinates.json(), {
    ok: false,
    message: "Koordinat lokasi tidak valid.",
  });
});
