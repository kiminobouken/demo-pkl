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