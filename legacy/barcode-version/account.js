const rolePages = {
  siswa: "index.html",
  guru: "guru.html",
  admin: "admin.html",
};
const status = document.querySelector("#password-status");
let rolePage = "login.html";
let requiredChange = new URLSearchParams(window.location.search).get("required") === "1";

async function loadAccount() {
  const response = await fetch("/api/session");
  if (response.status === 401) {
    window.location.href = "login.html";
    return;
  }
  if (!response.ok) {
    status.textContent = "Informasi sesi tidak dapat dimuat. Coba muat ulang halaman.";
    return;
  }
  const result = await response.json();
  rolePage = rolePages[result.user?.role] || "login.html";
  requiredChange = requiredChange || Boolean(result.user?.mustChangePassword);
  document.querySelector("#account-back").href = rolePage;
  if (requiredChange) {
    document.querySelector("#account-title").textContent = "Ganti kata sandi sementara";
    document.querySelector("#account-description").textContent =
      "Buat kata sandi baru minimal 12 karakter sebelum menggunakan fitur lain.";
    document.querySelector("#account-back").hidden = true;
  }
}

document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.querySelector("#new-password").value;
  const confirmation = document.querySelector("#confirm-password").value;
  if (password.length < 12) {
    status.textContent = "Password minimal 12 karakter.";
    return;
  }
  if (password !== confirmation) {
    status.textContent = "Konfirmasi password tidak sama.";
    return;
  }
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const response = await fetch("/api/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json();
    if (!response.ok) {
      status.textContent = result.message || "Password tidak dapat disimpan.";
      return;
    }
    status.textContent = "Password berhasil diperbarui.";
    window.location.href = rolePage;
  } catch {
    status.textContent = "Tidak dapat menghubungi server. Coba lagi.";
  } finally {
    button.disabled = false;
  }
});

loadAccount();
