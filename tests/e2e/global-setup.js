const { request } = require("@playwright/test");

// Seeds a clean database: 2 classes, 2 teachers, 3 students, 2 PKL locations.
module.exports = async () => {
  const baseURL = process.env.E2E_BASE_URL;
  const open = async (id, password, newPassword) => {
    const context = await request.newContext({ baseURL });
    const login = await context.post("/api/login", { data: { id, password } });
    if (!login.ok()) throw new Error(`seed login ${id} failed: ${login.status()}`);
    if ((await login.json()).user.mustChangePassword) {
      const changed = await context.post("/api/password", { data: { password: newPassword } });
      if (!changed.ok()) throw new Error(`seed password ${id} failed`);
    }
    return context;
  };
  const must = async (response, label) => {
    if (!response.ok()) throw new Error(`${label}: ${response.status()} ${await response.text()}`);
    return response.json();
  };

  const admin = await open("admin.sekolah", "admin-password-123", "admin-password-new-1");
  const classA = (await must(await admin.post("/api/classes", { data: { name: "XII-A" } }), "kelas A")).class.id;
  const classB = (await must(await admin.post("/api/classes", { data: { name: "XII-B" } }), "kelas B")).class.id;
  await must(await admin.post("/api/users", { data: { id: "guru.b", role: "guru", password: "guru-b-password-123" } }), "guru b");
  await must(await admin.post(`/api/classes/${classA}/teachers`, { data: { teacherId: "guru.a" } }), "tugas A");
  await must(await admin.post(`/api/classes/${classB}/teachers`, { data: { teacherId: "guru.b" } }), "tugas B");
  const csv = [
    "Nama Siswa,NISN,No. HP Orang Tua,Kelas",
    "Budi Santoso,1111111111,081234567890,XII-A",
    "Citra Lestari,2222222222,081234567891,XII-B",
    "Dewi Anggraini,3333333333,081234567892,XII-A",
  ].join("\n");
  await must(await admin.post("/api/students/import", { data: csv, headers: { "Content-Type": "text/csv" } }), "impor");
  for (const nisn of ["1111111111", "2222222222", "3333333333"]) {
    // Import membuat akun siswa otomatis; admin lalu menetapkan password sementara yang dikenal tes.
    await must(await admin.post(`/api/users/${nisn}/reset-password`, { data: { password: `${nisn}-temp-pass` } }), `akun ${nisn}`);
  }
  // Dewi and Citra are "ready" accounts; Budi keeps a temporary password for the forced-change test.
  await (await open("3333333333", "3333333333-temp-pass", "dewi-password-baru-1")).dispose();
  await (await open("2222222222", "2222222222-temp-pass", "citra-password-baru-1")).dispose();

  const guru = await open("guru.a", "guru-a-password-123", "guru-a-password-new-1");
  await must(await guru.post("/api/pkl-locations", { data: { companyName: "PT Sasmita Digital", address: "Jalan Merdeka No. 1, Bandung", latitude: -6.2, longitude: 106.8 } }), "lokasi 1");
  await must(await guru.post("/api/pkl-locations", { data: { companyName: "CV Karya Mandiri", address: "Jalan Asia Afrika No. 5, Bandung" } }), "lokasi 2");
  await guru.dispose();
  await admin.dispose();
};
