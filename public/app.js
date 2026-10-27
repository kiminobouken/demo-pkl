const loginScreen = document.querySelector("#login-screen");
const appShell = document.querySelector("#app-shell");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const loginPassword = document.querySelector("#login-password");
const themeOptions = document.querySelectorAll(".theme-option");

function applyTheme(theme) {
  const selectedTheme = ["garden", "ocean", "terracotta", "dark"].includes(theme) ? theme : "garden";
  document.documentElement.dataset.theme = selectedTheme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = selectedTheme === "dark" ? "#111923" : "#f4f0e8";
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

let currentStudent = null;
let classRecords = [];
let locationRequests = [];

async function startSession(user, { animate = false } = {}) {
  sessionStorage.setItem("presensi-user", JSON.stringify({ userId: user.id, role: user.role }));
  sessionStorage.setItem("presensi-authenticated", "true");
  document.body.dataset.role = user.role;
  setAuthenticated(true, animate);
  setTeacherControls(user.role);
  renderNotificationSettings();
  updateCurrentUser(user.id, user.role);
  setView("dashboard");
  if (user.mustChangePassword) {
    openPasswordDialog({ forced: true });
    return;
  }
  await loadAppData(user.id, user.role);
}

async function loadAppData(userId, role) {
  await loadPklLocations();
  if (role === "siswa") {
    let student;
    try {
      student = await loadStudentByNisn(userId);
    } catch {
      await endSession("Data siswa belum terdaftar. Hubungi admin atau guru pembimbing.");
      return;
    }
    currentStudent = student;
    updateCurrentUser(userId, role, student);
    await Promise.all([loadAttendanceRecords(), loadReportNotifications(), loadLocationRequests()]);
    if (!student.pklLocationId && !hasSkippedStudentLocation(userId)) {
      await showStudentLocationDialog(student, { forced: true });
    }
    return;
  }
  if (role === "admin") await loadClasses();
  const tasks = [
    loadStudents(),
    loadAttendanceRecords(),
    loadReportNotifications(),
    loadTeacherNotifications(),
    loadLocationRequests(),
    loadTeacherProfile(),
  ];
  if (role === "admin" && typeof loadAdminData === "function") tasks.push(loadAdminData());
  await Promise.all(tasks);
}

function onPasswordChanged() {
  const user = currentUser();
  if (!user.userId) return;
  loadAppData(user.userId, user.role);
}

function clearRenderedData() {
  const placeholders = {
    "#students-table-body": '<tr><td colspan="5">Memuat data siswa...</td></tr>',
    "#full-table": "",
    "#recent-table": '<tr><td colspan="6">Belum ada catatan presensi.</td></tr>',
    "#teacher-report-table": '<tr><td colspan="5" class="empty-state">Memuat laporan...</td></tr>',
    "#notification-list": '<p class="empty-state">Memuat aktivitas...</p>',
    "#today-photo-grid": '<p class="empty-state">Belum ada presensi hari ini.</p>',
    "#location-request-body": '<tr><td colspan="4">Tidak ada usulan yang menunggu.</td></tr>',
  };
  Object.entries(placeholders).forEach(([selector, markup]) => {
    const element = document.querySelector(selector);
    if (element) element.innerHTML = markup;
  });
  document.querySelector("#report-empty").innerHTML = "<span>▤</span><p>Belum ada laporan yang diupload.</p>";
  document.dispatchEvent(new CustomEvent("presensi:reset"));
}

function resetClientState() {
  sessionStorage.removeItem("presensi-authenticated");
  sessionStorage.removeItem("presensi-user");
  document.body.dataset.role = "";
  studentRecords = [];
  attendanceRecords = [];
  attendanceDays = [];
  reportRecords = [];
  serverNotifications = null;
  serverReadNotificationIds = new Set();
  currentStudent = null;
  classRecords = [];
  locationRequests = [];
  pklLocations.length = 0;
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  if (typeof closeAccountMenu === "function") closeAccountMenu();
  clearRenderedData();
}

async function endSession(message = "") {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  resetClientState();
  loginForm.reset();
  setAuthenticated(false);
  loginError.textContent = message;
}

async function restoreSession() {
  try {
    const response = await fetch("/api/session");
    if (!response.ok) {
      resetClientState();
      return;
    }
    const result = await response.json();
    await startSession(result.user, { animate: true });
  } catch {
    resetClientState();
  }
}

restoreSession();

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  const userId = document.querySelector("#login-id").value.trim();
  const selectedRole = document.querySelector("#login-role").value;
  loginError.textContent = "";
  let response;
  let result;
  try {
    response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, password: loginPassword.value }),
    });
    result = await response.json();
  } catch {
    loginError.textContent = "Server tidak dapat dihubungi. Pastikan aplikasi sedang berjalan.";
    return;
  }
  if (!response.ok) {
    loginError.textContent = result.message || "Login gagal.";
    return;
  }
  const role = result.user.role;
  if ((selectedRole === "guru" && role !== "guru") ||
      (selectedRole === "Siswa/Siswi" && role !== "siswa") ||
      (selectedRole === "admin" && role !== "admin")) {
    loginError.textContent = "Peran yang dipilih tidak sesuai dengan akun.";
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    return;
  }
  loginPassword.value = "";
  await startSession(result.user);
});

document.querySelector("#toggle-password").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const isPassword = loginPassword.type === "password";
  loginPassword.type = isPassword ? "text" : "password";
  button.setAttribute("aria-label", isPassword ? "Sembunyikan password" : "Tampilkan password");
  button.title = isPassword ? "Sembunyikan password" : "Tampilkan password";
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  await endSession();
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
  notifikasi: "Notifikasi",
  "profil-guru": "Profil guru",
  pengaturan: "Pengaturan",
  akun: "Kelola akun",
  kelas: "Kelas & guru",
  audit: "Log audit",
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
      character
    ],
  );
}

const studentsTableBody = document.querySelector("#students-table-body");
const studentCount = document.querySelector("#student-count");
const studentCsv = document.querySelector("#student-csv");
const studentImportButton = document.querySelector("#choose-student-csv");
const studentImportStatus = document.querySelector("#student-import-status");
const pklLocations = [];
const pklLocationForm = document.querySelector("#pkl-location-form");
const pklLocationFormStatus = document.querySelector("#pkl-location-form-status");
const studentLocationDialog = document.querySelector("#student-location-dialog");
const studentLocationForm = document.querySelector("#student-location-form");
const studentLocationChoice = document.querySelector("#student-location-choice");
const studentLocationStatus = document.querySelector("#student-location-status");
const saveStudentLocation = document.querySelector("#save-student-location");
const studentOtherLocation = document.querySelector("#student-other-location");
const studentOtherCompany = document.querySelector("#student-other-company");
const studentOtherAddress = document.querySelector("#student-other-address");
let studentRecords = [];
let attendanceRecords = [];
let reportRecords = [];
let serverNotifications = null;
let serverReadNotificationIds = new Set();

function currentUser() {
  try {
    return JSON.parse(sessionStorage.getItem("presensi-user") || "{}");
  } catch {
    return {};
  }
}

function hasSkippedStudentLocation(nisn) {
  return sessionStorage.getItem(`presensi-location-skipped:${nisn}`) === "true";
}

