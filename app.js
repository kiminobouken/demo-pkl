const attendanceRows = [
  [
    "Senin, 14 Okt",
    "07:28",
    "—",
    "Hadir",
    "Perusahaan",
    "Presensi masuk tercatat",
  ],
  ["Jumat, 11 Okt", "07:42", "16:05", "Hadir", "Perusahaan", "Tepat waktu"],
  [
    "Kamis, 10 Okt",
    "08:16",
    "16:11",
    "Sakit",
    "Sekolah",
    "Surat keterangan sakit diterima",
  ],
  ["Rabu, 09 Okt", "07:31", "16:02", "Hadir", "Perusahaan", "Tepat waktu"],
  ["Selasa, 08 Okt", "07:36", "16:08", "Hadir", "Perusahaan", "Tepat waktu"],
  ["Senin, 07 Okt", "07:29", "16:00", "Hadir", "Perusahaan", "Tepat waktu"],
];

const loginScreen = document.querySelector("#login-screen");
const appShell = document.querySelector("#app-shell");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const loginPassword = document.querySelector("#login-password");
const themeOptions = document.querySelectorAll(".theme-option");

function applyTheme(theme) {
  const selectedTheme = ["garden", "ocean", "terracotta"].includes(theme) ? theme : "garden";
  document.documentElement.dataset.theme = selectedTheme;
  themeOptions.forEach((option) => {
    option.setAttribute("aria-pressed", option.dataset.theme === selectedTheme);
  });
}

applyTheme(localStorage.getItem("presensi-theme"));
themeOptions.forEach((option) =>
  option.addEventListener("click", () => {
    const theme = option.dataset.theme;
    localStorage.setItem("presensi-theme", theme);
    applyTheme(theme);
  }),
);

function setAuthenticated(authenticated, animate = false) {
  loginScreen.classList.toggle("authenticated", authenticated);
  appShell.classList.toggle("authenticated", authenticated);
  document.body.classList.toggle("logged-in", authenticated);
  if (animate) {
    loginScreen.classList.toggle("is-exiting", authenticated);
    appShell.classList.toggle("is-entering", authenticated);
    window.setTimeout(() => {
      loginScreen.classList.remove("is-exiting");
      appShell.classList.remove("is-entering");
    }, 480);
  }
}

if (sessionStorage.getItem("presensi-authenticated") === "true") {
  setAuthenticated(true, true);
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  sessionStorage.setItem("presensi-authenticated", "true");
  loginError.textContent = "";
  setAuthenticated(true);
});

document.querySelector("#toggle-password").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const isPassword = loginPassword.type === "password";
  loginPassword.type = isPassword ? "text" : "password";
  button.setAttribute("aria-label", isPassword ? "Sembunyikan password" : "Tampilkan password");
  button.title = isPassword ? "Sembunyikan password" : "Tampilkan password";
});

document.querySelector("#logout-button").addEventListener("click", () => {
  sessionStorage.removeItem("presensi-authenticated");
  loginForm.reset();
  setAuthenticated(false);
  document.querySelector("#login-role").focus();
});

const navItems = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");
const pageBreadcrumb = document.querySelector("#page-breadcrumb");
const titles = {
  dashboard: "Dashboard",
  rekap: "Rekap presensi",
  siswa: "Data siswa",
  laporan: "Laporan PKL",
  pengaturan: "Pengaturan",
};

