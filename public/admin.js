// Admin-only pages: accounts, classes, audit log. The server enforces admin access on every endpoint.

let adminUsers = [];
let auditLogs = [];
const adminUserStatus = document.querySelector("#admin-user-status");
const adminClassStatus = document.querySelector("#admin-class-status");
const tempPasswordDialog = document.querySelector("#temp-password-dialog");
const tempPasswordForm = document.querySelector("#temp-password-form");
const roleLabels = { siswa: "Siswa", guru: "Guru", admin: "Admin" };

function generatePassword() {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
}

async function adminRequest(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Permintaan gagal.");
  return result;
}

function adminError(error) {
  return error instanceof TypeError ? "Server tidak dapat dihubungi." : error.message;
}

// ---- Accounts
async function loadAdminUsers() {
  try {
    adminUsers = await adminRequest("GET", "/api/users");
  } catch {
    adminUsers = [];
  }
  renderAdminUsers();
}

function renderAdminUsers() {
  const self = currentUser().userId;
  document.querySelector("#admin-user-count").textContent = `${adminUsers.length} akun`;
  document.querySelector("#admin-user-table").innerHTML = adminUsers.length
    ? adminUsers.map((user) => {
        const flags = `${user.active ? '<span class="status-pill success">Aktif</span>' : '<span class="status-pill absent">Nonaktif</span>'}${user.mustChangePassword ? ' <span class="status-pill warning">Password sementara</span>' : ""}`;
        const toggle = user.id === self
          ? ""
          : `<button type="button" class="${user.active ? "danger" : ""}" data-user-action="${user.active ? "deactivate" : "activate"}" data-user-id="${escapeHtml(user.id)}">${user.active ? "Nonaktifkan" : "Aktifkan"}</button>`;
        return `<tr><td>${escapeHtml(user.id)}</td><td>${escapeHtml(user.displayName || "-")}</td><td>${escapeHtml(roleLabels[user.role] || user.role)}</td><td>${flags}</td><td><div class="row-actions"><button type="button" data-user-action="reset" data-user-id="${escapeHtml(user.id)}">Atur ulang password</button>${toggle}</div></td></tr>`;
      }).join("")
    : '<tr><td colspan="5">Belum ada akun.</td></tr>';
  renderTeacherAssignments();
}

document.querySelector("#admin-generate-password").addEventListener("click", () => {
  document.querySelector("#admin-user-password").value = generatePassword();
});

document.querySelector("#admin-user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  adminUserStatus.textContent = "Membuat akun...";
  try {
    const id = document.querySelector("#admin-user-id").value.trim();
    await adminRequest("POST", "/api/users", {
      id,
      role: document.querySelector("#admin-user-role").value,
      password: document.querySelector("#admin-user-password").value,
    });
    adminUserStatus.textContent = `Akun ${id} dibuat. Sampaikan password sementara kepada pengguna; ia wajib menggantinya saat login pertama.`;
    event.target.reset();
    await loadAdminUsers();
    await loadAdminAudit(true);
  } catch (error) {
    adminUserStatus.textContent = adminError(error);
  }
});

document.querySelector("#admin-user-table").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-user-action]");
  if (!button) return;
  const id = button.dataset.userId;
  if (button.dataset.userAction === "reset") {
    tempPasswordForm.dataset.userId = id;
    document.querySelector("#temp-password-subject").textContent = `Akun: ${id}. Semua sesi akun ini akan dikeluarkan dan pengguna wajib menggantinya saat login.`;
    document.querySelector("#temp-password-input").value = "";
    document.querySelector("#temp-password-status").textContent = "";
    tempPasswordDialog.showModal();
    return;
  }
  const activate = button.dataset.userAction === "activate";
  if (!activate && !window.confirm(`Nonaktifkan akun ${id}? Pengguna akan keluar dan tidak dapat login.`)) return;
  button.disabled = true;
  try {
    await adminRequest("POST", `/api/users/${encodeURIComponent(id)}/active`, { active: activate });
    adminUserStatus.textContent = `Akun ${id} ${activate ? "diaktifkan" : "dinonaktifkan"}.`;
    await loadAdminUsers();
    await loadAdminAudit(true);
  } catch (error) {
    adminUserStatus.textContent = adminError(error);
    button.disabled = false;
  }
});