function setTeacherControls(role) {
  const isStaff = role === "guru" || role === "admin";
  document.querySelectorAll("[data-teacher-only]").forEach((element) => {
    element.classList.toggle("teacher-visible", isStaff);
  });
  document.querySelectorAll("[data-student-only]").forEach((element) => {
    element.classList.toggle("student-visible", role === "siswa");
  });
  document.querySelectorAll("[data-roles]").forEach((element) => {
    element.hidden = !element.dataset.roles.split(/\s+/).includes(role);
  });
  document.querySelector("#edit-student-location").classList.toggle(
    "student-visible",
    role === "siswa",
  );
  const isAdmin = role === "admin";
  titles["profil-guru"] = isAdmin ? "Profil admin" : "Profil guru";
  document.querySelector("#profile-nav-label").textContent = titles["profil-guru"];
  document.querySelector("#profile-heading").textContent = titles["profil-guru"];
  document.querySelector("#profile-eyebrow").textContent = isAdmin ? "Akun administrator" : "Akun pembimbing";
  document.querySelector("#profile-role-label").textContent = isAdmin ? "Administrator" : "Guru pembimbing";
  document.querySelector("#rekap-subheading").textContent = role === "siswa"
    ? "Pantau catatan kehadiran PKL kamu dalam satu tampilan."
    : "Pantau kehadiran siswa beserta foto presensinya.";
  if (isStaff) {
    renderTeacherProfile();
    renderNotifications();
  }
}

function updateStudentLocation(student) {
  const assigned = Boolean(student?.pklLocationId);
  const companyName = student?.pklCompanyName || "Lokasi PKL belum dipilih";
  const address = student?.pklAddress || "Pilih lokasi PKL untuk melihat alamat perusahaan.";
  document.querySelector("#pkl-location-status").textContent = assigned ? "Penempatan aktif" : "Belum diatur";
  document.querySelector("#pkl-company-name").textContent = companyName;
  document.querySelector("#pkl-company-address").textContent = address;
  document.querySelector("#profile-pkl-company").textContent = companyName;
  document.querySelector("#profile-pkl-address").textContent = address;
  document.querySelector("#student-profile-placement").textContent = assigned ? "Sudah ditentukan" : "Belum ditentukan";
  document.querySelector("#pkl-location-meta").innerHTML = assigned
    ? `<div><span>Nama siswa</span><strong>${escapeHtml(student.name)}</strong></div><div><span>NISN</span><strong>${escapeHtml(student.nisn)}</strong></div>`
    : "";
}

function updateCurrentUser(userId, role, student = null) {
  const teacherProfile = role === "guru" || role === "admin" ? readTeacherProfile(userId) : null;
  const displayName = student?.name || teacherProfile?.displayName || (role === "guru" || role === "admin" ? userId : "Siswa");
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "SJ";
  document.querySelector("#current-user-name").textContent = displayName;
  document.querySelector("#current-user-role").textContent = role === "guru" ? "Guru" : role === "admin" ? "Admin" : `Siswa · ${student?.nisn || userId}`;
  document.querySelector("#current-user-avatar").textContent = initials;
  document.querySelector("#current-user-mini-avatar").textContent = initials;
  document.querySelector("#workspace-label").textContent = role === "guru" ? "Ruang guru" : role === "admin" ? "Ruang admin" : "Ruang siswa";
  document.querySelector("#welcome-title").textContent = `Selamat datang, ${student?.name?.split(/\s+/)[0] || displayName}.`;
  if (role === "guru" || role === "admin") renderTeacherProfile();
  if (student) {
    currentStudent = student;
    document.querySelector("#student-profile-name").textContent = student.name;
    document.querySelector("#student-profile-role").textContent = "Peserta PKL";
    document.querySelector("#student-profile-nisn").textContent = student.nisn;
    document.querySelector("#student-profile-avatar").textContent = initials;
    updateStudentLocation(student);
  } else if (role === "guru" || role === "admin") {
    document.querySelector("#student-profile-name").textContent = "Data siswa";
    document.querySelector("#student-profile-role").textContent = "Pilih siswa pada daftar untuk mengatur penempatan.";
    document.querySelector("#student-profile-nisn").textContent = "-";
    document.querySelector("#student-profile-avatar").textContent = "SJ";
    updateStudentLocation(null);
  }
}

function teacherProfileStorageKey(userId = currentUser().userId) {
  return `presensi-teacher-profile:${userId || "guru"}`;
}

function readTeacherProfile(userId = currentUser().userId) {
  try {
    return JSON.parse(localStorage.getItem(teacherProfileStorageKey(userId)) || "{}");
  } catch {
    return {};
  }
}

function renderTeacherProfile() {
  if (currentUser().role !== "guru" && currentUser().role !== "admin") return;
  const user = currentUser();
  const profile = readTeacherProfile(user.userId);
  const displayName = profile.displayName || user.userId || "Guru";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "GU";
  document.querySelector("#teacher-profile-display-name").textContent = displayName;
  document.querySelector("#teacher-profile-avatar").textContent = initials;
  document.querySelector("#teacher-profile-name-input").value = displayName;
  document.querySelector("#teacher-profile-id").value = user.userId || "-";
  document.querySelector("#teacher-profile-contact").value = profile.contact || "";
  const profileStatus = document.querySelector("#teacher-profile-status");
  if (profileStatus.dataset.keep !== "true") {
    profileStatus.textContent = profile.displayName || profile.contact
      ? "Profil tersimpan di akun ini."
      : "Belum ada perubahan profil.";
  }
  document.querySelector("#teacher-student-count").textContent = String(studentRecords.length);
  document.querySelector("#teacher-placement-count").textContent = String(
    studentRecords.filter((student) => student.pklLocationId).length,
  );
}

async function loadTeacherProfile() {
  if (currentUser().role !== "guru" && currentUser().role !== "admin") return;
  try {
    const response = await fetch("/api/profile");
    if (!response.ok) throw new Error("Profil belum dapat dimuat.");
    const profile = await response.json();
    localStorage.setItem(teacherProfileStorageKey(), JSON.stringify(profile));
    const user = currentUser();
    updateCurrentUser(user.userId, user.role);
  } catch {
    renderTeacherProfile();
  }
}

document.querySelector("#teacher-profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = currentUser();
  if (user.role !== "guru" && user.role !== "admin") return;
  const profile = {
    displayName: document.querySelector("#teacher-profile-name-input").value.trim(),
    contact: document.querySelector("#teacher-profile-contact").value.trim(),
  };
  if (!profile.displayName) return;
  try {
    const response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Profil belum berhasil disimpan.");
    localStorage.setItem(teacherProfileStorageKey(user.userId), JSON.stringify(result));
    updateCurrentUser(user.userId, user.role);
    const savedStatus = document.querySelector("#teacher-profile-status");
    savedStatus.textContent = "Profil berhasil disimpan.";
    savedStatus.dataset.keep = "true";
  } catch (error) {
    document.querySelector("#teacher-profile-status").textContent = error instanceof TypeError
      ? "Server tidak dapat dihubungi. Profil belum tersimpan."
      : error.message;
  }
});
document.querySelector("#teacher-profile-form").addEventListener("input", () => {
  delete document.querySelector("#teacher-profile-status").dataset.keep;
});

function locationOptionsMarkup(selectedId = "") {
  return pklLocations
    .map((location) => `<option value="${location.id}" ${String(location.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(location.companyName)} · ${escapeHtml(location.address)}</option>`)
    .join("");
}

async function loadPklLocations() {
  try {
    const response = await fetch("/api/pkl-locations");
    if (!response.ok) throw new Error("Daftar lokasi belum dapat dimuat.");
    pklLocations.splice(0, pklLocations.length, ...(await response.json()));
  } catch {
    pklLocations.length = 0;
  }
  studentLocationChoice.innerHTML = `<option value="" selected disabled>${pklLocations.length ? "Pilih tempat PKL" : "Belum ada tempat PKL"}</option>${locationOptionsMarkup()}<option value="other">Usulkan tempat lain...</option>`;
  saveStudentLocation.disabled = true;
}

