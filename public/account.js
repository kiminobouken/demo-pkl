// Account menu, password dialog, help dialog, and tutorial.
// Depends on helpers from app.js (currentUser, setView, escapeHtml, showToast, onPasswordChanged).

const accountMenu = document.querySelector("#account-menu");
const accountTriggers = [
  document.querySelector("#account-menu-button"),
  document.querySelector("#current-user-mini-avatar"),
];
let accountMenuTrigger = null;

function closeAccountMenu({ restoreFocus = false } = {}) {
  if (accountMenu.hidden) return;
  accountMenu.hidden = true;
  accountTriggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  if (restoreFocus) accountMenuTrigger?.focus();
}

function openAccountMenu(trigger) {
  accountMenuTrigger = trigger;
  accountMenu.hidden = false;
  accountTriggers.forEach((item) => item.setAttribute("aria-expanded", String(item === trigger)));
  const rect = trigger.getBoundingClientRect();
  const width = accountMenu.offsetWidth;
  const height = accountMenu.offsetHeight;
  const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
  accountMenu.style.left = `${left}px`;
  accountMenu.style.top = `${top}px`;
  accountMenu.querySelector("button").focus();
}

accountTriggers.forEach((trigger) =>
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!accountMenu.hidden && accountMenuTrigger === trigger) closeAccountMenu();
    else openAccountMenu(trigger);
  }),
);

document.addEventListener("click", (event) => {
  if (!accountMenu.contains(event.target)) closeAccountMenu();
});
window.addEventListener("resize", () => closeAccountMenu());
window.addEventListener("scroll", () => closeAccountMenu(), { passive: true });

accountMenu.addEventListener("keydown", (event) => {
  const items = [...accountMenu.querySelectorAll("button")];
  const index = items.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    closeAccountMenu({ restoreFocus: true });
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    items[(index + 1) % items.length].focus();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    items[(index - 1 + items.length) % items.length].focus();
  } else if (event.key === "Home") {
    event.preventDefault();
    items[0].focus();
  } else if (event.key === "End") {
    event.preventDefault();
    items[items.length - 1].focus();
  } else if (event.key === "Tab") {
    closeAccountMenu();
  }
});

accountMenu.addEventListener("click", (event) => {
  const button = event.target.closest("[data-account-action]");
  if (!button) return;
  const action = button.dataset.accountAction;
  const role = currentUser().role;
  closeAccountMenu();
  if (action === "profile") setView(role === "siswa" ? "siswa" : "profil-guru");
  else if (action === "settings") setView("pengaturan");
  else if (action === "tutorial") openTutorial();
  else if (action === "help") openHelp();
  else if (action === "logout") document.querySelector("#logout-button").click();
});

// ---- Password dialog (forced for temporary passwords, optional from Pengaturan)
const passwordDialog = document.querySelector("#password-dialog");
const passwordForm = document.querySelector("#password-form");
const passwordStatus = document.querySelector("#password-status");

function openPasswordDialog({ forced = false } = {}) {
  passwordForm.reset();
  passwordStatus.textContent = "";
  passwordDialog.dataset.forced = String(forced);
  document.querySelector("#password-title").textContent = forced ? "Ganti password sementara" : "Ubah password";
  document.querySelector("#password-copy").textContent = forced
    ? "Akun kamu memakai password sementara. Buat password baru (minimal 12 karakter) sebelum memakai aplikasi."
    : "Gunakan minimal 12 karakter yang sulit ditebak.";
  document.querySelector("#password-cancel").hidden = forced;
  document.querySelector("#password-logout").hidden = !forced;
  if (!passwordDialog.open) passwordDialog.showModal();
  document.querySelector("#password-new").focus();
}

