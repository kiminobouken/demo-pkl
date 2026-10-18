# SPECS Demo Sistem Presensi PKL SMK Sasmita Jaya

> Dokumen ini dipertahankan sebagai arsip sumber. Dokumen kerja yang sudah dipecah adalah [requirement.md](./requirement.md), [design.md](./design.md), [task.md](./task.md), dan [account-policy.md](./account-policy.md).

Disusun dari pembacaan file kode repo (root + demo-system-presensi-pkl). Tanggal 2026-10-18.

## 1. Gambaran Umum
Repo berisi 2 varian demo dengan UI mirip (DM Sans + Manrope, tema garden/ocean/terracotta, sidebar + topbar, responsif mobile):
- V1 Foto+Lokasi (root): index.html, app.js 1036 baris, server.js 468 baris, styles.css 2076 baris. Presensi foto wajah kamera depan + geolokasi. Store SQLite data/presensi.sqlite + images + reports. Single-page: login-screen + app-shell (dashboard, rekap, siswa, laporan, notifikasi guru, profil-guru, pengaturan).
- V2 Barcode (subfolder demo-system-presensi-pkl): login.html/js, index.html/app.js, guru.html/js, admin.html/js, shared.js, server.js 287 baris. Presensi scan barcode kartu isi NIS + lokasi; scan-1 masuk, scan-2 pulang. Store JSONL presensi-log, presensi-koreksi, laporan-log + reports. Multi-page login ke index/guru/admin.
- Server keduanya Node node:http tanpa framework di http://localhost:3000. V1 butuh Node 22.13+ (node:sqlite DatabaseSync).

## 2. Pengguna dan Aturan Terkonfirmasi
- Peran: Siswa/Siswi, Guru pembimbing, Admin sekolah.
- Presensi dipakai di sekolah dan perusahaan. Setiap siswa di satu perusahaan. Sistem catat jam masuk dan pulang.
- Status V1: Hadir, Tidak hadir, Sakit. Status V2: Hadir, Terlambat, Alpha, Pulang.
- Presensi butuh validasi (mekanisme belum ditentukan). Admin berwenang koreksi.

### 2.1 Kebijakan penggunaan akun

- **Admin**: akun pertama dibuat dari `ADMIN_PASSWORD` dan opsional `ADMIN_ID`; admin mengelola akun, koreksi, audit, dan seluruh data.
- **Guru**: akun awal dapat dibuat dari `GURU_ID` dan `GURU_PASSWORD`; guru mengelola data siswa, lokasi, impor, presensi, dan laporan sesuai penugasan.
- **Siswa**: akun dibuat admin/guru melalui `POST /api/users` dengan ID yang sama dengan NISN terdaftar; siswa hanya mengakses data sendiri.
- Password minimal 12 karakter, disimpan dengan `scrypt`, dan password awal wajib diganti.
- Sesi disimpan server-side di SQLite dan dikirim melalui cookie `HttpOnly`; `sessionStorage` bukan sumber otorisasi.
- Tidak ada bypass `demo1234`; setiap endpoint memeriksa session dan role di server.
## 3. SPECS V1 Root
### 3.1 Auth V1
- UI login-screen: form login-form (select login-role guru/Siswa, input login-id NIS/ID, password + toggle-password, error login-error).
- Login memanggil `POST /api/login`; restore saat reload via `GET /api/session`; logout memanggil `POST /api/logout`.
- `sessionStorage` hanya menyimpan state tampilan; cookie session server-side dan role database menjadi sumber otorisasi.
- Role siswa wajib GET `/api/students/:nisn`; siswa tidak boleh membaca data siswa lain.
- `POST /api/password` menyelesaikan status `mustChangePassword`; `POST /api/users` membuat akun sesuai kewenangan.

### 3.2 Navigasi dan Dashboard
- setView(name) toggle active, update page-breadcrumb, scroll top. Views: dashboard, rekap, siswa, laporan, notifikasi (guru), profil-guru (guru), pengaturan.
- Dashboard: dashboard-date, welcome-title, tombol open-qr khusus siswa. Statistik attendance-rate persen Hadir bulan berjalan, present-count, sick-count. Tombol show-location toast PT Kreasi Digital Nusantara Serpong. Tabel recent-table 3 terbaru.

