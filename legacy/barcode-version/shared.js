// Utilitas bersama untuk halaman guru dan admin.
const navItems = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");
const pageBreadcrumb = document.querySelector("#page-breadcrumb");
const viewTitles = {
  laporan: "Laporan masuk",
  presensi: "Presensi siswa",
  koreksi: "Koreksi presensi",
};

function setView(name) {
  navItems.forEach((item) =>
    item.classList.toggle("active", item.dataset.view === name),
  );
  views.forEach((view) =>
    view.classList.toggle("active", view.id === `${name}-view`),
  );
  pageBreadcrumb.textContent = viewTitles[name] || name;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
navItems.forEach((item) =>
  item.addEventListener("click", () => setView(item.dataset.view)),
);
document
  .querySelector(".logout-button")
  .addEventListener("click", () => (window.location.href = "login.html"));

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}
function formatDateTime(iso) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function formatSize(bytes) {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
const statusClasses = {
  Hadir: "success",
  Terlambat: "warning",
  Alpha: "danger",
  Pulang: "info",
};
function statusPill(status) {
  return `<span class="status-pill ${statusClasses[status] || "neutral"}">${escapeHtml(status)}</span>`;
}
function showToast(title, detail, duration = 3200) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.querySelector("strong").textContent = title;
  toast.querySelector("small").textContent = detail;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), duration);
}
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("request failed");
  return response.json();
}
const serverHint = "Data tidak dapat dimuat. Jalankan dengan: node server.js";