function setView(name) {
  navItems.forEach((item) =>
    item.classList.toggle("active", item.dataset.view === name),
  );
  views.forEach((view) =>
    view.classList.toggle("active", view.id === `${name}-view`),
  );
  pageBreadcrumb.textContent = titles[name];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

navItems.forEach((item) =>
  item.addEventListener("click", () => setView(item.dataset.view)),
);
document.querySelectorAll("[data-view-link]").forEach((link) =>
  link.addEventListener("click", (event) => {
    event.preventDefault();
    setView(link.dataset.viewLink);
  }),
);

function rowMarkup(row) {
  const statusClass = row[3] === "Sakit" ? "sick" : row[3] === "Tidak hadir" ? "absent" : "success";
  const locationClass = row[4] === "Sekolah" ? "school" : "";
  return `<tr><td><strong>${row[0]}</strong><span>2024</span></td><td>${row[1]}</td><td class="${row[2] === "—" ? "muted-text" : ""}">${row[2]}</td><td><span class="status-pill ${statusClass}">${row[3]}</span></td><td><span class="location-dot ${locationClass}"></span>${row[4]}</td><td>${row[5]}</td></tr>`;
}

function renderFullTable(rows = attendanceRows) {
  document.querySelector("#full-table").innerHTML = rows
    .map(rowMarkup)
    .join("");
}
renderFullTable();

document.querySelector("#status-filter").addEventListener("change", (event) => {
  const selected = event.target.value;
  renderFullTable(
    selected === "Semua status"
      ? attendanceRows
      : attendanceRows.filter((row) => row[3] === selected),
  );
});

const reportForm = document.querySelector("#report-form");
const reportFile = document.querySelector("#report-file");
const reportFileName = document.querySelector("#report-file-name");
const uploadError = document.querySelector("#upload-error");
const reportStatus = document.querySelector("#report-status");
const reportEmpty = document.querySelector("#report-empty");
const allowedReportTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const maxReportSize = 10 * 1024 * 1024;

reportFile.addEventListener("change", () => {
  const file = reportFile.files[0];
  reportFileName.textContent = file ? file.name : "Belum ada file dipilih";
  uploadError.textContent = "";
});

reportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const file = reportFile.files[0];
  if (!file) return;
  if (!allowedReportTypes.includes(file.type) || !/\.(pdf|docx?)$/i.test(file.name)) {
    uploadError.textContent = "Format file harus PDF, DOC, atau DOCX.";
    return;
  }
  if (file.size > maxReportSize) {
    uploadError.textContent = "Ukuran file maksimal 10 MB.";
    return;
  }
  const reader = new FileReader();
  const button = document.querySelector("#upload-report");
  button.disabled = true;
  button.textContent = "Mengupload laporan...";
  reader.onload = async () => {
    try {
      const response = await fetch("/api/report-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, type: file.type, data: reader.result }),
      });
      if (!response.ok) throw new Error("upload failed");
      reportStatus.textContent = "Menunggu pemeriksaan";
      reportStatus.className = "status-pill warning";
      reportEmpty.innerHTML = `<div class="report-file-row"><span class="file-badge">${file.name.split(".").pop().toUpperCase()}</span><div><strong>${file.name}</strong><small>Baru saja diupload · Menunggu pemeriksaan pembimbing</small></div></div>`;
      uploadError.textContent = "";
      reportForm.reset();
      reportFileName.textContent = "Belum ada file dipilih";
    } catch {
      uploadError.textContent = "Laporan belum berhasil diupload. Pastikan server lokal sedang berjalan.";
    } finally {
      button.disabled = false;
      button.innerHTML = "Upload laporan <span>↥</span>";
    }
  };
  reader.onerror = () => {
    uploadError.textContent = "File tidak dapat dibaca oleh browser.";
    button.disabled = false;
    button.innerHTML = "Upload laporan <span>↥</span>";
  };
  reader.readAsDataURL(file);
});

const modal = document.querySelector("#qr-modal");
let cameraStream;
let currentLocation;
let capturedPhoto;
document
  .querySelector("#open-qr")
  .addEventListener("click", () => modal.classList.add("open"));
const stopCamera = () => {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
  document.querySelector("#camera-frame").classList.remove("camera-active");
  document.querySelector("#camera-preview").srcObject = null;
};
const closeModal = () => {
  modal.classList.remove("open");
  stopCamera();
  capturedPhoto = undefined;
  currentLocation = undefined;
  document.querySelector("#camera-frame").classList.remove("photo-captured");
  document.querySelector("#capture-face").disabled = true;
  const saveButton = document.querySelector("#save-attendance");
  saveButton.disabled = true;
  saveButton.textContent = "Simpan presensi";
};
document.querySelector("#close-qr").addEventListener("click", closeModal);
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