### 3.3 Rekap V1
- Tabel full-table 6 kolom: Tanggal, Masuk, Pulang, Status, Lokasi, Bukti.
- Filter status-filter (Semua/Hadir/Tidak hadir/Sakit) dan period-filter.
- rowMarkup: pill success/absent/sick; lokasi link Google Maps lat,lng plus akurasi atau Lokasi tidak tersedia; kolom bukti userId, role, waktu diambil/disimpan id-ID, resolusi WxH, tipe, size byte, filename, title=userAgent.
- Sumber GET /api/attendance-records ORDER BY captured_at DESC. Kosong tampil Belum ada catatan presensi.
### 3.4 Siswa dan Lokasi PKL guru
- Tabel students-table-body, count student-count.
- Impor CSV student-csv via choose-student-csv ke POST /api/students/import body raw CSV. Header wajib Nama Siswa/Nama + NISN; opsional No HP Orang Tua. NISN 10 digit unik; ON CONFLICT update.
- Master lokasi: form pkl-location-form (company max120, address max500) ke POST /api/pkl-locations unik company+address. List GET /api/pkl-locations.
- Penempatan: select data-student-location per baris ke PUT /api/students/:nisn/location.
- Siswa login pertama tanpa lokasi: dialog student-location-dialog (select + opsi other input nama+alamat baru, tombol Lewati/Keluar). Skip simpan sessionStorage presensi-location-skipped:NISN.

### 3.5 Presensi Foto V1
- Buka open-qr: reset state + geolocation highAccuracy timeout 10s ke location-status. Gagal/izin ditolak tetap bisa simpan location null.
- enable-camera: getUserMedia facingMode user ke camera-preview, enable capture-face.
- capture-face: draw ke face-capture, toDataURL jpeg 0.88, capturedAt ISO, enable save-attendance, stop stream.
- save-attendance: POST /api/attendance-photo berisi photo dataURL jpeg/png, location opsional, capturedAt, userId, role, userAgent, image w/h. Sukses reload rekap, toast tersimpan di images, update count 23 dan rate 100 persen hardcoded demo.
- Server: validasi regex data:image jpeg/jpg/png base64; tulis images/presensi-ISO.ext; insert attendance_records filename UNIQUE status default Hadir; gagal DB hapus file; balas 201 ok record.

### 3.6 Laporan Notifikasi Pengaturan V1
- Laporan: form report-form, input report-file, label report-file-name, error upload-error, status report-status. Validasi MIME pdf/msword/docx + ekstensi + max 10MB ke POST /api/report-upload berisi filename type data. Server simpan reports/laporan-ts-safe, log laporan-log.jsonl. GET /api/reports baca reverse.
- Notifikasi guru: list notification-list, unread notifications-unread, badge notification-nav-count, tombol refresh + tandai dibaca. Pref localStorage presensi-notification-preferences via data-notification-setting.
- Profil guru: form teacher-profile-form (displayName max80, userId readonly, contact) + ringkasan teacher-student-count dan teacher-placement-count.
- Pengaturan: tema garden/ocean/terracotta via localStorage presensi-theme ke dataset.theme. Toggle umum hanya class on.

### 3.7 API dan DB V1
- GET /api/students join students+locations ORDER BY name. GET /api/students/:nisn 1 baris atau 404. PUT /api/students/:nisn/location cek lokasi ada. POST /api/students/import CSV. GET dan POST /api/pkl-locations. GET /api/attendance-records map filename userId role status capturedAt receivedAt location lat lng accuracy image w h size type userAgent ORDER BY captured_at DESC. POST /api/attendance-photo. POST /api/report-upload. GET /api/reports.
- SQLite: students(nisn PK, name, parent_phone, pkl_location_id FK), pkl_locations(id, company_name, address UNIQUE), attendance_records(filename UNIQUE, user_id, role, status default Hadir, captured_at, received_at, lat lng accuracy, w h, size type, user_agent). Env DATABASE_PATH dan PORT default 3000.
## 4. SPECS V2 Subfolder Barcode
### 4.1 Login V2
- `login.html` role-switch siswa/guru/admin; submit memanggil `POST /api/login` lalu redirect berdasarkan role server.
- Akun awal dikonfigurasi melalui environment variable; `demo1234` tidak lagi menjadi bypass.
- `auth.sqlite` menyimpan hash password dan sesi. Endpoint scan, laporan, log, dan koreksi memeriksa role.

### 4.2 Siswa V2
- Rekap statis attendanceRows 6 baris berisi tanggal masuk pulang Hadir/Terlambat Perusahaan/Sekolah ket; filter status-filter. Identitas hardcoded Raka Aditya 202312047 XI RPL 2.
- Modal qr-modal: video camera-preview, canvas attendance-photo, meta capture-time capture-location capture-coordinates, manual manual-code, status scan-result, tombol enable-camera retry-location save-attendance (enable jika scannedCode+location+captureTimestamp).
- Scan: BarcodeDetector native interval 300ms lalu fallback ZXing decodeFromConstraints facingMode environment. handleCode cocokkan NIS, bekukan frame, catat waktu+lokasi.
- Lokasi WAJIB beda dari V1. requestLocation timeout 15s.
- Simpan POST /api/attendance-scan berisi code nis nama kelas metadata capturedAt lat lng accuracy. Server tentukan masuk/pulang (scan pertama hari itu = masuk), time HH:MM, simpan id UUID nis nama kelas code date time type metadata createdAt ke presensi-log.jsonl.