passwordDialog.addEventListener("cancel", (event) => {
  if (passwordDialog.dataset.forced === "true") event.preventDefault();
});
document.querySelector("#password-cancel").addEventListener("click", () => passwordDialog.close());
document.querySelector("#password-logout").addEventListener("click", () => {
  passwordDialog.close();
  document.querySelector("#logout-button").click();
});
document.querySelector("#open-change-password").addEventListener("click", () => openPasswordDialog());

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.querySelector("#password-new").value;
  const confirmation = document.querySelector("#password-confirm").value;
  if (password.length < 12) {
    passwordStatus.textContent = "Password minimal 12 karakter.";
    return;
  }
  if (password !== confirmation) {
    passwordStatus.textContent = "Konfirmasi password tidak sama.";
    return;
  }
  const submit = document.querySelector("#password-submit");
  submit.disabled = true;
  passwordStatus.textContent = "Menyimpan password...";
  try {
    const response = await fetch("/api/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Password belum berhasil diubah.");
    const wasForced = passwordDialog.dataset.forced === "true";
    passwordDialog.close();
    showToast("Password berhasil diubah", wasForced ? "Selamat datang. Data kamu sedang dimuat." : "Gunakan password baru saat login berikutnya.");
    if (wasForced) onPasswordChanged();
  } catch (error) {
    passwordStatus.textContent = error instanceof TypeError ? "Server tidak dapat dihubungi." : error.message;
  } finally {
    submit.disabled = false;
  }
});

// ---- Help dialog
const helpDialog = document.querySelector("#help-dialog");

async function openHelp() {
  const content = document.querySelector("#help-content");
  content.innerHTML = "<p>Memuat kontak bantuan...</p>";
  helpDialog.showModal();
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("config");
    const { helpContact } = await response.json();
    const rows = [];
    if (helpContact.name) rows.push(`<div><dt>Kontak</dt><dd>${escapeHtml(helpContact.name)}</dd></div>`);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(helpContact.email)) {
      rows.push(`<div><dt>Email</dt><dd><a href="mailto:${encodeURIComponent(helpContact.email).replace("%40", "@")}">${escapeHtml(helpContact.email)}</a></dd></div>`);
    }
    if (/^\+?[0-9 ()-]{6,20}$/.test(helpContact.phone)) {
      rows.push(`<div><dt>Telepon / WhatsApp</dt><dd><a href="tel:${escapeHtml(helpContact.phone.replace(/[^0-9+]/g, ""))}">${escapeHtml(helpContact.phone)}</a></dd></div>`);
    }
    if (helpContact.note) rows.push(`<div><dt>Catatan</dt><dd>${escapeHtml(helpContact.note)}</dd></div>`);
    content.innerHTML = rows.length
      ? `<dl>${rows.join("")}</dl>`
      : "<p>Kontak admin belum diatur di server. Hubungi guru pembimbing atau admin sekolah secara langsung.</p>";
  } catch {
    content.innerHTML = "<p>Kontak bantuan belum dapat dimuat. Hubungi guru pembimbing atau admin sekolah secara langsung.</p>";
  }
}
document.querySelector("#open-help").addEventListener("click", openHelp);

