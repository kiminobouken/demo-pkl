const crypto = require("node:crypto");
const readline = require("node:readline");
const { DatabaseSync } = require("node:sqlite");

const databasePath = process.env.DATABASE_PATH || "data/presensi.sqlite";
const userId = String(process.argv[2] || "admin.sekolah").trim();

if (!userId) {
  console.error("ID pengguna wajib diisi.");
  process.exit(1);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

function askHidden(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    const rl = readline.createInterface({ input, output });
    let value = "";

    output.write(question);
    input.setRawMode?.(true);
    input.resume();

    const onData = (chunk) => {
      const character = chunk.toString();
      if (character === "\u0003") {
        cleanup();
        reject(new Error("Dibatalkan."));
      } else if (character === "\r" || character === "\n") {
        cleanup();
        output.write("\n");
        resolve(value);
      } else if (character === "\u007f") {
        value = value.slice(0, -1);
      } else if (character.length === 1) {
        value += character;
      }
    };

    function cleanup() {
      input.off("data", onData);
      input.setRawMode?.(false);
      rl.close();
    }

    input.on("data", onData);
  });
}

async function main() {
  const database = new DatabaseSync(databasePath);
  const user = database
    .prepare("SELECT id, role FROM users WHERE id = ?")
    .get(userId);

  if (!user) {
    throw new Error(`Akun "${userId}" tidak ditemukan di ${databasePath}.`);
  }

  const password = await askHidden(`Password baru untuk ${user.id} (${user.role}): `);
  const confirmation = await askHidden("Ulangi password baru: ");

  if (password.length < 12) {
    throw new Error("Password minimal 12 karakter.");
  }
  if (password !== confirmation) {
    throw new Error("Konfirmasi password tidak sama.");
  }

  const now = new Date().toISOString();
  database
    .prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?")
    .run(hashPassword(password), user.id);
  database
    .prepare(
      "INSERT INTO audit_logs (actor_id, action, target, after_value, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(null, "password_reset_local", user.id, JSON.stringify({ source: "reset-password.js" }), now);
  database.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  console.log(`Password akun ${user.id} berhasil direset. Semua sesi akun tersebut telah dikeluarkan.`);
}

main().catch((error) => {
  console.error(`Reset password gagal: ${error.message}`);
  process.exitCode = 1;
});
