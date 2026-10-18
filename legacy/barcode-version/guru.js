// Daftar siswa bimbingan: data demo (belum ada database siswa/guru di proyek ini).
let roster = [
  { nama: "Raka Aditya", nis: "202312047", kelas: "XI RPL 2" },
  { nama: "Nadia Safitri", nis: "202312052", kelas: "XI RPL 2" },
  { nama: "Bima Prasetyo", nis: "202312061", kelas: "XI RPL 1" },
  { nama: "Citra Maharani", nis: "202312068", kelas: "XI TKJ 1" },
  { nama: "Dimas Ardiansyah", nis: "202312075", kelas: "XI TKJ 2" },
];

let latestReports = new Map();

function renderReports() {
  const filter = document.querySelector("#laporan-filter").value;
  const rows = roster.filter((siswa) => {
    const submitted = latestReports.has(siswa.nis);
    return (
      filter === "semua" ||
      (filter === "sudah" && submitted) ||
      (filter === "belum" && !submitted)
    );
  });
  document.querySelector("#laporan-summary").innerHTML =
    `${roster.length} siswa bimbingan · <strong>${latestReports.size} sudah mengumpulkan</strong>`;
  document.querySelector("#laporan-table").innerHTML = rows.length
    ? rows
        .map((siswa) => {
          const report = latestReports.get(siswa.nis);
          const siswaCell = `<td><strong>${escapeHtml(siswa.nama)}</strong><span>NIS ${escapeHtml(siswa.nis)}</span></td>`;
          if (!report)
            return `<tr>${siswaCell}<td>${escapeHtml(siswa.kelas)}</td><td class="muted-text">—</td><td class="muted-text">—</td><td><span class="status-pill outline">Belum mengumpulkan</span></td><td></td></tr>`;
          return `<tr>${siswaCell}<td>${escapeHtml(siswa.kelas)}</td><td><strong>${escapeHtml(report.originalName)}</strong><span>${formatSize(report.size)}</span></td><td>${formatDateTime(report.createdAt)}</td><td><span class="status-pill success">Sudah mengumpulkan</span></td><td><a class="table-link" href="/reports/${encodeURIComponent(report.filename)}" target="_blank" rel="noopener">Buka file</a></td></tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="empty-state">Tidak ada siswa pada filter ini.</td></tr>`;
}

async function loadReports() {
  try {
    const reports = await fetchJson("/api/laporan-pkl"); // terbaru di atas
    latestReports = new Map();
    reports.forEach((report) => {
      if (!latestReports.has(report.nis)) latestReports.set(report.nis, report);
    });
    renderReports();
  } catch {
    document.querySelector("#laporan-table").innerHTML =
      `<tr><td colspan="6" class="empty-state">${serverHint}</td></tr>`;
  }

  async function loadRoster() {
    try {
      roster = await fetchJson("/api/students");
      renderReports();
    } catch {
      /* static fallback is used when the server is unavailable */
    }
  }
}

async function loadAttendance() {
  const body = document.querySelector("#presensi-table");
  try {
    const nisList = roster.map((siswa) => siswa.nis);
    const logs = (await fetchJson("/api/attendance-log")).filter((entry) =>
      nisList.includes(entry.nis),
    );
    body.innerHTML = logs.length
      ? logs
          .map(
            (entry) =>
              `<tr><td><strong>${entry.date}</strong><span>${entry.time}</span></td><td><strong>${escapeHtml(entry.nama)}</strong><span>NIS ${escapeHtml(entry.nis)}</span></td><td>${escapeHtml(entry.kelas)}</td><td>${entry.type === "pulang" ? "Pulang" : "Masuk"}</td><td>${statusPill(entry.status)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="5" class="empty-state">Belum ada presensi tercatat.</td></tr>`;
  } catch {
    body.innerHTML = `<tr><td colspan="5" class="empty-state">${serverHint}</td></tr>`;
  }
}

document
  .querySelector("#laporan-filter")
  .addEventListener("change", renderReports);
loadRoster().then(loadReports);
loadAttendance();
