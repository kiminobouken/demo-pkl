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
    "Terlambat",
    "Sekolah",
    "Terlambat 16 menit",
  ],
  ["Rabu, 09 Okt", "07:31", "16:02", "Hadir", "Perusahaan", "Tepat waktu"],
  ["Selasa, 08 Okt", "07:36", "16:08", "Hadir", "Perusahaan", "Tepat waktu"],
  ["Senin, 07 Okt", "07:29", "16:00", "Hadir", "Perusahaan", "Tepat waktu"],
];

const navItems = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");
const pageBreadcrumb = document.querySelector("#page-breadcrumb");
const titles = {
  dashboard: "Dashboard",
  rekap: "Rekap presensi",
  laporan: "Laporan PKL",
  siswa: "Data siswa",
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
  const statusClass = row[3] === "Terlambat" ? "warning" : "success";
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

// Identitas siswa demo (sama dengan profil yang tampil di dashboard).
let student = { nama: "Raka Aditya", nis: "202312047", kelas: "XI RPL 2" };

async function loadStudentProfile() {
  const response = await fetch("/api/session");
  if (!response.ok) return;
  const session = await response.json();
  if (session.user?.role === "siswa") student.nis = session.user.id;
}

const toast = document.querySelector("#toast");
function showToast(title, detail, duration = 4200) {
  toast.querySelector("strong").textContent = title;
  toast.querySelector("small").textContent = detail;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), duration);
}

document
  .querySelector(".logout-button")
  .addEventListener("click", async () => {
    try {
      const response = await fetch("/api/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout ditolak server.");
      window.location.href = "login.html";
    } catch {
      showToast("Logout gagal", "Sesi belum dapat diakhiri. Coba lagi.");
    }
  });

/* ---------- Presensi: scan barcode kartu siswa ---------- */
const modal = document.querySelector("#qr-modal");
const cameraFrame = document.querySelector("#camera-frame");
const cameraStatus = document.querySelector("#camera-status");
const scanResult = document.querySelector("#scan-result");
const saveButton = document.querySelector("#save-attendance");
const video = document.querySelector("#camera-preview");
const photoCanvas = document.querySelector("#attendance-photo");
const captureTime = document.querySelector("#capture-time");
const captureLocation = document.querySelector("#capture-location");
const captureCoordinates = document.querySelector("#capture-coordinates");
let cameraStream;
let scanTimer;
let zxingReader;
let scannedCode;
let attendanceLocation;
let locationRequest;
let locationRequestId = 0;
let captureTimestamp;

function setScanResult(text, state) {
  scanResult.classList.toggle("shared", state === "ok");
  scanResult.classList.toggle("error", state === "error");
  scanResult.innerHTML = `<i></i><span>${text}</span>`;
}

function stopCamera() {
  clearInterval(scanTimer);
  scanTimer = undefined;
  zxingReader?.reset();
  zxingReader = undefined;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
  cameraFrame.classList.remove("camera-active");
  video.srcObject = null;
}

function resetModal() {
  stopCamera();
  scannedCode = undefined;
  attendanceLocation = undefined;
  locationRequestId += 1;
  locationRequest = undefined;
  captureTimestamp = undefined;
  cameraFrame.classList.remove("code-read");
  cameraFrame.classList.remove("photo-captured");
  cameraStatus.textContent = "Kamera belum diaktifkan";
  captureTime.textContent = "Belum diambil";
  captureLocation.textContent = "Belum diminta";
  captureCoordinates.textContent = "-";
  document.querySelector("#manual-code").value = "";
  setScanResult("Belum ada barcode terbaca");
  saveButton.disabled = true;
  saveButton.textContent = "Simpan presensi";
}

function updateSaveReadiness() {
  saveButton.disabled = !scannedCode || !attendanceLocation || !captureTimestamp;
}

function requestLocation(force = false) {
  if (attendanceLocation && !force) return Promise.resolve(true);
  if (locationRequest) return locationRequest;
  if (!navigator.geolocation) {
    captureLocation.textContent = "Geolokasi tidak didukung browser";
    return Promise.resolve(false);
  }

  const requestId = ++locationRequestId;
  captureLocation.textContent = "Meminta izin lokasi...";
  locationRequest = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (requestId !== locationRequestId) return resolve(false);
        attendanceLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        captureLocation.textContent = `Didapat (akurasi sekitar ${Math.round(attendanceLocation.accuracy)} m)`;
        captureCoordinates.textContent = `${attendanceLocation.latitude.toFixed(6)}, ${attendanceLocation.longitude.toFixed(6)}`;
        updateSaveReadiness();
        resolve(true);
      },
      (error) => {
        if (requestId !== locationRequestId) return resolve(false);
        attendanceLocation = undefined;
        captureLocation.textContent =
          error.code === error.PERMISSION_DENIED
            ? "Izin lokasi ditolak"
            : "Lokasi tidak tersedia";
        captureCoordinates.textContent = "-";
        updateSaveReadiness();
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }).finally(() => {
    if (requestId === locationRequestId) locationRequest = undefined;
  });
  return locationRequest;
}

