# Design Demo Sistem Presensi PKL SMK Sasmita Jaya

## 1. Ringkasan Arsitektur

Repository berisi dua demo yang menggunakan arsitektur server HTTP Node.js tanpa framework:

```text
Browser
  ├── V1 root: index.html/app.js/styles.css
  └── V2 subfolder: login.html, index.html, guru.html, admin.html, shared.js
             │
             ▼
      Node node:http server
             │
  ┌──────────┴──────────┐
  │                     │
  V1 SQLite + files     V2 JSONL + files
```

- Server berjalan di `http://localhost:3000`.
- V1 membutuhkan Node 22.13 atau lebih baru karena menggunakan `node:sqlite` dan `DatabaseSync`.
- V1 adalah single-page application dengan `login-screen` dan `app-shell`.
- V2 menggunakan beberapa halaman dan redirect berdasarkan role.

## 2. Struktur Modul dan Tanggung Jawab

### V1 root

- `index.html`: layar login dan shell aplikasi.
- `app.js`: sesi, navigasi, dashboard, siswa, lokasi, rekap, presensi foto, laporan, notifikasi, profil, dan pengaturan.
- `styles.css`: tema dan layout responsif.
- `server.js`: static file server, API, parsing CSV, SQLite, dan penyimpanan file.
- `users`, `sessions`, dan `audit_logs` di SQLite: autentikasi, sesi, RBAC, dan jejak perubahan.
- `images/`: foto presensi.
- `reports/`: laporan yang diunggah.
- `data/presensi.sqlite`: database SQLite.

### V2 `demo-system-presensi-pkl`

- `login.html`/`login.js`: login dan routing role.
- `index.html`/`app.js`: pengalaman siswa dan barcode.
- `guru.html`/`guru.js`: roster, laporan, dan presensi guru.
- `admin.html`/`admin.js`: presensi dan koreksi admin.
- `shared.js`: helper fetch, status pill, toast, format tanggal/ukuran, escaping HTML, dan hint server.
- `server.js`: API JSONL, upload, koreksi, dan static file server.
- `auth.sqlite`: akun, hash password, dan sesi server-side V2.
- `presensi-log`, `presensi-koreksi`, `laporan-log`: log operasional JSONL.

## 3. Alur Utama

### 3.1 V1 login dan penempatan

```text
Login
  -> POST /api/login
  -> session server-side + cookie HttpOnly
  -> jika wajib ganti password: POST /api/password
  -> jika siswa: GET /api/students/:nisn
  -> jika belum punya lokasi: dialog pilih/tambah/lewati
  -> dashboard
```

### 3.2 V1 presensi foto

```text
Buka modal
  -> request geolocation (opsional)
  -> aktifkan kamera depan
  -> capture frame ke canvas
  -> POST /api/attendance-photo
  -> simpan file images + metadata SQLite
  -> refresh rekap
```

Jika insert database gagal, server menghapus file foto yang sudah dibuat.

### 3.3 V2 presensi barcode

```text
Buka modal
  -> request geolocation (wajib)
  -> BarcodeDetector / fallback ZXing
  -> cocokkan kode dengan NIS
  -> tentukan masuk atau pulang berdasarkan scan hari itu
  -> POST /api/attendance-scan
  -> append presensi-log JSONL
```

### 3.4 V2 koreksi admin

```text
Presensi asli + koreksi JSONL
  -> merge koreksi terbaru berdasarkan ID
  -> admin memilih status baru
  -> append presensi-koreksi.jsonl
  -> data asli tetap utuh
```

## 4. Model Data V1

### `students`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `nisn` | TEXT PK | NISN siswa |
| `name` | TEXT NOT NULL | Nama siswa |
| `parent_phone` | TEXT NOT NULL | Nomor HP orang tua |
| `pkl_location_id` | INTEGER FK | Referensi lokasi PKL |

### `pkl_locations`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | ID lokasi |
| `company_name` | TEXT NOT NULL | Nama perusahaan |
| `address` | TEXT NOT NULL | Alamat |

Kombinasi `company_name` dan `address` unik.

### `attendance_records`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | ID record |
| `filename` | TEXT UNIQUE NOT NULL | Nama file foto |
| `user_id`, `role` | TEXT NOT NULL | Identitas pengirim |
| `status` | TEXT DEFAULT `Hadir` | Status presensi |
| `captured_at`, `received_at` | TEXT NOT NULL | Waktu foto dan server |
| `latitude`, `longitude`, `accuracy` | REAL | Metadata lokasi opsional |
| `image_width`, `image_height` | INTEGER | Dimensi foto |
| `image_size_bytes` | INTEGER NOT NULL | Ukuran file |
| `image_type`, `user_agent` | TEXT NOT NULL | Metadata teknis |

