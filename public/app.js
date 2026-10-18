const loginScreen = document.querySelector("#login-screen");
const appShell = document.querySelector("#app-shell");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const loginPassword = document.querySelector("#login-password");
const themeOptions = document.querySelectorAll(".theme-option");
let savedAttendanceRows = [];

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

async function restoreSession() {
  try {
    const response = await fetch("/api/session");
    if (!response.ok) return;
    const result = await response.json();
    sessionStorage.setItem("presensi-user", JSON.stringify({
      userId: result.user.id,
      role: result.user.role,
    }));
    sessionStorage.setItem("presensi-authenticated", "true");
    setAuthenticated(true, true);
    setTeacherControls(result.user.role);
    updateCurrentUser(result.user.id, result.user.role);
  } catch {
    sessionStorage.removeItem("presensi-authenticated");
    sessionStorage.removeItem("presensi-user");
  }
}

restoreSession();

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  const userId = document.querySelector("#login-id").value.trim();
  const selectedRole = document.querySelector("#login-role").value;
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: userId, password: loginPassword.value }),
  });
  const result = await response.json();
  if (!response.ok) {
    loginError.textContent = result.message || "Login gagal.";
    return;
  }
  const role = result.user.role;
  if ((selectedRole === "guru" && role !== "guru") ||
      (selectedRole === "Siswa/Siswi" && role !== "siswa") ||
      (selectedRole === "admin" && role !== "admin")) {
    loginError.textContent = "Peran yang dipilih tidak sesuai dengan akun.";
    await fetch("/api/logout", { method: "POST" });
    return;
  }
  let student = null;
  if (role === "siswa") {
    const studentResponse = await fetch(`/api/students/${encodeURIComponent(userId)}`);
    if (!studentResponse.ok) {
      loginError.textContent = "Data siswa belum terdaftar.";
      return;
    }
    student = await studentResponse.json();
  }
  sessionStorage.setItem(
    "presensi-user",
    JSON.stringify({ userId, role }),
  );
  sessionStorage.setItem("presensi-authenticated", "true");
  loginError.textContent = "";
  setAuthenticated(true);
  setTeacherControls(role);
  updateCurrentUser(userId, role, student);
  if (student) {
    if (!student.pklLocationId && !hasSkippedStudentLocation(userId)) {
      await showStudentLocationDialog(student);
    }
    else updateStudentLocation(student);
  }
});

document.querySelector("#toggle-password").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const isPassword = loginPassword.type === "password";
  loginPassword.type = isPassword ? "text" : "password";
  button.setAttribute("aria-label", isPassword ? "Sembunyikan password" : "Tampilkan password");
  button.title = isPassword ? "Sembunyikan password" : "Tampilkan password";
});