function capturePhoto() {
  if (!video.videoWidth || !video.videoHeight) return false;
  const scale = Math.min(1, 1280 / video.videoWidth);
  photoCanvas.width = Math.round(video.videoWidth * scale);
  photoCanvas.height = Math.round(video.videoHeight * scale);
  const context = photoCanvas.getContext("2d");
  if (!context) return false;
  context.drawImage(video, 0, 0, photoCanvas.width, photoCanvas.height);
  cameraFrame.classList.add("photo-captured");
  return true;
}

function closeModal() {
  modal.classList.remove("open");
  resetModal();
}

document.querySelector("#open-qr").addEventListener("click", () => {
  resetModal();
  modal.classList.add("open");
});
document.querySelector("#close-qr").addEventListener("click", closeModal);
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

// Barcode pada kartu siswa diasumsikan berisi NIS.
function handleCode(rawValue) {
  const code = String(rawValue || "").trim();
  if (!code || code === scannedCode) return;
  cameraFrame.classList.add("code-read");
  document.querySelector("#manual-code").value = code;
  if (code !== student.nis) {
    stopCamera();
    scannedCode = undefined;
    saveButton.disabled = true;
    cameraStatus.textContent = "Barcode terbaca, tetapi bukan kartu kamu";
    setScanResult(`Barcode ${code} tidak cocok dengan akun ini`, "error");
    return;
  }
  capturePhoto();
  stopCamera();
  scannedCode = code;
  captureTimestamp = new Date().toISOString();
  captureTime.textContent = new Date(captureTimestamp).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  cameraStatus.textContent = "Barcode kartu siswa terbaca";
  setScanResult(`Barcode terbaca · ${code}`, "ok");
  updateSaveReadiness();
  if (!attendanceLocation) requestLocation();
}

async function startScanning() {
  requestLocation();
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = "Kamera tidak tersedia di browser ini";
    return;
  }
  cameraFrame.classList.remove("code-read");
  cameraStatus.textContent = "Membuka kamera...";
  try {
    if ("BarcodeDetector" in window) {
      const formats = await BarcodeDetector.getSupportedFormats();
      const detector = new BarcodeDetector({ formats });
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      video.srcObject = cameraStream;
      cameraFrame.classList.add("camera-active");
      cameraStatus.textContent = "Arahkan barcode kartu siswa ke kamera";
      scanTimer = setInterval(async () => {
        if (!video.videoWidth) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) handleCode(codes[0].rawValue);
        } catch {
          /* frame belum siap */
        }
      }, 300);
    } else if (window.ZXing) {
      zxingReader = new ZXing.BrowserMultiFormatReader();
      cameraFrame.classList.add("camera-active");
      cameraStatus.textContent = "Arahkan barcode kartu siswa ke kamera";
      zxingReader.decodeFromConstraints(
        { video: { facingMode: "environment" }, audio: false },
        video,
        (result) => {
          if (result) handleCode(result.getText());
        },
      );
    } else {
      cameraStatus.textContent =
        "Scanner tidak didukung · gunakan kode manual di bawah";
    }
  } catch (error) {
    stopCamera();
    cameraStatus.textContent =
      error.name === "NotAllowedError"
        ? "Izin kamera ditolak"
        : "Kamera tidak dapat digunakan";
  }
}

document.querySelector("#enable-camera").addEventListener("click", startScanning);
document
  .querySelector("#retry-location")
  .addEventListener("click", () => requestLocation(true));
document.querySelector("#submit-manual").addEventListener("click", () => {
  handleCode(document.querySelector("#manual-code").value);
});
document.querySelector("#manual-code").addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleCode(event.target.value);
});

saveButton.addEventListener("click", async () => {
  if (!scannedCode) return;
  saveButton.disabled = true;
  saveButton.textContent = "Menyimpan presensi...";
  try {
    const response = await fetch("/api/attendance-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: scannedCode,
        nis: student.nis,
        metadata: { capturedAt: captureTimestamp, ...attendanceLocation },
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      saveButton.textContent = "Simpan presensi";
      updateSaveReadiness();
      setScanResult(result.message || "Presensi gagal disimpan", "error");
      return;
    }
    closeModal();
    const label = result.type === "pulang" ? "pulang" : "masuk";
    showToast(
      `Presensi ${label} berhasil dicatat`,
      `Jam ${result.time} · Barcode kartu terverifikasi`,
    );
    loadAttendanceHistory();
  } catch {
    saveButton.disabled = false;
    saveButton.textContent = "Simpan presensi";
    setScanResult(
      "Server tidak terjangkau. Jalankan dengan: node server.js",
      "error",
    );
  }
});