document.querySelector("#temp-password-generate").addEventListener("click", () => {
  document.querySelector("#temp-password-input").value = generatePassword();
});
tempPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#temp-password-status");
  const id = tempPasswordForm.dataset.userId;
  const password = document.querySelector("#temp-password-input").value;
  status.textContent = "Menyimpan...";
  try {
    await adminRequest("POST", `/api/users/${encodeURIComponent(id)}/reset-password`, { password });
    tempPasswordDialog.close();
    adminUserStatus.textContent = `Password sementara untuk ${id} disimpan. Sampaikan kepada pengguna.`;
    await loadAdminUsers();
    await loadAdminAudit(true);
  } catch (error) {
    status.textContent = adminError(error);
  }
});

// ---- Classes
function renderAdminClasses() {
  const teachers = adminUsers.filter((user) => user.role === "guru" && user.active);
  document.querySelector("#admin-class-count").textContent = `${classRecords.length} kelas`;
  document.querySelector("#admin-class-table").innerHTML = classRecords.length
    ? classRecords.map((item) => {
        const assignedIds = new Set(item.teachers.map((teacher) => teacher.id));
        const options = teachers
          .filter((teacher) => !assignedIds.has(teacher.id))
          .map((teacher) => `<option value="${escapeHtml(teacher.id)}">${escapeHtml(teacher.displayName || teacher.id)}</option>`)
          .join("");
        const chips = item.teachers.length
          ? item.teachers.map((teacher) => `<span class="chip">${escapeHtml(teacher.displayName)}<button type="button" aria-label="Cabut penugasan ${escapeHtml(teacher.displayName)}" data-remove-teacher="${escapeHtml(teacher.id)}" data-class-id="${item.id}">✕</button></span>`).join("")
          : '<span class="muted-label">Belum ada guru</span>';
        const adder = options
          ? `<div class="row-actions"><select class="chip-select" data-teacher-select="${item.id}" aria-label="Pilih guru untuk ${escapeHtml(item.name)}">${options}</select><button type="button" data-add-teacher="${item.id}">Tambah</button></div>`
          : '<span class="muted-label">Tidak ada guru lain</span>';
        return `<tr><td>${escapeHtml(item.name)}</td><td>${item.studentCount}</td><td>${chips}</td><td>${adder}</td></tr>`;
      }).join("")
    : '<tr><td colspan="4">Belum ada kelas. Tambahkan kelas di atas.</td></tr>';
}

async function refreshClasses() {
  await loadClasses();
  renderAdminClasses();
  await loadTeacherAssignments();
}

document.querySelector("#admin-class-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  adminClassStatus.textContent = "Menambahkan kelas...";
  try {
    const name = document.querySelector("#admin-class-name").value.trim();
    await adminRequest("POST", "/api/classes", { name });
    adminClassStatus.textContent = `Kelas ${name} ditambahkan.`;
    event.target.reset();
    await refreshClasses();
    await loadStudents();
    await loadAdminAudit(true);
  } catch (error) {
    adminClassStatus.textContent = adminError(error);
  }
});