async function showStudentLocationDialog(student, { forced = false } = {}) {
  await Promise.all([loadPklLocations(), loadLocationRequests()]);
  studentLocationForm.reset();
  studentLocationForm.dataset.nisn = student.nisn;
  studentLocationDialog.dataset.forced = String(forced);
  document.querySelector("#skip-student-location").hidden = !forced;
  document.querySelector("#logout-from-location").hidden = !forced;
  document.querySelector("#close-student-location").hidden = forced;
  document.querySelector("#student-location-title").textContent = forced ? "Pilih lokasi PKL" : "Atur tempat PKL";
  studentLocationChoice.value = student.pklLocationId
    ? String(student.pklLocationId)
    : "";
  studentOtherLocation.hidden = true;
  studentOtherCompany.required = false;
  studentOtherAddress.required = false;
  saveStudentLocation.disabled = !studentLocationChoice.value;
  studentLocationStatus.textContent = "Pilih lokasi yang tersedia atau pilih Tempat lain untuk memasukkan lokasi baru.";
  if (!studentLocationDialog.open) studentLocationDialog.showModal();
}

studentLocationChoice.addEventListener("change", () => {
  const isOther = studentLocationChoice.value === "other";
  studentOtherLocation.hidden = !isOther;
  studentOtherCompany.required = isOther;
  studentOtherAddress.required = isOther;
  saveStudentLocation.disabled = !studentLocationChoice.value;
  studentLocationStatus.textContent = isOther
    ? "Lokasi baru akan ditambahkan dan ditetapkan ke data siswa kamu."
    : "Lokasi ini akan dicatat pada data siswa kamu.";
});

document.querySelector("#edit-student-location").addEventListener("click", async () => {
  const user = currentUser();
  try {
    await showStudentLocationDialog(await loadStudentByNisn(user.userId), { forced: false });
  } catch {
    window.alert("Data siswa belum dapat dimuat. Coba lagi nanti.");
  }
});

async function loadStudentByNisn(nisn) {
  const response = await fetch(`/api/students/${encodeURIComponent(nisn)}`);
  if (!response.ok) throw new Error("Data siswa tidak ditemukan.");
  return response.json();
}

async function loadClasses() {
  try {
    const response = await fetch("/api/classes");
    if (!response.ok) throw new Error("Daftar kelas belum dapat dimuat.");
    classRecords = await response.json();
  } catch {
    classRecords = [];
  }
}