document.querySelector("#enable-camera").addEventListener("click", async () => {
  const status = document.querySelector("#camera-status");
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = "Kamera tidak tersedia di browser ini";
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    document.querySelector("#camera-preview").srcObject = cameraStream;
    document.querySelector("#camera-frame").classList.add("camera-active");
    document.querySelector("#capture-face").disabled = false;
    status.textContent = "Kamera aktif · posisikan wajah di dalam bingkai";
  } catch (error) {
    status.textContent =
      error.name === "NotAllowedError"
        ? "Izin kamera ditolak"
        : "Kamera tidak dapat digunakan";
  }
});

document.querySelector("#capture-face").addEventListener("click", () => {
  const video = document.querySelector("#camera-preview");
  const canvas = document.querySelector("#face-capture");
  if (!video.videoWidth) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  capturedPhoto = canvas.toDataURL("image/jpeg", 0.88);
  document.querySelector("#camera-frame").classList.add("photo-captured");
  document.querySelector("#camera-status").textContent =
    "Foto wajah siap disimpan";
  document.querySelector("#save-attendance").disabled = false;
  stopCamera();
});

document.querySelector("#share-location").addEventListener("click", () => {
  const status = document.querySelector("#location-status");
  if (!navigator.geolocation) {
    status.innerHTML = "<i></i><span>Browser tidak mendukung lokasi</span>";
    return;
  }
  status.innerHTML = "<i></i><span>Mengambil lokasi perangkat...</span>";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const accuracy = Math.round(position.coords.accuracy);
      currentLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy,
      };
      status.classList.add("shared");
      status.innerHTML = `<i></i><span>Lokasi dibagikan · akurasi ±${accuracy} m</span>`;
    },
    (error) => {
      status.classList.remove("shared");
      status.innerHTML = `<i></i><span>${error.code === 1 ? "Izin lokasi ditolak" : "Lokasi belum tersedia"}</span>`;
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

document
  .querySelector("#save-attendance")
  .addEventListener("click", async () => {
    if (!capturedPhoto) return;
    const button = document.querySelector("#save-attendance");
    button.disabled = true;
    button.textContent = "Menyimpan foto...";
    try {
      const response = await fetch("/api/attendance-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: capturedPhoto,
          location: currentLocation,
        }),
      });
      if (!response.ok) throw new Error("save failed");
      closeModal();
      const toast = document.querySelector("#toast");
      toast.querySelector("strong").textContent =
        "Presensi dan foto berhasil disimpan";
      toast.querySelector("small").textContent =
        "Foto tersimpan di folder images";
      toast.classList.add("show");
      document.querySelector("#present-count").textContent = "23";
      document.querySelector("#attendance-rate").textContent = "100%";
      setTimeout(() => toast.classList.remove("show"), 4200);
    } catch {
      button.disabled = false;
      button.textContent = "Simpan presensi";
      alert(
        "Foto belum tersimpan. Jalankan aplikasi melalui server lokal dengan: node server.js",
      );
    }
  });

document.querySelector("#open-qr").addEventListener("click", () => {
  document.querySelector("#camera-status").textContent =
    "Kamera belum diaktifkan";
  const locationStatus = document.querySelector("#location-status");
  locationStatus.classList.remove("shared");
  locationStatus.innerHTML = "<i></i><span>Lokasi belum dibagikan</span>";
});

document.querySelector("#show-location").addEventListener("click", () => {
  const toast = document.querySelector("#toast");
  toast.classList.add("show");
  toast.querySelector("strong").textContent = "Lokasi perusahaan terverifikasi";
  toast.querySelector("small").textContent =
    "PT. Kreasi Digital Nusantara · Serpong";
  setTimeout(() => toast.classList.remove("show"), 3200);
});

document
  .querySelectorAll(".toggle")
  .forEach((toggle) =>
    toggle.addEventListener("click", () => toggle.classList.toggle("on")),
  );