### 4.3 Laporan Guru Admin V2
- Laporan siswa: input laporan-input max 10MB pdf/doc/docx ke POST /api/laporan-pkl berisi nis nama kelas fileName data base64. Server simpan reports/nis-ts-safe.ext, log data/laporan-log.jsonl. Riwayat filter NIS, link /reports/file.
- Guru: roster 5 siswa hardcoded (Raka Nadia Bima Citra Dimas). GET /api/laporan-pkl ke Map latest per NIS, tabel filter semua/sudah/belum + summary. GET /api/attendance-log filter roster ke tabel presensi.
- Admin: GET /api/attendance-log merge koreksi terbaru atas ke tabel + select koreksi. Ganti select ke POST /api/attendance-correction berisi id status Hadir/Terlambat/Alpha/Pulang, append presensi-koreksi.jsonl berisi id status correctedBy admin correctedAt. Data asli tidak diubah.
- Util shared.js: fetchJson statusPill showToast formatDateTime formatSize escapeHtml serverHint.

### 4.4 API V2
- POST /api/attendance-scan limit 100KB. GET /api/attendance-log. POST /api/attendance-correction. POST dan GET /api/laporan-pkl cek buffer 10MB. serveFile hardened block dotdot dotfiles server.js data. Root ke login.html. Port fix 3000.

## 5. Non-Fungsional
- Vanilla tanpa build; CDN hanya Google Fonts + ZXing V2. Tema CSS vars root data-theme. Responsif sidebar jadi bottom-nav grid 2 kolom. Toast auto-hide 3-4.2 detik. Escape HTML di render dinamis. Kamera+lokasi butuh localhost/HTTPS + izin browser.

## 6. Analisis Kebutuhan dan Utang
1. **Manajemen akun**: UI admin/guru untuk membuat akun, reset password, menonaktifkan akun, dan melihat sesi masih diperlukan.
2. **Relasi kewenangan guru**: tabel penugasan guru-siswa belum ada; tanpa ini guru belum dapat dibatasi hanya pada siswa bimbingannya.
3. **Pemulihan akun**: perlu prosedur reset password yang aman tanpa menampilkan password asli.
4. **Data demo**: toast perusahaan, count 23, rate 100 persen, dan roster V2 perlu dipindahkan ke persistence.
5. **Validasi presensi**: verifikasi wajah, validasi barcode, aturan terlambat, dan status presensi belum final.
6. **Retensi dan audit**: kebijakan sudah ada, tetapi perlu test periodik serta laporan hasil pembersihan.
7. **Upload**: base64 memiliki overhead sekitar 33%; perlu batas body konsisten dan penyimpanan atomik.

## 7. Golden Rule
Tanya pemilik proyek sebelum putuskan: verifikasi foto/isi barcode dan keterlambatan; mekanisme validasi; hak akses admin vs guru; data siswa dan perusahaan; laporan notifikasi integrasi; keamanan privasi audit.

## 8. Peta File-Fungsi
- README root/subfolder = sumber fitur + golden rule.
- index.html login + app.js setAuthenticated/restoreCurrentUser = session V1.
- app.js loadStudents/loadPklLocations/showStudentLocationDialog + server.js parseCsv = siswa+lokasi.
- app.js rowMarkup/renderFullTable/renderRecentTable/updateAttendanceSummary = rekap V1; demo app.js rowMarkup = rekap statis V2.
- qr-modal/face-capture/save-attendance = foto V1; attendance-photo/handleCode/requestLocation = barcode V2.
- report-form + /api/report-upload = laporan V1; laporan-input + /api/laporan-pkl = laporan V2.
- shared.js + guru.js + admin.js = peran V2.

## 9. Cara Jalan
- V1: node server.js lalu buka http://localhost:3000.
- V2: `node legacy/barcode-version/server.js`, lalu buka `http://localhost:3001` ke `login.html`.
- Setup akun V1: set `ADMIN_PASSWORD` untuk admin awal; set `GURU_ID` dan `GURU_PASSWORD` untuk guru awal; restart server.
- Setup akun V2: set `ADMIN_PASSWORD`, `GURU_PASSWORD`, atau `SISWA_PASSWORD` sesuai akun yang diperlukan; restart server.
- Setup V1 data: login Guru, impor CSV, tambah lokasi di Data siswa, tetapkan penempatan atau siswa pilih saat login pertama.