function classOptionsMarkup(selectedId) {
  return `<option value="">Tanpa kelas</option>${classRecords
    .map((item) => `<option value="${item.id}" ${String(item.id) === String(selectedId ?? "") ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
    .join("")}`;
}

async function loadStudents() {
  const role = currentUser().role;
  if (role !== "guru" && role !== "admin") return;
  try {
    const response = await fetch("/api/students");
    if (!response.ok) throw new Error("Tidak dapat memuat data siswa.");
    const students = await response.json();
    studentRecords = students;
    studentCount.textContent = `${students.length} siswa`;
    const emptyMessage = role === "guru"
      ? "Belum ada siswa untuk Anda. Minta admin menugaskan kelas atau siswa kepada Anda, atau impor CSV."
      : "Belum ada data siswa. Impor CSV untuk menambahkan.";
    studentsTableBody.innerHTML = students.length
      ? students
          .map((student) => {
            const placement = `<select class="student-location-select" data-student-location="${escapeHtml(student.nisn)}" aria-label="Tempat PKL ${escapeHtml(student.name)}"><option value="" disabled ${student.pklLocationId ? "" : "selected"}>${pklLocations.length ? "Pilih tempat PKL" : "Lokasi belum tersedia"}</option>${locationOptionsMarkup(student.pklLocationId)}</select>`;
            const classCell = role === "admin"
              ? `<select class="student-location-select" data-student-class="${escapeHtml(student.nisn)}" aria-label="Kelas ${escapeHtml(student.name)}">${classOptionsMarkup(student.classId)}</select>`
              : escapeHtml(student.className || "-");
            return `<tr><td>${escapeHtml(student.name)}</td><td>${escapeHtml(student.nisn)}</td><td>${classCell}</td><td>${escapeHtml(student.parentPhoneMasked || "-")}</td><td>${placement}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="5">${emptyMessage}</td></tr>`;
    renderTeacherProfile();
  } catch {
    studentRecords = [];
    studentsTableBody.innerHTML =
      '<tr><td colspan="5">Data siswa belum dapat dimuat.</td></tr>';
    renderTeacherProfile();
  } finally {
    document.dispatchEvent(new CustomEvent("presensi:students-loaded"));
  }
}

async function loadLocationRequests() {
  try {
    const response = await fetch("/api/pkl-location-requests");
    if (!response.ok) throw new Error("Usulan lokasi belum dapat dimuat.");
    locationRequests = await response.json();
  } catch {
    locationRequests = [];
  }
  renderLocationRequests();
}

function renderLocationRequests() {
  const role = currentUser().role;
  if (role === "siswa") {
    renderStudentLocationRequests();
    return;
  }
  const body = document.querySelector("#location-request-body");
  const pending = locationRequests.filter((item) => item.status === "pending");
  document.querySelector("#location-request-count").textContent = `${pending.length} menunggu`;
  body.innerHTML = pending.length
    ? pending.map((item) => `<tr><td>${escapeHtml(item.studentName)}<br><small>${escapeHtml(item.studentNisn)}</small></td><td>${escapeHtml(item.companyName)}</td><td>${escapeHtml(item.address)}</td><td><div class="row-actions"><button type="button" data-request-id="${item.id}" data-request-action="approve">Setujui</button><button type="button" class="danger" data-request-id="${item.id}" data-request-action="reject">Tolak</button></div></td></tr>`).join("")
    : '<tr><td colspan="4">Tidak ada usulan yang menunggu.</td></tr>';
}

function renderStudentLocationRequests() {
  const container = document.querySelector("#student-location-requests");
  const open = locationRequests.filter((item) => item.status !== "approved").slice(0, 5);
  container.hidden = !open.length;
  container.innerHTML = open.length
    ? `<strong>Usulan tempat PKL kamu</strong>${open.map((item) => `<span>${escapeHtml(item.companyName)} · ${item.status === "pending" ? "menunggu persetujuan" : "ditolak"}</span>`).join("")}`
    : "";
}

document.querySelector("#location-request-body").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-request-action]");
  if (!button) return;
  const status = document.querySelector("#location-request-status");
  button.disabled = true;
  status.textContent = "Memproses usulan...";
  try {
    const response = await fetch(`/api/pkl-location-requests/${encodeURIComponent(button.dataset.requestId)}/${button.dataset.requestAction}`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Usulan belum berhasil diproses.");
    status.textContent = button.dataset.requestAction === "approve"
      ? "Usulan disetujui. Lokasi kini tersedia untuk dipilih siswa."
      : "Usulan ditolak.";
    await loadPklLocations();
    await Promise.all([loadLocationRequests(), loadStudents()]);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});

studentImportButton.addEventListener("click", () => studentCsv.click());
studentCsv.addEventListener("change", async () => {
  const file = studentCsv.files[0];
  if (!file) return;
  if (!/\.csv$/i.test(file.name) || file.size > 2_000_000) {
    studentImportStatus.textContent = "Pilih file CSV maksimal 2 MB.";
    studentCsv.value = "";
    return;
  }

  studentImportButton.disabled = true;
  studentImportStatus.textContent = "Mengimpor data siswa...";
  try {
    const response = await fetch("/api/students/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv; charset=utf-8" },
      body: await file.text(),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Impor gagal.");
    if (currentUser().role === "admin") await loadClasses();
    await loadStudents();
    studentImportStatus.textContent = `Impor selesai: ${result.created} siswa baru, ${result.updated} siswa lama diperbarui. Total: ${result.total}.`;
  } catch (error) {
    studentImportStatus.textContent = error.message || "Impor gagal. Periksa file CSV.";
  } finally {
    studentImportButton.disabled = false;
    studentCsv.value = "";
  }
});

pklLocationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#save-pkl-location");
  button.disabled = true;
  pklLocationFormStatus.textContent = "Menyimpan lokasi...";
  try {
    const response = await fetch("/api/pkl-locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: document.querySelector("#pkl-company-input").value,
        address: document.querySelector("#pkl-address-input").value,
        latitude: document.querySelector("#pkl-latitude-input").value || null,
        longitude: document.querySelector("#pkl-longitude-input").value || null,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Lokasi belum berhasil disimpan.");
    pklLocationForm.reset();
    pklLocationFormStatus.textContent = `${result.location.companyName} berhasil ditambahkan.`;
    await loadPklLocations();
    await loadStudents();
  } catch (error) {
    pklLocationFormStatus.textContent = error.message || "Lokasi belum berhasil disimpan.";
  } finally {
    button.disabled = false;
  }
});

studentsTableBody.addEventListener("change", async (event) => {
  const classSelect = event.target.closest("[data-student-class]");
  if (classSelect && currentUser().role === "admin") {
    studentImportStatus.textContent = "Menyimpan kelas siswa...";
    try {
      const response = await fetch(`/api/students/${encodeURIComponent(classSelect.dataset.studentClass)}/class`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: classSelect.value || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Kelas belum tersimpan.");
      studentImportStatus.textContent = "Kelas siswa berhasil disimpan.";
      await loadClasses();
    } catch (error) {
      studentImportStatus.textContent = error.message || "Kelas belum tersimpan.";
      await loadStudents();
    }
    return;
  }
  const select = event.target.closest("[data-student-location]");
  if (!select || (currentUser().role !== "guru" && currentUser().role !== "admin")) return;
  studentImportStatus.textContent = "Menyimpan penempatan siswa...";
  try {
    const response = await fetch(
      `/api/students/${encodeURIComponent(select.dataset.studentLocation)}/location`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: select.value }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Penempatan belum tersimpan.");
    studentImportStatus.textContent = "Lokasi PKL siswa berhasil disimpan.";
  } catch (error) {
    studentImportStatus.textContent = error.message || "Penempatan belum tersimpan.";
    await loadStudents();
  }
});

studentLocationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nisn = studentLocationForm.dataset.nisn;
  saveStudentLocation.disabled = true;
  studentLocationStatus.textContent = "Menyimpan lokasi PKL...";
  try {
    let locationId = studentLocationChoice.value;
    if (locationId === "other") {
      const companyName = studentOtherCompany.value.trim();
      const address = studentOtherAddress.value.trim();
      if (!companyName || !address) {
        throw new Error("Nama dan alamat tempat PKL wajib diisi.");
      }
      const existingLocation = pklLocations.find(
        (location) =>
          location.companyName.toLocaleLowerCase() === companyName.toLocaleLowerCase() &&
          location.address.toLocaleLowerCase() === address.toLocaleLowerCase(),
      );
      if (existingLocation) {
        locationId = String(existingLocation.id);
      } else {
        const createResponse = await fetch("/api/pkl-location-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyName, address }),
        });
        const createResult = await createResponse.json();
        if (!createResponse.ok) {
          throw new Error(createResult.message || "Lokasi baru belum berhasil ditambahkan.");
        }
        await loadLocationRequests();
        studentLocationDialog.close();
        showToast("Usulan lokasi terkirim", createResult.message || "Menunggu persetujuan guru atau admin.");
        return;
      }
    }
    const response = await fetch(`/api/students/${encodeURIComponent(nisn)}/location`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Lokasi belum berhasil disimpan.");
    const student = await loadStudentByNisn(nisn);
    currentStudent = student;
    sessionStorage.removeItem(`presensi-location-skipped:${nisn}`);
    studentLocationDialog.close();
    updateCurrentUser(nisn, "siswa", student);
    await loadPklLocations();
    await loadStudents();
  } catch (error) {
    studentLocationStatus.textContent = error.message || "Lokasi belum berhasil disimpan.";
  } finally {
    saveStudentLocation.disabled = !studentLocationChoice.value;
  }
});

studentLocationDialog.addEventListener("cancel", (event) => {
  if (studentLocationDialog.dataset.forced === "true") event.preventDefault();
});
document.querySelector("#close-student-location").addEventListener("click", () => studentLocationDialog.close());
document.querySelector("#skip-student-location").addEventListener("click", () => {
  sessionStorage.setItem(
    `presensi-location-skipped:${studentLocationForm.dataset.nisn}`,
    "true",
  );
  studentLocationDialog.close();
});
document.querySelector("#logout-from-location").addEventListener("click", () => {
  studentLocationDialog.close();
  document.querySelector("#logout-button").click();
});

let attendanceDays = [];

function showToast(title, detail = "") {
  const toast = document.querySelector("#toast");
  toast.querySelector("strong").textContent = title;
  toast.querySelector("small").textContent = detail;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 4200);
}

function recordDate(record) {
  return new Date(record.capturedAt || record.receivedAt || record.createdAt);
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTime(record) {
  if (!record) return "—";
  const date = recordDate(record);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function groupAttendance(records) {
  const days = new Map();
  records.forEach((record) => {
    const date = recordDate(record);
    if (Number.isNaN(date.getTime())) return;
    const key = `${record.userId}:${dayKey(date)}`;
    const day = days.get(key) || {
      key,
      userId: record.userId,
      studentName: record.studentName || "",
      className: record.className || "",
      dateKey: dayKey(date),
      masuk: null,
      pulang: null,
    };
    if (record.attendanceType === "pulang") {
      if (!day.pulang || recordDate(day.pulang) < date) day.pulang = record;
    } else if (!day.masuk || recordDate(day.masuk) > date) {
      day.masuk = record;
    }
    days.set(key, day);
  });
  return [...days.values()]
    .map((day) => ({ ...day, date: recordDate(day.masuk || day.pulang), status: (day.masuk || day.pulang).status || "Hadir" }))
    .sort((first, second) => second.date - first.date);
}

function statusClass(status) {
  return status === "Sakit" ? "sick" : status === "Tidak hadir" ? "absent" : status === "Terlambat" ? "warning" : "success";
}

function locationSummary(record) {
  const latitude = Number(record?.location?.latitude);
  const longitude = Number(record?.location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return record ? "<span>Lokasi tidak tersedia</span>" : "";
  }
  return `<span>${escapeHtml(record.location.address || "Alamat belum tersedia")}</span><a href="https://www.google.com/maps?q=${latitude},${longitude}" target="_blank" rel="noopener noreferrer">${latitude.toFixed(6)}, ${longitude.toFixed(6)}</a><span>Akurasi ±${escapeHtml(record.location.accuracy ?? "-")} m</span>${record.outsideRadius ? "<span>Di luar radius 200 m · perlu review</span>" : ""}`;
}

function photoThumb(record, label, studentName) {
  if (!record) return "";
  const source = `/images/${encodeURIComponent(record.filename)}`;
  return `<a href="${source}" target="_blank" rel="noopener" title="Buka foto presensi ${label}"><img class="photo-thumb" src="${source}" loading="lazy" alt="Foto presensi ${label} ${escapeHtml(studentName || record.userId)}"><span>${label} ${escapeHtml(formatTime(record))}</span></a>`;
}

function attendanceDetail(record) {
  if (!record) return "";
  const capturedAt = recordDate(record);
  return `<span>${escapeHtml(record.attendanceType || "masuk")}: diambil ${escapeHtml(capturedAt.toLocaleString("id-ID"))}</span><span>${escapeHtml(record.image?.width ?? "?")} × ${escapeHtml(record.image?.height ?? "?")} px · ${escapeHtml(record.image?.type || "-")} · ${escapeHtml(record.image?.sizeBytes ?? "-")} byte</span><span title="${escapeHtml(record.userAgent || "")}">${escapeHtml(record.filename)}</span>`;
}

function isStaffRole() {
  return currentUser().role === "guru" || currentUser().role === "admin";
}

function renderFullTable(days) {
  const staff = isStaffRole();
  document.querySelector("#full-table-head").innerHTML = `<tr><th>TANGGAL</th>${staff ? "<th>SISWA</th>" : ""}<th>JAM MASUK</th><th>JAM PULANG</th><th>STATUS</th><th>LOKASI</th><th>FOTO PRESENSI</th></tr>`;
  const columns = staff ? 7 : 6;
  document.querySelector("#full-table").innerHTML = days.length
    ? days.map((day) => {
        const name = day.studentName || day.userId;
        const studentCell = staff ? `<td><strong>${escapeHtml(name)}</strong><span>${escapeHtml(day.userId)}${day.className ? ` · ${escapeHtml(day.className)}` : ""}</span></td>` : "";
        return `<tr><td><strong>${escapeHtml(day.date.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "short" }))}</strong><span>${day.date.getFullYear()}</span></td>${studentCell}<td>${escapeHtml(formatTime(day.masuk))}</td><td class="${day.pulang ? "" : "muted-text"}">${escapeHtml(formatTime(day.pulang))}</td><td><span class="status-pill ${statusClass(day.status)}">${escapeHtml(day.status)}</span></td><td>${locationSummary(day.masuk || day.pulang)}</td><td><div class="photo-thumbs">${photoThumb(day.masuk, "Masuk", name)}${photoThumb(day.pulang, "Pulang", name)}</div><details class="attendance-detail"><summary>Detail</summary>${attendanceDetail(day.masuk)}${attendanceDetail(day.pulang)}</details></td></tr>`;
      }).join("")
    : `<tr><td colspan="${columns}">Tidak ada catatan presensi pada filter ini.</td></tr>`;
}

function renderRecentTable(days) {
  const staff = isStaffRole();
  document.querySelector("#recent-table").innerHTML = days.length
    ? days.slice(0, 3).map((day) => {
        const sub = staff ? escapeHtml(day.studentName || day.userId) : day.date.getFullYear();
        return `<tr><td><strong>${escapeHtml(day.date.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "short" }))}</strong><span>${sub}</span></td><td>${escapeHtml(formatTime(day.masuk))}</td><td class="${day.pulang ? "" : "muted-text"}">${escapeHtml(formatTime(day.pulang))}</td><td><span class="status-pill ${statusClass(day.status)}">${escapeHtml(day.status)}</span></td><td>${escapeHtml((day.masuk || day.pulang).location?.address?.split(",")[0] || "Lokasi tidak tersedia")}</td><td></td></tr>`;
      }).join("")
    : '<tr><td colspan="6">Belum ada catatan presensi.</td></tr>';
}

function renderTodayPhotos() {
  const grid = document.querySelector("#today-photo-grid");
  if (!isStaffRole()) return;
  const todayKey = dayKey(new Date());
  const today = attendanceDays.filter((day) => day.dateKey === todayKey);
  grid.innerHTML = today.length
    ? today.map((day) => {
        const name = day.studentName || day.userId;
        const record = day.masuk || day.pulang;
        return `<figure class="photo-card"><a href="/images/${encodeURIComponent(record.filename)}" target="_blank" rel="noopener"><img class="photo-thumb" src="/images/${encodeURIComponent(record.filename)}" loading="lazy" alt="Foto presensi ${escapeHtml(name)}"></a><figcaption><strong>${escapeHtml(name)}</strong><span>${escapeHtml(day.className || day.userId)}</span><span>Masuk ${escapeHtml(formatTime(day.masuk))} · Pulang ${escapeHtml(formatTime(day.pulang))}</span><span class="status-pill ${statusClass(day.status)}">${escapeHtml(day.status)}</span></figcaption></figure>`;
      }).join("")
    : '<p class="empty-state">Belum ada siswa yang presensi hari ini.</p>';
}

function updateAttendanceSummary() {
  const now = new Date();
  const monthDays = attendanceDays.filter((day) => day.date.getFullYear() === now.getFullYear() && day.date.getMonth() === now.getMonth());
  const presentDays = monthDays.filter((day) => day.status === "Hadir" || day.status === "Terlambat");
  const sickDays = monthDays.filter((day) => day.status === "Sakit");
  document.querySelector("#attendance-rate").textContent = monthDays.length
    ? `${Math.round((presentDays.length / monthDays.length) * 100)}%`
    : "—";
  document.querySelector("#present-count").textContent = String(presentDays.length);
  document.querySelector("#sick-count").textContent = String(sickDays.length);
  const arrivalMinutes = presentDays
    .filter((day) => day.masuk)
    .map((day) => recordDate(day.masuk))
    .map((date) => date.getHours() * 60 + date.getMinutes());
  const average = arrivalMinutes.length
    ? Math.round(arrivalMinutes.reduce((sum, minutes) => sum + minutes, 0) / arrivalMinutes.length)
    : null;
  document.querySelector("#average-arrival").textContent = average === null
    ? "—"
    : `${String(Math.floor(average / 60)).padStart(2, "0")}:${String(average % 60).padStart(2, "0")}`;
  const todayKey = dayKey(now);
  const todayDay = attendanceDays.find((day) => day.dateKey === todayKey);
  const todayStatus = document.querySelector("#today-attendance-status");
  todayStatus.textContent = todayDay ? todayDay.status : "Belum presensi";
  todayStatus.className = `status-pill ${todayDay ? statusClass(todayDay.status) : "neutral"}`;
  document.querySelector("#today-schedule-date").textContent = now.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  document.querySelector("#dashboard-date").textContent = now.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function inPeriod(date, period) {
  const now = new Date();
  if (period === "today") return dayKey(date) === dayKey(now);
  if (period === "month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  if (period === "quarter") {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 3);
    return date >= start;
  }
  return true;
}

function filteredAttendanceDays() {
  const selectedStatus = document.querySelector("#status-filter").value;
  const selectedPeriod = document.querySelector("#period-filter").value;
  return attendanceDays.filter((day) =>
    (selectedStatus === "Semua status" || day.status === selectedStatus) && inPeriod(day.date, selectedPeriod));
}

function renderFilteredAttendance() {
  const days = filteredAttendanceDays();
  renderFullTable(days);
  document.querySelector("#attendance-summary-count").textContent = `${days.length} catatan`;
}

async function loadAttendanceRecords() {
  try {
    const response = await fetch("/api/attendance-records");
    if (!response.ok) throw new Error("Could not load attendance records");
    attendanceRecords = await response.json();
  } catch {
    attendanceRecords = [];
  }
  attendanceDays = groupAttendance(attendanceRecords);
  renderRecentTable(attendanceDays);
  renderTodayPhotos();
  updateAttendanceSummary();
  renderFilteredAttendance();
  renderNotifications();
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadAttendanceCsv() {
  const status = document.querySelector("#download-status");
  const days = filteredAttendanceDays();
  if (!days.length) {
    status.textContent = "Tidak ada data untuk diunduh pada filter ini.";
    return;
  }
  try {
    const header = ["Tanggal", "Nama", "NISN", "Kelas", "Jam masuk", "Jam pulang", "Status", "Lokasi", "Koordinat", "Di luar radius 200 m"];
    const lines = days.map((day) => {
      const record = day.masuk || day.pulang;
      const coordinates = record.location ? `${record.location.latitude}, ${record.location.longitude}` : "";
      return [
        dayKey(day.date), day.studentName, day.userId, day.className, formatTime(day.masuk), formatTime(day.pulang),
        day.status, record.location?.address || "", coordinates, record.outsideRadius ? "Ya" : "Tidak",
      ].map(csvCell).join(",");
    });
    const blob = new Blob([`\uFEFF${[header.map(csvCell).join(","), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `rekap-presensi-${dayKey(new Date())}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    status.textContent = `${days.length} catatan diunduh.`;
  } catch {
    status.textContent = "Laporan gagal dibuat. Coba lagi.";
  }
}

document.querySelector("#download-attendance").addEventListener("click", downloadAttendanceCsv);
document.querySelector("#open-today-rekap").addEventListener("click", () => {
  document.querySelector("#period-filter").value = "today";
  document.querySelector("#status-filter").value = "Semua status";
  renderFilteredAttendance();
  setView("rekap");
});

function notificationReadKey() {
  return `presensi-notifications-read:${currentUser().userId || "guru"}`;
}

function readNotificationIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(notificationReadKey()) || "[]"));
  } catch {
    return new Set();
  }
}

function notificationPreferences() {
  try {
    return JSON.parse(localStorage.getItem(`presensi-notification-preferences:${currentUser().userId || "guest"}`) || "{}");
  } catch {
    return {};
  }
}

function getTeacherNotifications() {
  const preferences = notificationPreferences();
  if (serverNotifications) {
    return serverNotifications.filter((item) =>
      !(item.category === "Presensi siswa" && preferences.attendance === false) &&
      !(item.category === "Laporan PKL" && preferences.reports === false));
  }
  const studentsById = new Map(studentRecords.map((student) => [student.nisn, student]));
  const attendance = preferences.attendance === false
    ? []
    : attendanceRecords
        .filter((record) => record.role === "siswa")
        .map((record) => {
          const student = studentsById.get(record.userId);
          return {
            id: `attendance:${record.filename}`,
            category: "Presensi siswa",
            title: "Presensi siswa tercatat",
            detail: `${student?.name || record.userId} · ${record.status || "Hadir"}`,
            date: record.receivedAt || record.capturedAt,
            target: "rekap",
          };
        });
  const reports = preferences.reports === false
    ? []
    : reportRecords.map((record) => ({
        id: `report:${record.filename}`,
        category: "Laporan PKL",
        title: "Laporan PKL baru diunggah",
        detail: record.originalName || record.filename,
        date: record.createdAt,
        filename: record.filename,
      }));
  return [...attendance, ...reports]
    .filter((item) => item.date && !Number.isNaN(Date.parse(item.date)))
    .sort((first, second) => Date.parse(second.date) - Date.parse(first.date));
}

async function loadTeacherNotifications() {
  if (currentUser().role !== "guru" && currentUser().role !== "admin") return;
  try {
    const response = await fetch("/api/notifications");
    if (!response.ok) throw new Error("Notifikasi belum dapat dimuat.");
    const result = await response.json();
    serverNotifications = Array.isArray(result.notifications) ? result.notifications : [];
    serverReadNotificationIds = new Set(Array.isArray(result.readIds) ? result.readIds : []);
  } catch {
    serverNotifications = null;
  }
  renderNotifications();
}

function renderNotifications() {
  const list = document.querySelector("#notification-list");
  if (!list) return;
  const notifications = getTeacherNotifications();
  const readIds = serverNotifications ? serverReadNotificationIds : readNotificationIds();
  const unreadCount = notifications.filter((item) => !readIds.has(item.id)).length;
  const navCount = document.querySelector("#notification-nav-count");
  const indicator = document.querySelector("#notification-indicator");
  navCount.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  navCount.hidden = unreadCount === 0;
  indicator.hidden = unreadCount === 0;
  document.querySelector("#notifications-unread").textContent = unreadCount
    ? `${unreadCount} notifikasi belum dibaca`
    : "Semua notifikasi sudah dibaca.";
  document.querySelector("#mark-notifications-read").disabled = unreadCount === 0;
  list.innerHTML = notifications.length
    ? notifications.map((item) => {
        const unreadClass = readIds.has(item.id) ? "" : " unread";
        const action = item.filename
          ? `<a class="notification-file-link" href="/reports/${encodeURIComponent(item.filename)}" target="_blank" rel="noopener">Buka file</a>`
          : `<button class="notification-link" type="button" data-notification-view="${escapeHtml(item.target || "rekap")}">${item.target === "laporan" ? "Lihat laporan" : "Lihat presensi"}</button>`;
        return `<article class="notification-item${unreadClass}"><span class="notification-mark" aria-hidden="true"></span><div class="notification-copy"><span class="notification-category">${escapeHtml(item.category)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p><time datetime="${escapeHtml(item.date)}">${escapeHtml(new Date(item.date).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }))}</time></div>${action}</article>`;
      }).join("")
    : '<p class="empty-state">Belum ada aktivitas presensi atau laporan siswa.</p>';
}

async function loadReportNotifications() {
  try {
    const response = await fetch("/api/reports");
    if (!response.ok) throw new Error("Could not load reports");
    reportRecords = await response.json();
  } catch {
    reportRecords = [];
  }
  renderStudentReports();
  renderTeacherReports();
  renderNotifications();
}

const reviewLabels = { valid: "Valid", perlu_revisi: "Perlu revisi" };

function reviewBadge(review) {
  if (!review) return '<span class="review-badge">Menunggu pemeriksaan</span>';
  return `<span class="review-badge ${escapeHtml(review.status)}">${escapeHtml(reviewLabels[review.status] || review.status)}</span>${review.note ? `<span class="review-note">${escapeHtml(review.note)}</span>` : ""}`;
}

function reportFileLink(report) {
  const originalName = report.originalName || report.filename;
  const extension = originalName.split(".").pop().toLowerCase();
  const isWordDocument = extension === "doc" || extension === "docx";
  const linkAttributes = isWordDocument
    ? `download="${escapeHtml(originalName)}"`
    : 'target="_blank" rel="noopener"';
  return `<a class="table-link" href="/reports/${encodeURIComponent(report.filename)}" ${linkAttributes}>${isWordDocument ? "Unduh" : "Buka"}</a>`;
}

function renderStudentReports() {
  const empty = document.querySelector("#report-empty");
  if (!empty || currentUser().role !== "siswa") return;
  const ownReports = reportRecords.filter((report) => report.userId === currentUser().userId);
  const status = document.querySelector("#report-status");
  const latestReview = ownReports[0]?.review;
  status.textContent = !ownReports.length
    ? "Belum ada laporan"
    : latestReview ? reviewLabels[latestReview.status] : "Menunggu pemeriksaan";
  status.className = `status-pill ${!ownReports.length ? "neutral" : latestReview?.status === "valid" ? "success" : "warning"}`;
  empty.innerHTML = ownReports.length
    ? `<div class="report-file-list">${ownReports.map((report) => `<div class="report-file-row"><span class="file-badge">${escapeHtml((report.originalName || report.filename).split(".").pop().toUpperCase())}</span><div><strong>${escapeHtml(report.originalName || report.filename)}</strong><small>${escapeHtml(new Date(report.createdAt).toLocaleString("id-ID"))}</small>${reviewBadge(report.review)}</div>${reportFileLink(report)}</div>`).join("")}</div>`
    : "<span>▤</span><p>Belum ada laporan yang diupload.</p>";
}

function renderTeacherReports() {
  const body = document.querySelector("#teacher-report-table");
  if (!body) return;
  const canReview = currentUser().role === "guru";
  document.querySelector("#teacher-report-count").textContent = `${reportRecords.length} laporan`;
  body.innerHTML = reportRecords.length
    ? reportRecords.map((report) => `<tr><td><strong>${escapeHtml(report.studentName || report.userId)}</strong><br><small>${escapeHtml(report.userId)}</small></td><td>${escapeHtml(report.originalName || report.filename)}</td><td>${report.createdAt ? escapeHtml(new Date(report.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })) : "-"}</td><td>${reviewBadge(report.review)}</td><td><div class="row-actions">${reportFileLink(report)}${canReview ? `<button type="button" data-review-report="${escapeHtml(report.filename)}">Periksa</button>` : ""}</div></td></tr>`).join("")
    : '<tr><td colspan="5" class="empty-state">Belum ada laporan yang diunggah siswa.</td></tr>';
}

const reviewDialog = document.querySelector("#review-dialog");
const reviewForm = document.querySelector("#review-form");
document.querySelector("#teacher-report-table").addEventListener("click", (event) => {
  const button = event.target.closest("[data-review-report]");
  if (!button) return;
  const report = reportRecords.find((item) => item.filename === button.dataset.reviewReport);
  if (!report) return;
  reviewForm.dataset.filename = report.filename;
  document.querySelector("#review-subject").textContent = `${report.studentName || report.userId} · ${report.originalName || report.filename}`;
  document.querySelector("#review-status").value = report.review?.status || "valid";
  document.querySelector("#review-note").value = report.review?.note || "";
  document.querySelector("#review-error").textContent = "";
  reviewDialog.showModal();
});
reviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.querySelector("#review-submit");
  const error = document.querySelector("#review-error");
  submit.disabled = true;
  error.textContent = "Menyimpan hasil...";
  try {
    const response = await fetch(`/api/reports/${encodeURIComponent(reviewForm.dataset.filename)}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: document.querySelector("#review-status").value,
        note: document.querySelector("#review-note").value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Hasil belum tersimpan.");
    reviewDialog.close();
    await loadReportNotifications();
    showToast("Hasil pemeriksaan tersimpan", "Siswa dapat melihat status laporannya.");
  } catch (failure) {
    error.textContent = failure instanceof TypeError ? "Server tidak dapat dihubungi." : failure.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#open-notifications").addEventListener("click", () => setView("notifikasi"));
document.querySelector("#notification-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-notification-view]");
  if (button) setView(button.dataset.notificationView);
});
document.querySelector("#mark-notifications-read").addEventListener("click", () => {
  const ids = getTeacherNotifications().map((item) => item.id);
  if (serverNotifications) {
    fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).then(() => {
      ids.forEach((id) => serverReadNotificationIds.add(id));
      renderNotifications();
    }).catch(() => {});
  } else {
    localStorage.setItem(notificationReadKey(), JSON.stringify(ids));
    renderNotifications();
  }
});
document.querySelector("#refresh-notifications").addEventListener("click", async () => {
  const button = document.querySelector("#refresh-notifications");
  button.disabled = true;
  await Promise.all([loadAttendanceRecords(), loadReportNotifications(), loadTeacherNotifications()]);
  button.disabled = false;
});