document.querySelector("#admin-class-table").addEventListener("click", async (event) => {
  const add = event.target.closest("[data-add-teacher]");
  const remove = event.target.closest("[data-remove-teacher]");
  try {
    if (add) {
      const classId = add.dataset.addTeacher;
      const select = document.querySelector(`[data-teacher-select="${classId}"]`);
      await adminRequest("POST", `/api/classes/${classId}/teachers`, { teacherId: select.value });
      adminClassStatus.textContent = "Guru ditugaskan ke kelas.";
    } else if (remove) {
      if (!window.confirm("Cabut penugasan guru ini dari kelas? Guru tidak lagi melihat siswa kelas tersebut.")) return;
      await adminRequest("DELETE", `/api/classes/${remove.dataset.classId}/teachers/${encodeURIComponent(remove.dataset.removeTeacher)}`);
      adminClassStatus.textContent = "Penugasan guru dicabut.";
    } else {
      return;
    }
    await refreshClasses();
    await loadAdminAudit(true);
  } catch (error) {
    adminClassStatus.textContent = adminError(error);
  }
});

// ---- Penugasan pembimbing, data guru, dan sesi aktif (digabung dari versi A)
// Guru melihat siswa kelasnya (menu Kelas) ATAU siswa yang ditugaskan langsung di sini.
let teacherDirectory = [];
let teacherAssignments = [];
const assignmentStudent = document.querySelector("#assignment-student");
const assignmentTeacher = document.querySelector("#assignment-teacher");
const assignmentStatus = document.querySelector("#assignment-status");

function syncAssignmentTeacher() {
  const current = teacherAssignments.find((item) => item.studentNisn === assignmentStudent.value);
  assignmentTeacher.value = current ? current.teacherId : "";
}

function renderTeacherAssignments() {
  const teachers = adminUsers.filter((user) => user.role === "guru" && user.active);
  const selected = assignmentStudent.value;
  assignmentStudent.innerHTML = studentRecords.length
    ? studentRecords.map((student) => `<option value="${escapeHtml(student.nisn)}">${escapeHtml(student.name)} · ${escapeHtml(student.nisn)}</option>`).join("")
    : '<option value="">Belum ada siswa</option>';
  if (selected && studentRecords.some((student) => student.nisn === selected)) assignmentStudent.value = selected;
  assignmentTeacher.innerHTML = `<option value="">Tanpa penugasan langsung</option>${teachers
    .map((teacher) => `<option value="${escapeHtml(teacher.id)}">${escapeHtml(teacher.displayName || teacher.id)} · ${escapeHtml(teacher.id)}</option>`)
    .join("")}`;
  syncAssignmentTeacher();
  document.querySelector("#teacher-directory-table").innerHTML = teacherDirectory.length
    ? teacherDirectory.map((teacher) => {
        const account = teacher.accountId
          ? `<span class="status-pill ${teacher.isActive ? "success" : "absent"}">${teacher.isActive ? "Aktif" : "Nonaktif"}</span>`
          : "Belum ada akun";
        return `<tr><td>${escapeHtml(teacher.name)}</td><td>${escapeHtml(teacher.nip)}</td><td>${escapeHtml(teacher.phone || "-")}</td><td>${account}</td><td>${teacher.assignedStudentCount}</td></tr>`;
      }).join("")
    : '<tr><td colspan="5">Master guru belum diimpor. Jalankan <code>node import-teachers.js</code> (lihat README) atau buat akun guru di atas.</td></tr>';
}

async function loadTeacherAssignments() {
  try {
    [teacherDirectory, teacherAssignments] = await Promise.all([
      adminRequest("GET", "/api/teachers"),
      adminRequest("GET", "/api/teacher-assignments"),
    ]);
  } catch {
    teacherDirectory = [];
    teacherAssignments = [];
  }
  renderTeacherAssignments();
}

assignmentStudent.addEventListener("change", syncAssignmentTeacher);
document.addEventListener("presensi:students-loaded", () => {
  if (currentUser().role === "admin") renderTeacherAssignments();
});

document.querySelector("#teacher-assignment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!assignmentStudent.value) {
    assignmentStatus.textContent = "Pilih siswa terlebih dahulu.";
    return;
  }
  assignmentStatus.textContent = "Menyimpan penugasan...";
  try {
    await adminRequest("PUT", "/api/teacher-assignments", {
      studentNisn: assignmentStudent.value,
      teacherId: assignmentTeacher.value,
    });
    assignmentStatus.textContent = "Penugasan pembimbing disimpan.";
    await loadTeacherAssignments();
    await loadAdminAudit(true);
  } catch (error) {
    assignmentStatus.textContent = adminError(error);
  }
});

