const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

test("static file resolver ignores query strings and rejects encoded traversal", async (t) => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "presensi-static-"));
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
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server startup timeout")), 5000);
    server.on("error", reject);
    server.stdout?.on("data", () => {});
    const poll = async () => {
      try {
        if ((await fetch(`http://localhost:${port}/`)).status === 200) {
          clearTimeout(timeout);
          resolve();
          return;
        }
      } catch {}
      setTimeout(poll, 50);
    };
    poll();
  });

  assert.equal((await fetch(`http://localhost:${port}/?cache=1`)).status, 200);
  assert.equal((await fetch(`http://localhost:${port}/%2e%2e%2fserver.js`)).status, 400);
  assert.equal((await fetch(`http://localhost:${port}/%2e%2e%2f%2e%2e%2fetc/passwd`)).status, 400);
});