const notificationSettingButtons = document.querySelectorAll(".notification-setting");
function renderNotificationSettings() {
  const preferences = notificationPreferences();
  notificationSettingButtons.forEach((button) => {
    const enabled = preferences[button.dataset.notificationSetting] !== false;
    button.classList.toggle("on", enabled);
    button.setAttribute("aria-checked", String(enabled));
  });
}
notificationSettingButtons.forEach((button) => button.addEventListener("click", () => {
  const preferences = notificationPreferences();
  const key = button.dataset.notificationSetting;
  preferences[key] = button.getAttribute("aria-checked") !== "true";
  localStorage.setItem(`presensi-notification-preferences:${currentUser().userId || "guest"}`, JSON.stringify(preferences));
  renderNotificationSettings();
  renderNotifications();
}));
renderNotificationSettings();

document.querySelector("#status-filter").addEventListener("change", renderFilteredAttendance);
document.querySelector("#period-filter").addEventListener("change", renderFilteredAttendance);

const reportForm = document.querySelector("#report-form");
const reportFile = document.querySelector("#report-file");
const reportFileName = document.querySelector("#report-file-name");
const uploadError = document.querySelector("#upload-error");
const reportStatus = document.querySelector("#report-status");
const reportEmpty = document.querySelector("#report-empty");
const reportTypesByExtension = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
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
  const extension = file.name.split(".").pop().toLowerCase();
  const expectedType = reportTypesByExtension[extension];
  if (!expectedType) {
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
      if (typeof reader.result !== "string") throw new Error("File tidak dapat dibaca oleh browser.");
      const dataSeparator = reader.result.indexOf(",");
      if (dataSeparator < 0) throw new Error("File tidak dapat dibaca oleh browser.");
      const fileData = `data:${expectedType};base64,${reader.result.slice(dataSeparator + 1)}`;
      const response = await fetch("/api/report-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, type: expectedType, data: fileData }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Laporan belum berhasil diupload.");
      uploadError.textContent = "";
      reportForm.reset();
      reportFileName.textContent = "Belum ada file dipilih";
      await loadReportNotifications();
    } catch (error) {
      uploadError.textContent = error instanceof TypeError
        ? "Server tidak dapat dihubungi. Pastikan aplikasi sedang berjalan."
        : error.message;
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
let capturedAt;
let cameraLocationName = "Lokasi tidak tersedia";
let locationRequestId = 0;
let cameraClock;
const cameraTagLocation = document.querySelector("#camera-tag-location");
const cameraTagCoordinates = document.querySelector("#camera-tag-coordinates");
const cameraTagTime = document.querySelector("#camera-tag-time");
const updateCameraTagTime = () => {
  cameraTagTime.textContent = new Date().toLocaleString("id-ID");
};
const fitCanvasText = (context, text, maxWidth) => {
  let fittedText = text;
  while (fittedText && context.measureText(fittedText).width > maxWidth) {
    fittedText = `${fittedText.slice(0, -2)}…`;
  }
  return fittedText;
};
const drawCameraTag = (context, canvas, timestamp) => {
  const scale = canvas.width / 400;
  const padding = 12 * scale;
  const lineHeight = 20 * scale;
  const tagHeight = padding * 2 + lineHeight * 3;
  const top = canvas.height - tagHeight;
  context.fillStyle = "rgba(0, 0, 0, 0.72)";
  context.fillRect(0, top, canvas.width, tagHeight);
  context.fillStyle = "white";
  context.textBaseline = "top";
  context.font = `bold ${16 * scale}px Arial`;
  context.fillText(
    fitCanvasText(context, cameraLocationName, canvas.width - padding * 2),
    padding,
    top + padding,
  );
  context.font = `${12 * scale}px Arial`;
  context.fillText(
    fitCanvasText(context, cameraTagCoordinates.textContent, canvas.width - padding * 2),
    padding,
    top + padding + lineHeight,
  );
  context.fillText(
    fitCanvasText(context, new Date(timestamp).toLocaleString("id-ID"), canvas.width - padding * 2),
    padding,
    top + padding + lineHeight * 2,
  );
};
document.querySelector("#open-qr").addEventListener("click", () => {
  modal.classList.add("open");
  currentLocation = undefined;
  cameraLocationName = "Lokasi tidak tersedia";
  cameraTagLocation.textContent = cameraLocationName;
  cameraTagCoordinates.textContent = "Menunggu GPS...";
  updateCameraTagTime();
  window.clearInterval(cameraClock);
  cameraClock = window.setInterval(updateCameraTagTime, 1000);
  const requestId = ++locationRequestId;
  setCameraState("idle");
  document.querySelector("#camera-status").textContent = "Kamera belum diaktifkan";
  const status = document.querySelector("#location-status");
  status.classList.remove("shared");
  status.innerHTML = "<i></i><span>Mengambil lokasi perangkat...</span>";
  if (!navigator.geolocation) {
    cameraTagCoordinates.textContent = "Koordinat tidak tersedia";
    status.innerHTML = "<i></i><span>Browser tidak mendukung lokasi</span>";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      if (requestId !== locationRequestId) return;
      currentLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Math.round(position.coords.accuracy),
      };
      cameraLocationName = "Lokasi terkini";
      cameraTagLocation.textContent = cameraLocationName;
      cameraTagCoordinates.textContent =
        `${currentLocation.latitude.toFixed(6)}, ${currentLocation.longitude.toFixed(6)}`;
      status.classList.add("shared");
      status.innerHTML = `<i></i><span>Lokasi siap · akurasi ±${currentLocation.accuracy} m</span>`;
      try {
        const query = new URLSearchParams({
          lat: String(currentLocation.latitude),
          lon: String(currentLocation.longitude),
        });
        const response = await fetch(`/api/location-address?${query}`);
        if (!response.ok) throw new Error("Nama lokasi tidak tersedia.");
        const result = await response.json();
        if (requestId !== locationRequestId) return;
        if (typeof result.address === "string" && result.address.trim()) {
          cameraLocationName = result.address.split(",")[0].trim();
          cameraTagLocation.textContent = cameraLocationName;
        } else {
          status.innerHTML = `<i></i><span>Koordinat siap · nama lokasi tidak tersedia</span>`;
        }
      } catch {
        if (requestId === locationRequestId) {
          status.innerHTML = `<i></i><span>Koordinat siap · nama lokasi tidak tersedia</span>`;
        }
      }
    },
    (error) => {
      if (requestId !== locationRequestId) return;
      cameraTagLocation.textContent = "Lokasi tidak tersedia";
      cameraTagCoordinates.textContent = "Koordinat tidak tersedia";
      status.innerHTML = `<i></i><span>${error.code === 1 ? "Izin lokasi ditolak" : "Lokasi belum tersedia"}</span>`;
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});
const stopCamera = () => {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
  document.querySelector("#camera-frame").classList.remove("camera-active");
  document.querySelector("#camera-preview").srcObject = null;
};
const closeModal = () => {
  modal.classList.remove("open");
  stopCamera();
  window.clearInterval(cameraClock);
  locationRequestId += 1;
  capturedPhoto = undefined;
  capturedAt = undefined;
  currentLocation = undefined;
  document.querySelector("#camera-frame").classList.remove("photo-captured");
  setCameraState("idle");
  const saveButton = document.querySelector("#save-attendance");
  saveButton.disabled = true;
  saveButton.textContent = "Simpan presensi";
};
window.addEventListener("beforeunload", stopCamera);
document.querySelector("#close-qr").addEventListener("click", closeModal);
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

function setCameraState(state) {
  const enable = document.querySelector("#enable-camera");
  const capture = document.querySelector("#capture-face");
  const states = {
    idle: ["Buka kamera", false, "Ambil foto", true, "Langkah 1: klik Buka kamera dan izinkan akses kamera."],
    active: ["Kamera aktif", true, "Ambil foto", false, "Langkah 2: posisikan wajah di dalam bingkai, lalu klik Ambil foto."],
    captured: ["Ambil ulang", false, "Foto diambil", true, "Langkah 3: periksa foto, lalu klik Simpan presensi atau Ambil ulang."],
  };
  const [enableLabel, enableDisabled, captureLabel, captureDisabled, hint] = states[state];
  enable.querySelector("b").textContent = enableLabel;
  enable.disabled = enableDisabled;
  capture.querySelector("b").textContent = captureLabel;
  capture.disabled = captureDisabled;
  document.querySelector("#camera-hint").textContent = hint;
}

document.querySelector("#enable-camera").addEventListener("click", async () => {
  const status = document.querySelector("#camera-status");
  const hint = document.querySelector("#camera-hint");
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    status.textContent = "Kamera tidak tersedia di browser ini";
    hint.textContent = window.isSecureContext
      ? "Gunakan browser terbaru seperti Chrome, Edge, Safari, atau Firefox."
      : "Kamera hanya dapat dipakai lewat localhost atau HTTPS. Buka aplikasi dari alamat yang aman.";
    return;
  }
  capturedPhoto = undefined;
  capturedAt = undefined;
  document.querySelector("#camera-frame").classList.remove("photo-captured");
  document.querySelector("#save-attendance").disabled = true;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    document.querySelector("#camera-preview").srcObject = cameraStream;
    document.querySelector("#camera-frame").classList.add("camera-active");
    setCameraState("active");
    status.textContent = "Kamera aktif · posisikan wajah di dalam bingkai";
  } catch (error) {
    setCameraState("idle");
    const messages = {
      NotAllowedError: ["Izin kamera ditolak", "Aktifkan izin kamera untuk situs ini di pengaturan browser, lalu klik Buka kamera lagi."],
      SecurityError: ["Izin kamera ditolak", "Aktifkan izin kamera untuk situs ini di pengaturan browser, lalu klik Buka kamera lagi."],
      NotFoundError: ["Kamera tidak ditemukan", "Pastikan perangkat memiliki kamera yang tersambung."],
      OverconstrainedError: ["Kamera tidak ditemukan", "Pastikan perangkat memiliki kamera yang tersambung."],
      NotReadableError: ["Kamera sedang dipakai aplikasi lain", "Tutup aplikasi lain yang memakai kamera, lalu coba lagi."],
    };
    const [title, detail] = messages[error.name] || ["Kamera tidak dapat digunakan", "Muat ulang halaman lalu coba lagi."];
    status.textContent = title;
    hint.textContent = detail;
  }
});