async function loadAttendanceHistory() {
  const response = await fetch("/api/my-attendance");
  if (!response.ok) return;
  const rows = (await response.json())
    .filter((entry) => entry.nis === student.nis)
    .map((entry) => [
      entry.date,
      entry.type === "masuk" ? entry.time || "—" : "—",
      entry.type === "pulang" ? entry.time || "—" : "—",
      entry.status,
      "Perusahaan",
      entry.corrected ? "Dikoreksi admin" : entry.status === "Alpha" ? "Tidak ada scan" : "Presensi tercatat",
    ]);
  renderFullTable(rows);
}
loadStudentProfile().then(loadAttendanceHistory).catch(() => {});

/* ---------- Laporan PKL: unggah soft copy ---------- */
const laporanInput = document.querySelector("#laporan-input");
const laporanZone = document.querySelector("#laporan-zone");
const laporanSelected = document.querySelector("#laporan-selected");
const maxReportBytes = 10 * 1024 * 1024;
let pendingReport;

const formatSize = (bytes) =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const formatDateTime = (iso) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function resetLaporanForm() {
  pendingReport = undefined;
  laporanInput.value = "";
  laporanSelected.hidden = true;
  laporanZone.hidden = false;
}

async function loadLaporanHistory() {
  const body = document.querySelector("#laporan-table");
  try {
    const response = await fetch("/api/laporan-pkl");
    const reports = (await response.json()).filter(
      (item) => item.nis === student.nis,
    );
    body.innerHTML = reports.length
      ? reports
          .map(
            (item) =>
              `<tr><td><strong>${escapeHtml(item.originalName)}</strong></td><td>${formatDateTime(item.createdAt)}</td><td>${formatSize(item.size)}</td><td><a class="table-link" href="/reports/${encodeURIComponent(item.filename)}" target="_blank" rel="noopener">Buka</a></td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4" class="empty-state">Belum ada laporan yang dikirim.</td></tr>`;
  } catch {
    body.innerHTML = `<tr><td colspan="4" class="empty-state">Riwayat tidak dapat dimuat. Jalankan dengan: node server.js</td></tr>`;
  }
}

function pickLaporan() {
  laporanInput.click();
}
document.querySelector("#pick-laporan").addEventListener("click", pickLaporan);
document.querySelector("#change-laporan").addEventListener("click", pickLaporan);

laporanInput.addEventListener("change", () => {
  const file = laporanInput.files[0];
  if (!file) return;
  if (!/\.(pdf|docx?)$/i.test(file.name)) {
    showToast("Format file tidak didukung", "Gunakan PDF, DOC, atau DOCX.");
    laporanInput.value = "";
    return;
  }
  if (file.size > maxReportBytes) {
    showToast("File terlalu besar", "Ukuran maksimal laporan 10 MB.");
    laporanInput.value = "";
    return;
  }
  pendingReport = file;
  document.querySelector("#laporan-name").textContent = file.name;
  document.querySelector("#laporan-size").textContent = formatSize(file.size);
  laporanZone.hidden = true;
  laporanSelected.hidden = false;
});

document.querySelector("#send-laporan").addEventListener("click", async () => {
  if (!pendingReport) return;
  const button = document.querySelector("#send-laporan");
  button.disabled = true;
  button.textContent = "Mengirim...";
  try {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(pendingReport);
    });
    const response = await fetch("/api/laporan-pkl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...student, fileName: pendingReport.name, data }),
    });
    if (!response.ok) throw new Error("upload failed");
    resetLaporanForm();
    showToast("Laporan berhasil dikirim", "Guru pembimbing dapat melihat file ini.");
    loadLaporanHistory();
  } catch {
    showToast(
      "Laporan belum terkirim",
      "Pastikan server berjalan: node server.js",
    );
  } finally {
    button.disabled = false;
    button.textContent = "Kirim laporan";
  }
});
loadLaporanHistory();

document.querySelector("#show-location").addEventListener("click", () => {
  showToast(
    "Lokasi perusahaan terverifikasi",
    "PT. Kreasi Digital Nusantara · Serpong",
    3200,
  );
});

document
  .querySelectorAll(".toggle")
  .forEach((toggle) =>
    toggle.addEventListener("click", () => toggle.classList.toggle("on")),
  );