async function loadActiveSessions() {
  const body = document.querySelector("#active-session-table");
  try {
    const sessions = await adminRequest("GET", "/api/sessions");
    document.querySelector("#active-session-count").textContent = `${sessions.length} sesi`;
    const when = (value) => escapeHtml(new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }));
    body.innerHTML = sessions.length
      ? sessions.map((item) => `<tr><td>${escapeHtml(item.userId)}</td><td>${escapeHtml(roleLabels[item.role] || item.role)}</td><td>${when(item.createdAt)}</td><td>${when(item.expiresAt)}</td></tr>`).join("")
      : '<tr><td colspan="4">Tidak ada sesi aktif.</td></tr>';
  } catch (error) {
    body.innerHTML = `<tr><td colspan="4">${escapeHtml(adminError(error))}</td></tr>`;
  }
}

// ---- Audit log
async function loadAdminAudit(reset = true) {
  const filter = document.querySelector("#audit-action-filter");
  const params = new URLSearchParams({ limit: "100" });
  if (filter.value) params.set("action", filter.value);
  if (!reset && auditLogs.length) params.set("before", String(auditLogs[auditLogs.length - 1].id));
  try {
    const result = await adminRequest("GET", `/api/audit-logs?${params}`);
    auditLogs = reset ? result.logs : [...auditLogs, ...result.logs];
    const selected = filter.value;
    filter.innerHTML = `<option value="">Semua aksi</option>${result.actions.map((action) => `<option value="${escapeHtml(action)}" ${action === selected ? "selected" : ""}>${escapeHtml(action)}</option>`).join("")}`;
    document.querySelector("#audit-more").hidden = result.logs.length < 100;
  } catch {
    auditLogs = [];
  }
  document.querySelector("#audit-table").innerHTML = auditLogs.length
    ? auditLogs.map((log) => `<tr><td>${escapeHtml(new Date(log.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }))}</td><td>${escapeHtml(log.actorId || "-")}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.target || "-")}</td><td class="audit-detail">${escapeHtml(log.detail || "")}</td><td>${escapeHtml(log.ip || "-")}</td></tr>`).join("")
    : '<tr><td colspan="6">Belum ada catatan audit.</td></tr>';
}

document.querySelector("#audit-action-filter").addEventListener("change", () => loadAdminAudit(true));
document.querySelector("#refresh-audit").addEventListener("click", () => {
  loadAdminAudit(true);
  loadActiveSessions();
});
document.querySelector("#audit-more").addEventListener("click", () => loadAdminAudit(false));

async function loadAdminData() {
  await loadAdminUsers();
  renderAdminClasses();
  await loadTeacherAssignments();
  await loadActiveSessions();
  await loadAdminAudit(true);
}

document.addEventListener("presensi:reset", () => {
  adminUsers = [];
  auditLogs = [];
  document.querySelector("#admin-user-table").innerHTML = '<tr><td colspan="5">Memuat akun...</td></tr>';
  document.querySelector("#admin-class-table").innerHTML = '<tr><td colspan="4">Memuat kelas...</td></tr>';
  document.querySelector("#audit-table").innerHTML = '<tr><td colspan="6">Memuat log...</td></tr>';
  adminUserStatus.textContent = "";
  adminClassStatus.textContent = "";
  teacherDirectory = [];
  teacherAssignments = [];
  assignmentStatus.textContent = "";
  document.querySelector("#teacher-directory-table").innerHTML = '<tr><td colspan="5">Memuat master guru...</td></tr>';
  document.querySelector("#active-session-table").innerHTML = '<tr><td colspan="4">Memuat sesi...</td></tr>';
  document.querySelector("#active-session-count").textContent = "0 sesi";
});