document.querySelector("#logout-button").addEventListener("click", () => {
  fetch("/api/logout", { method: "POST" }).catch(() => {});
  sessionStorage.removeItem("presensi-authenticated");
  sessionStorage.removeItem("presensi-user");
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
  notifikasi: "Notifikasi",
  "profil-guru": "Profil guru",
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
  document.querySelectorAll("[data-teacher-only]").forEach((element) => {
    element.classList.toggle("teacher-visible", role === "guru" || role === "admin");
  });
  document.querySelectorAll("[data-student-only]").forEach((element) => {
    element.classList.toggle("student-visible", role === "siswa");
  });
  document.querySelector("#edit-student-location").classList.toggle(
    "student-visible",
    role === "siswa",
  );
  if (role === "guru" || role === "admin") {
    renderTeacherProfile();
    renderNotifications();
    loadTeacherProfile();
    loadReportNotifications();
    loadTeacherNotifications();
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
  const teacherProfile = role === "guru" ? readTeacherProfile(userId) : null;
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
  if (role === "guru" || role === "admin") {
    renderTeacherProfile();
    loadTeacherProfile();
  }
  if (student) {
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
  document.querySelector("#teacher-profile-status").textContent = profile.displayName || profile.contact
    ? "Profil tersimpan pada browser ini."
    : "Belum ada perubahan profil.";
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
    renderTeacherProfile();
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
    document.querySelector("#teacher-profile-status").textContent = "Profil berhasil disimpan.";
  } catch (error) {
    document.querySelector("#teacher-profile-status").textContent = error.message;
  }
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

async function showStudentLocationDialog(student) {
  await loadPklLocations();
  studentLocationForm.reset();
  studentLocationForm.dataset.nisn = student.nisn;
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
    await showStudentLocationDialog(await loadStudentByNisn(user.userId));
  } catch {
    window.alert("Data siswa belum dapat dimuat. Coba lagi nanti.");
  }
});

async function loadStudentByNisn(nisn) {
  const response = await fetch(`/api/students/${encodeURIComponent(nisn)}`);
  if (!response.ok) throw new Error("Data siswa tidak ditemukan.");
  return response.json();
}

async function loadStudents() {
  try {
    const response = await fetch("/api/students");
    if (!response.ok) throw new Error("Tidak dapat memuat data siswa.");
    const students = await response.json();
    studentRecords = students;
    const isTeacher = currentUser().role === "guru" || currentUser().role === "admin";
    studentCount.textContent = `${students.length} siswa`;
    studentsTableBody.innerHTML = students.length
      ? students
          .map((student) => {
            const placement = isTeacher
              ? `<select class="student-location-select" data-student-location="${escapeHtml(student.nisn)}" aria-label="Tempat PKL ${escapeHtml(student.name)}"><option value="" disabled ${student.pklLocationId ? "" : "selected"}>${pklLocations.length ? "Pilih tempat PKL" : "Lokasi belum tersedia"}</option>${locationOptionsMarkup(student.pklLocationId)}</select>`
              : `<span>${escapeHtml(student.pklCompanyName || "Belum ditentukan")}</span>`;
            return `<tr><td>${escapeHtml(student.name)}</td><td>${escapeHtml(student.nisn)}</td><td>${escapeHtml(student.parentPhone || "-")}</td><td>${placement}</td></tr>`;
          })
          .join("")
      : '<tr><td colspan="4">Belum ada data siswa.</td></tr>';
    renderTeacherProfile();
  } catch {
    studentRecords = [];
    studentsTableBody.innerHTML =
      '<tr><td colspan="4">Data siswa belum dapat dimuat.</td></tr>';
    renderTeacherProfile();
  }
}

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
    await loadStudents();
    studentImportStatus.textContent = `${result.imported} siswa berhasil diimpor. Total: ${result.total}.`;
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
        studentLocationStatus.textContent = createResult.message || "Usulan lokasi dikirim.";
        studentLocationDialog.close();
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

studentLocationDialog.addEventListener("cancel", (event) => event.preventDefault());
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

loadPklLocations().then(loadStudents);

async function restoreCurrentUser() {
  if (sessionStorage.getItem("presensi-authenticated") !== "true") return;
  const user = currentUser();
  setTeacherControls(user.role);
  if (user.role === "siswa") {
    try {
      const student = await loadStudentByNisn(user.userId);
      updateCurrentUser(user.userId, user.role, student);
      if (!student.pklLocationId && !hasSkippedStudentLocation(user.userId)) {
        await showStudentLocationDialog(student);
      }
    } catch {
      sessionStorage.removeItem("presensi-authenticated");
      sessionStorage.removeItem("presensi-user");
      setAuthenticated(false);
    }
    return;
  }
  updateCurrentUser(user.userId || "Guru", user.role || "guru");
}

restoreCurrentUser();

function rowMarkup(row) {
  const statusClass = row[3] === "Sakit" ? "sick" : row[3] === "Tidak hadir" ? "absent" : "success";
  const locationClass = row[4] === "Sekolah" ? "school" : "";
  const metadata = row[6];
  const latitude = Number(metadata?.location?.latitude);
  const longitude = Number(metadata?.location?.longitude);
  const locationDetail = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `<span>${escapeHtml(metadata.location.address || "Alamat belum tersedia")}</span><a href="https://www.google.com/maps?q=${latitude},${longitude}" target="_blank" rel="noopener noreferrer">${latitude.toFixed(6)}, ${longitude.toFixed(6)}</a><span>Akurasi ±${escapeHtml(metadata.location.accuracy ?? "-")} m</span>${metadata.outsideRadius ? "<span>Di luar radius 200 m · perlu review</span>" : ""}`
    : metadata
      ? "<span>Lokasi tidak tersedia</span>"
      : "";
  const capturedAt = metadata?.capturedAt || metadata?.receivedAt || metadata?.createdAt;
  const photoDetail = metadata
    ? `<strong>${escapeHtml(metadata.userId || "Data lama")} · ${escapeHtml(metadata.role || "-")}</strong><span title="${escapeHtml(metadata.userAgent || "")}">Diambil ${escapeHtml(new Date(capturedAt).toLocaleString("id-ID"))}</span><span>Tersimpan ${escapeHtml(new Date(metadata.receivedAt || metadata.createdAt || capturedAt).toLocaleString("id-ID"))}</span><span>${escapeHtml(metadata.image?.width ?? "?")} × ${escapeHtml(metadata.image?.height ?? "?")} px · ${escapeHtml(metadata.image?.type || "-")} · ${escapeHtml(metadata.image?.sizeBytes ?? "-")} byte</span><span>${escapeHtml(metadata.filename)}</span>`
    : escapeHtml(row[5]);
  const year = capturedAt ? new Date(capturedAt).getFullYear() : new Date().getFullYear();
  return `<tr><td><strong>${escapeHtml(row[0])}</strong><span>${escapeHtml(year)}</span></td><td>${escapeHtml(row[1])}</td><td class="${row[2] === "—" ? "muted-text" : ""}">${escapeHtml(row[2])}</td><td><span class="status-pill ${statusClass}">${escapeHtml(row[3])}</span></td><td><span class="location-dot ${locationClass}"></span>${escapeHtml(row[4])}${locationDetail}</td><td>${photoDetail}</td></tr>`;
}

function renderFullTable(rows) {
  document.querySelector("#full-table").innerHTML = rows.length
    ? rows.map(rowMarkup).join("")
    : '<tr><td colspan="6">Belum ada catatan presensi.</td></tr>';
}

function renderRecentTable(rows) {
  document.querySelector("#recent-table").innerHTML = rows.length
    ? rows.slice(0, 3).map((row) => {
        const statusClass = row[3] === "Sakit" ? "sick" : row[3] === "Tidak hadir" ? "absent" : "success";
        const locationClass = row[4] === "Sekolah" ? "school" : "";
        return `<tr><td><strong>${escapeHtml(row[0])}</strong><span>${escapeHtml(row[6].capturedAt.slice(0, 4))}</span></td><td>${escapeHtml(row[1])}</td><td class="muted-text">—</td><td><span class="status-pill ${statusClass}">${escapeHtml(row[3])}</span></td><td><span class="location-dot ${locationClass}"></span>${escapeHtml(row[4])}</td><td></td></tr>`;
      }).join("")
    : '<tr><td colspan="6">Belum ada catatan presensi.</td></tr>';
}

function updateAttendanceSummary() {
  const now = new Date();
  const monthRows = savedAttendanceRows.filter((row) => {
    const capturedAt = new Date(row[6].capturedAt);
    return capturedAt.getFullYear() === now.getFullYear() && capturedAt.getMonth() === now.getMonth();
  });
  const dailyRows = new Map();
  monthRows.forEach((row) => {
    const metadata = row[6];
    const key = `${metadata.userId || "unknown"}:${metadata.capturedAt.slice(0, 10)}`;
    const current = dailyRows.get(key);
    if (!current || metadata.attendanceType === "masuk") dailyRows.set(key, row);
  });
  const uniqueDays = [...dailyRows.values()];
  const presentRows = uniqueDays.filter((row) => row[3] === "Hadir" || row[3] === "Terlambat");
  const sickRows = uniqueDays.filter((row) => row[3] === "Sakit");
  const rate = uniqueDays.length
    ? `${Math.round((presentRows.length / uniqueDays.length) * 100)}%`
    : "—";
  document.querySelector("#attendance-rate").textContent = rate;
  document.querySelector("#present-count").textContent = String(presentRows.length);
  document.querySelector("#sick-count").textContent = String(sickRows.length);

  const arrivalMinutes = presentRows.map((row) => {
    const capturedAt = new Date(row[6].capturedAt);
    return capturedAt.getHours() * 60 + capturedAt.getMinutes();
  });
  const average = arrivalMinutes.length
    ? Math.round(arrivalMinutes.reduce((sum, minutes) => sum + minutes, 0) / arrivalMinutes.length)
    : null;
  document.querySelector("#average-arrival").textContent = average === null
    ? "—"
    : `${String(Math.floor(average / 60)).padStart(2, "0")}:${String(average % 60).padStart(2, "0")}`;

  const today = now.toDateString();
  const checkedInToday = savedAttendanceRows.some(
    (row) => new Date(row[6].capturedAt).toDateString() === today && row[3] === "Hadir",
  );
  const todayStatus = document.querySelector("#today-attendance-status");
  todayStatus.textContent = checkedInToday ? "Hadir" : "Belum presensi";
  todayStatus.className = `status-pill ${checkedInToday ? "success" : "neutral"}`;
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

function renderFilteredAttendance() {
  const selectedStatus = document.querySelector("#status-filter").value;
  const selectedPeriod = document.querySelector("#period-filter").value;
  const now = new Date();
  const rows = savedAttendanceRows.filter((row) => {
    const capturedAt = new Date(row[6].capturedAt);
    const matchesStatus = selectedStatus === "Semua status" || row[3] === selectedStatus;
    const matchesPeriod = selectedPeriod !== "month" ||
      (capturedAt.getFullYear() === now.getFullYear() && capturedAt.getMonth() === now.getMonth());
    return matchesStatus && matchesPeriod;
  });
  renderFullTable(rows);
  document.querySelector("#attendance-summary-count").textContent = `${rows.length} catatan`;
}

async function loadAttendanceRecords() {
  try {
    const response = await fetch("/api/attendance-records");
    if (!response.ok) throw new Error("Could not load attendance records");
    const records = await response.json();
    attendanceRecords = records;
    savedAttendanceRows = records.map((metadata) => {
      const capturedAt = new Date(
        metadata.capturedAt || metadata.receivedAt || metadata.createdAt,
      );
      return [
        capturedAt.toLocaleDateString("id-ID", {
          weekday: "long",
          day: "2-digit",
          month: "short",
        }),
        capturedAt.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        "—",
        metadata.status || "Hadir",
        metadata.location ? "Lokasi foto" : "Lokasi tidak tersedia",
        "",
        {
          ...metadata,
          capturedAt: Number.isNaN(capturedAt.getTime())
            ? new Date().toISOString()
            : capturedAt.toISOString(),
          image: metadata.image || {},
        },
      ];
    });
    renderRecentTable(savedAttendanceRows);
    updateAttendanceSummary();
    renderFilteredAttendance();
    renderNotifications();
  } catch {
    attendanceRecords = [];
    savedAttendanceRows = [];
    renderRecentTable(savedAttendanceRows);
    updateAttendanceSummary();
    renderFilteredAttendance();
    renderNotifications();
  }
}
loadAttendanceRecords();

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
  if (serverNotifications) return serverNotifications;
  const preferences = notificationPreferences();
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
          : `<button class="notification-link" type="button" data-notification-view="rekap">Lihat presensi</button>`;
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

function renderStudentReports() {
  const empty = document.querySelector("#report-empty");
  if (!empty || currentUser().role !== "siswa") return;
  const ownReports = reportRecords.filter((report) => report.userId === currentUser().userId);
  const status = document.querySelector("#report-status");
  status.textContent = ownReports.length ? `${ownReports.length} laporan` : "Belum ada laporan";
  status.className = `status-pill ${ownReports.length ? "success" : "neutral"}`;
  empty.innerHTML = ownReports.length
    ? ownReports.map((report) => `<div class="report-file-row"><span class="file-badge">${escapeHtml((report.originalName || report.filename).split(".").pop().toUpperCase())}</span><div><strong>${escapeHtml(report.originalName || report.filename)}</strong><small>${escapeHtml(new Date(report.createdAt).toLocaleString("id-ID"))}</small></div><a class="table-link" href="/reports/${encodeURIComponent(report.filename)}" target="_blank" rel="noopener">Buka</a></div>`).join("")
    : "<span>▤</span><p>Belum ada laporan yang diupload.</p>";
}

function renderTeacherReports() {
  const body = document.querySelector("#teacher-report-table");
  if (!body) return;
  document.querySelector("#teacher-report-count").textContent = `${reportRecords.length} laporan`;
  body.innerHTML = reportRecords.length
    ? reportRecords.map((report) => `<tr><td><strong>${escapeHtml(report.originalName || report.filename)}</strong></td><td>${report.createdAt ? escapeHtml(new Date(report.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })) : "-"}</td><td><a class="table-link" href="/reports/${encodeURIComponent(report.filename)}" target="_blank" rel="noopener">Buka file</a></td></tr>`).join("")
    : '<tr><td colspan="3" class="empty-state">Belum ada laporan yang diunggah siswa.</td></tr>';
}

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
loadReportNotifications();
loadTeacherNotifications();

document.querySelector("#status-filter").addEventListener("change", renderFilteredAttendance);
document.querySelector("#period-filter").addEventListener("change", renderFilteredAttendance);

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
      await loadReportNotifications();
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
let capturedAt;
document.querySelector("#open-qr").addEventListener("click", () => {
  modal.classList.add("open");
  currentLocation = undefined;
  document.querySelector("#camera-status").textContent = "Kamera belum diaktifkan";
  const status = document.querySelector("#location-status");
  status.classList.remove("shared");
  status.innerHTML = "<i></i><span>Mengambil lokasi perangkat...</span>";
  if (!navigator.geolocation) {
    status.innerHTML = "<i></i><span>Browser tidak mendukung lokasi</span>";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      currentLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Math.round(position.coords.accuracy),
      };
      status.classList.add("shared");
      status.innerHTML = `<i></i><span>Lokasi siap · akurasi ±${currentLocation.accuracy} m</span>`;
    },
    (error) => {
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
  capturedPhoto = undefined;
  capturedAt = undefined;
  currentLocation = undefined;
  document.querySelector("#camera-frame").classList.remove("photo-captured");
  document.querySelector("#capture-face").disabled = true;
  const saveButton = document.querySelector("#save-attendance");
  saveButton.disabled = true;
  saveButton.textContent = "Simpan presensi";
};
window.addEventListener("beforeunload", stopCamera);
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
  capturedAt = new Date().toISOString();
  document.querySelector("#camera-frame").classList.add("photo-captured");
  document.querySelector("#camera-status").textContent =
    "Foto wajah siap disimpan";
  document.querySelector("#save-attendance").disabled = false;
  stopCamera();
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
          userId: JSON.parse(sessionStorage.getItem("presensi-user") || "{}").userId,
          role: JSON.parse(sessionStorage.getItem("presensi-user") || "{}").role,
          userAgent: navigator.userAgent,
          image: {
            width: document.querySelector("#face-capture").width,
            height: document.querySelector("#face-capture").height,
          },
        }),
      });
      if (!response.ok) throw new Error("save failed");
      await loadAttendanceRecords();
      closeModal();
      const toast = document.querySelector("#toast");
      toast.querySelector("strong").textContent =
        "Presensi dan foto berhasil disimpan";
      toast.querySelector("small").textContent =
        "Foto tersimpan di folder images";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 4200);
    } catch {
      button.disabled = false;
      button.textContent = "Simpan presensi";
      alert(
        "Foto belum tersimpan. Jalankan aplikasi melalui server lokal dengan: node server.js",
      );
    }
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