document.querySelector("#capture-face").addEventListener("click", () => {
  const video = document.querySelector("#camera-preview");
  const canvas = document.querySelector("#face-capture");
  if (!video.videoWidth) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  context.save();
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  context.restore();
  capturedAt = new Date().toISOString();
  drawCameraTag(context, canvas, capturedAt);
  capturedPhoto = canvas.toDataURL("image/jpeg", 0.88);
  document.querySelector("#camera-frame").classList.add("photo-captured");
  document.querySelector("#camera-status").textContent =
    "Foto wajah siap disimpan";
  document.querySelector("#save-attendance").disabled = false;
  stopCamera();
  setCameraState("captured");
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
          photo: capturedPhoto,
          location: currentLocation,
          capturedAt,
          userAgent: navigator.userAgent,
          image: {
            width: document.querySelector("#face-capture").width,
            height: document.querySelector("#face-capture").height,
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Presensi belum berhasil disimpan.");
      await loadAttendanceRecords();
      closeModal();
      const type = result.record?.attendanceType === "pulang" ? "pulang" : "masuk";
      showToast(`Presensi ${type} berhasil disimpan`, `Status: ${result.record?.status || "Hadir"} · foto tersimpan di server`);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Simpan presensi";
      document.querySelector("#camera-hint").textContent = error instanceof TypeError
        ? "Server tidak dapat dihubungi. Pastikan aplikasi sedang berjalan, lalu coba simpan lagi."
        : error.message;
    }
  });