// ---- Tutorial
const tutorialDialog = document.querySelector("#tutorial-dialog");
const tutorialTabs = document.querySelector(".tutorial-tabs");
const tutorialContent = document.querySelector("#tutorial-content");
const tutorials = {
  siswa: {
    label: "Siswa",
    steps: [
      "Pindah halaman lewat menu samping (di ponsel: bilah menu bawah). Menu avatar di kanan atas berisi Profil, Pengaturan, Tutorial, Bantuan, dan Keluar.",
      "Masuk dengan NISN dan password dari sekolah. Jika memakai password sementara, aplikasi meminta kamu membuat password baru lebih dulu (minimal 12 karakter).",
      "Buka Data siswa lalu klik Atur tempat PKL. Pilih tempat yang tersedia, atau pilih Usulkan tempat lain dan isi nama PT serta alamatnya. Usulan baru muncul di daftar pilihan setelah disetujui guru atau admin.",
      "Untuk presensi, buka Dashboard lalu klik Presensi sekarang. Izinkan akses lokasi dan kamera, klik Buka kamera, Ambil foto, lalu Simpan presensi. Foto pertama hari itu tercatat sebagai presensi masuk dan foto kedua sebagai presensi pulang.",
      "Presensi hanya dapat dicatat pada hari kerja (Senin–Jumat). Presensi masuk setelah pukul 08.00 WIB tercatat Terlambat.",
      "Di Rekap presensi kamu bisa melihat riwayat, memfilter periode dan status, serta mengunduh laporan dalam format CSV.",
      "Di Laporan PKL, unggah file PDF, DOC, atau DOCX (maksimal 10 MB). Status berubah menjadi Valid atau Perlu revisi setelah diperiksa guru pembimbing.",
    ],
  },
  guru: {
    label: "Guru",
    steps: [
      "Pindah halaman lewat menu samping (di ponsel: bilah menu bawah). Menu avatar di kanan atas berisi Profil, Pengaturan, Tutorial, Bantuan, dan Keluar. Masuk dengan ID guru dari admin; password sementara wajib diganti saat login pertama.",
      "Kamu hanya melihat siswa pada kelas yang ditugaskan admin. Jika daftar siswa kosong, hubungi admin untuk penugasan kelas.",
      "Dashboard menampilkan foto presensi siswa hari ini. Di Rekap presensi kamu bisa memfilter periode (hari ini, bulan ini, 3 bulan terakhir) dan status, membuka foto, serta mengunduh CSV.",
      "Di Data siswa, impor CSV (kolom wajib: Nama Siswa dan NISN; opsional: No. HP Orang Tua dan Kelas). Jika kamu memegang satu kelas, siswa baru otomatis masuk ke kelas tersebut.",
      "Tetapkan tempat PKL tiap siswa, tambah lokasi baru, dan setujui atau tolak usulan lokasi dari siswa pada panel Usulan tempat PKL.",
      "Di Laporan PKL, buka file siswa lalu klik Periksa untuk menandainya Valid atau Perlu revisi beserta catatan.",
      "Notifikasi merangkum presensi dan laporan baru. Atur jenis notifikasi di Pengaturan. Guru tidak melakukan presensi.",
    ],
  },
  admin: {
    label: "Admin",
    steps: [
      "Pindah halaman lewat menu samping, termasuk bagian Administrasi (Kelola akun, Kelas & guru, Log audit). Menu avatar di kanan atas berisi Profil, Pengaturan, Tutorial, Bantuan, dan Keluar.",
      "Di Kelola akun, buat akun baru (akun siswa hanya untuk NISN yang sudah ada di data siswa), atur ulang password sementara, atau nonaktifkan dan aktifkan akun. Pengguna wajib mengganti password sementara saat login pertama.",
      "Di Kelas & guru, tambah kelas lalu tugaskan guru pembimbing. Atur kelas tiap siswa pada halaman Data siswa.",
      "Log audit mencatat tindakan penting seperti pembuatan akun, reset password, dan validasi laporan. Password tidak pernah dicatat.",
      "Admin dapat melihat seluruh data, mengimpor siswa, dan menyetujui usulan tempat PKL. Admin tidak melakukan presensi dan tidak memvalidasi laporan, karena itu tugas guru pembimbing.",
    ],
  },
};
let tutorialRole = "siswa";

function renderTutorial(role) {
  tutorialRole = role;
  tutorialTabs.innerHTML = Object.entries(tutorials)
    .map(([key, item]) => `<button type="button" role="tab" data-tutorial-role="${key}" aria-selected="${key === role}" tabindex="${key === role ? 0 : -1}">${item.label}</button>`)
    .join("");
  tutorialContent.innerHTML = `<ol>${tutorials[role].steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>`;
}

function openTutorial() {
  const role = currentUser().role;
  renderTutorial(tutorials[role] ? role : "siswa");
  tutorialDialog.showModal();
}

tutorialTabs.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tutorial-role]");
  if (tab) renderTutorial(tab.dataset.tutorialRole);
});
tutorialTabs.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  const keys = Object.keys(tutorials);
  const next = keys[(keys.indexOf(tutorialRole) + (event.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length];
  renderTutorial(next);
  tutorialTabs.querySelector(`[data-tutorial-role="${next}"]`).focus();
});
document.querySelector("#open-tutorial").addEventListener("click", openTutorial);
