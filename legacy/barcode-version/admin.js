const statusOptions = ["Hadir", "Terlambat", "Alpha", "Pulang"];

function rowMarkup(entry) {
  const options = statusOptions
    .map(
      (status) =>
        `<option${status === entry.status ? " selected" : ""}>${status}</option>`,
    )
    .join("");
  return `<tr data-id="${escapeHtml(entry.id)}"><td><strong>${entry.date}</strong><span>${entry.time || "—"}</span></td><td><strong>${escapeHtml(entry.nama)}</strong><span>NIS ${escapeHtml(entry.nis)}</span></td><td>${escapeHtml(entry.kelas)}</td><td>${entry.type === "pulang" ? "Pulang" : entry.type === "alpha" ? "—" : "Masuk"}</td><td class="status-cell">${statusPill(entry.status)}${entry.corrected ? `<span class="corrected-note">dikoreksi dari ${escapeHtml(entry.previousStatus || "nilai asli")}</span>` : ""}</td><td><select class="correction-select" aria-label="Koreksi status">${options}</select><input class="correction-reason" maxlength="500" placeholder="Alasan (opsional)" aria-label="Alasan koreksi"></td></tr>`;
}

async function loadAttendance() {
  const body = document.querySelector("#koreksi-table");
  try {
    const logs = await fetchJson("/api/attendance-log");
    body.innerHTML = logs.length
      ? logs.map(rowMarkup).join("")
      : `<tr><td colspan="6" class="empty-state">Belum ada presensi tercatat.</td></tr>`;
  } catch {
    body.innerHTML = `<tr><td colspan="6" class="empty-state">${serverHint}</td></tr>`;
  }
}

document.querySelector("#koreksi-table").addEventListener("change", async (event) => {
  const select = event.target.closest(".correction-select");
  if (!select) return;
  const row = select.closest("tr");
  try {
    const response = await fetch("/api/attendance-correction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.dataset.id, status: select.value, reason: row.querySelector(".correction-reason")?.value || "" }),
    });
    if (!response.ok) throw new Error("failed");
    row.querySelector(".status-cell").innerHTML =
      `${statusPill(select.value)}<span class="corrected-note">dikoreksi</span>`;
    showToast("Status presensi dikoreksi", `Diubah menjadi ${select.value}`);
  } catch {
    showToast("Koreksi gagal disimpan", "Muat ulang halaman lalu coba lagi.");
    loadAttendance();
  }
});

document.querySelector("#admin-password-reset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector("#admin-password-reset-status");
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const response = await fetch(`/api/users/${encodeURIComponent(document.querySelector("#reset-user-id").value.trim())}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.querySelector("#reset-user-password").value }),
    });
    const result = await response.json();
    if (!response.ok) {
      status.textContent = result.message || "Password tidak dapat direset.";
      return;
    }
    form.reset();
    status.textContent = "Password direset. Pengguna wajib mengganti password saat login berikutnya.";
  } catch {
    status.textContent = "Tidak dapat menghubungi server. Coba lagi.";
  } finally {
    button.disabled = false;
  }
});

loadAttendance();