## 5. Model Data V2

- `presensi-log.jsonl`: ID UUID, NIS, nama, kelas, kode, tanggal, waktu, tipe masuk/pulang, metadata, dan `createdAt`.
- `presensi-koreksi.jsonl`: ID record, status baru, `correctedBy`, dan `correctedAt`.
- `laporan-log.jsonl`: metadata laporan siswa dan lokasi file.
- Data koreksi diterapkan sebagai overlay koreksi terbaru, bukan update in-place terhadap log asli.

## 6. Kontrak API

### V1

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/api/students` | Daftar siswa dengan lokasi |
| GET | `/api/students/:nisn` | Detail siswa |
| POST | `/api/students/import` | Impor CSV |
| PUT | `/api/students/:nisn/location` | Tetapkan lokasi |
| GET/POST | `/api/pkl-locations` | Daftar/buat lokasi |
| GET | `/api/attendance-records` | Daftar rekap |
| POST | `/api/attendance-photo` | Simpan foto dan record |
| POST | `/api/report-upload` | Simpan laporan |
| GET | `/api/reports` | Daftar laporan |
| POST | `/api/login` | Verifikasi akun dan membuat sesi |
| GET | `/api/session` | Mengambil sesi aktif dan role |
| POST | `/api/logout` | Menghapus sesi aktif |
| POST | `/api/password` | Mengganti password akun aktif |
| POST | `/api/users` | Membuat akun baru sesuai kewenangan |

### V2

| Method | Endpoint | Fungsi |
|---|---|---|
| POST | `/api/attendance-scan` | Simpan scan masuk/pulang |
| GET | `/api/attendance-log` | Ambil log presensi |
| POST | `/api/attendance-correction` | Tambah koreksi admin |
| POST/GET | `/api/laporan-pkl` | Simpan/ambil laporan PKL |
| POST | `/api/login` | Verifikasi akun dan membuat sesi |
| GET | `/api/session` | Mengambil sesi aktif dan role |
| POST | `/api/logout` | Menghapus sesi aktif |

## 7. Penyajian File dan Keamanan

- V1 menggunakan static file server dan perlu memperbaiki validasi path karena query string pada `request.url` dapat ikut diproses.
- V2 sudah memblokir traversal `dotdot` dan dotfiles.
- Upload harus memvalidasi MIME, ekstensi, ukuran, dan nama file aman.
- Render dinamis harus menggunakan escaping HTML.
- Batas body V2: 100 KB untuk scan dan 10 MB untuk laporan.
- Siswa hanya boleh mengakses foto dan laporan miliknya; guru/admin mengakses data sesuai kewenangan.
- Password tidak boleh masuk log aplikasi atau audit.

## 8. Konfigurasi dan Operasional

- V1 mendukung `DATABASE_PATH`.
- V1 mendukung `ADMIN_ID`, `ADMIN_PASSWORD`, `GURU_ID`, dan `GURU_PASSWORD`; password minimal 12 karakter.
- V2 mendukung `V2_ADMIN_ID`, `V2_GURU_ID`, `V2_SISWA_ID`, serta `ADMIN_PASSWORD`, `GURU_PASSWORD`, dan `SISWA_PASSWORD`.
- Port default kedua varian adalah 3000.
- V1 dijalankan dengan `node server.js` dari root.
- V2 dijalankan dengan `cd demo-system-presensi-pkl` lalu `node server.js`.
- Browser harus mengakses melalui localhost atau HTTPS untuk kamera dan geolokasi.

## 9. Peta Implementasi

- Sesi V1: `index.html`, `app.js` (`setAuthenticated`, `restoreCurrentUser`).
- Siswa/lokasi V1: `app.js` (`loadStudents`, `loadPklLocations`, `showStudentLocationDialog`) dan `server.js` (`parseCsv`).
- Rekap V1: `app.js` (`rowMarkup`, `renderFullTable`, `renderRecentTable`, `updateAttendanceSummary`).
- Foto V1: modal kamera, `face-capture`, dan endpoint `attendance-photo`.
- Barcode V2: `attendance-photo`, `handleCode`, `requestLocation`, dan endpoint `attendance-scan`.
- Laporan: `report-form` + `/api/report-upload` untuk V1; `laporan-input` + `/api/laporan-pkl` untuk V2.
- Peran V2: `shared.js`, `guru.js`, dan `admin.js`.