const locationDetailDialog = document.querySelector("#location-detail-dialog");
document.querySelector("#show-location").addEventListener("click", async () => {
  const content = document.querySelector("#location-detail-content");
  const editButton = document.querySelector("#location-detail-edit");
  let student = currentStudent;
  try {
    student = await loadStudentByNisn(currentUser().userId);
    currentStudent = student;
  } catch {
    // Fall back to the data already on screen.
  }
  if (student?.pklLocationId) {
    const hasCoordinates = student.pklLatitude !== null && student.pklLatitude !== undefined &&
      student.pklLongitude !== null && student.pklLongitude !== undefined;
    const coordinates = hasCoordinates
      ? `<a href="https://www.google.com/maps?q=${encodeURIComponent(`${student.pklLatitude},${student.pklLongitude}`)}" target="_blank" rel="noopener noreferrer">${escapeHtml(student.pklLatitude)}, ${escapeHtml(student.pklLongitude)}</a>`
      : "Koordinat belum diisi oleh guru.";
    content.innerHTML = `<dl><div><dt>Nama perusahaan</dt><dd>${escapeHtml(student.pklCompanyName)}</dd></div><div><dt>Alamat</dt><dd>${escapeHtml(student.pklAddress)}</dd></div><div><dt>Koordinat</dt><dd>${coordinates}</dd></div></dl>`;
    editButton.textContent = "Ubah tempat PKL";
  } else {
    content.innerHTML = "<p>Data lokasi PKL belum dimasukkan. Pilih dari daftar tempat PKL atau usulkan tempat baru.</p>";
    editButton.textContent = "Atur lokasi PKL";
  }
  editButton.hidden = false;
  locationDetailDialog.showModal();
});
document.querySelector("#location-detail-edit").addEventListener("click", () => {
  locationDetailDialog.close();
  document.querySelector("#edit-student-location").click();
});
document.querySelectorAll("[data-close-dialog]").forEach((button) =>
  button.addEventListener("click", () => button.closest("dialog").close()),
);
