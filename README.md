# Demo Sistem Presensi PKL

Demo web interaktif untuk **Sistem Presensi PKL Siswa SMK Sasmita Jaya**.

Ringkasan instalasi: [README-MULAI-CEPAT.md](README-MULAI-CEPAT.md). Panduan pemakaian per peran (admin, guru pembimbing, siswa): [TUTORIAL-V1.md](TUTORIAL-V1.md).

## Menjalankan Demo

Memerlukan Node.js 22.13 atau lebih baru.

Jalankan server lokal dari folder ini:

```powershell
node server.js
```

Kemudian buka `http://localhost:3000`. Server akan membuat folder `images` dan `data` otomatis. Foto presensi tersimpan di `images`; data siswa dan metadata presensi disimpan di SQLite `data/presensi.sqlite`. Pada hosting dengan disk persisten, `DATABASE_PATH` dapat diarahkan ke lokasi penyimpanan tersebut.

Jika password akun lupa, reset secara lokal tanpa menghapus database:

```powershell
node reset-password.js admin.sekolah
```

Perintah tersebut meminta password baru secara tersembunyi, mensyaratkan minimal 12 karakter, mengeluarkan sesi akun yang direset, dan mencatat tindakan pada audit. Gunakan ID akun yang sesuai dan jangan menaruh password di command line atau repository. Detail lengkap tersedia di [specs/account-policy.md](specs/account-policy.md).

### Konfigurasi runtime

Semua path dan port dapat diubah melalui environment variable tanpa mengubah source:

```powershell
$env:PORT = "3000"
$env:DATABASE_PATH = "data/presensi.sqlite"
$env:IMAGE_DIRECTORY = "images"
$env:REPORT_DIRECTORY = "reports"
$env:DATA_DIRECTORY = "data"
node server.js
```

V1 adalah varian utama foto + lokasi. Varian alternatif barcode dijalankan dari `legacy/barcode-version` pada port `3001`:

```powershell
$env:V2_PORT = "3001"
$env:V2_DATA_DIRECTORY = "legacy/barcode-version/data"
$env:V2_REPORT_DIRECTORY = "legacy/barcode-version/reports"
node legacy/barcode-version/server.js
```

## Yang Tersedia

- Dashboard siswa dengan ringkasan kehadiran, jadwal, lokasi perusahaan, dan riwayat presensi.
- Foto wajah dari kamera depan perangkat dengan nama lokasi, koordinat, dan waktu yang tertanam pada foto.
- Penyimpanan foto presensi ke folder `images`, hanya melalui kamera (tanpa upload foto).
- Metadata foto presensi berupa ID pengguna, peran, waktu pengambilan dan penyimpanan, lokasi koordinat beserta akurasi, ukuran/resolusi gambar, tipe file, serta informasi browser/perangkat.
- Lokasi perangkat diambil otomatis saat alur presensi dibuka; jika izin ditolak, presensi tetap dapat disimpan tanpa koordinat.
- Rekap presensi mengubah koordinat lokasi foto menjadi alamat melalui reverse geocoding dan tetap menyediakan koordinat serta tautan peta sebagai cadangan.
- Rekap presensi per hari (masuk dan pulang dalam satu baris) dengan foto presensi, filter periode (termasuk hari ini dan 3 bulan terakhir) dan status, serta unduh CSV dari filter aktif.
- Profil siswa dan detail penempatan PKL.
- Impor data siswa dari CSV dengan kolom `Nama Siswa` dan `NISN`; kolom `No. HP Orang Tua` juga ditampilkan jika tersedia.
- Guru dapat menambahkan daftar PT/alamat tempat PKL dan menetapkan lokasi melalui tabel siswa.
- Siswa yang belum memiliki penempatan diminta memilih lokasi saat login pertama kali; pilihannya disimpan pada data siswa.
- Pengaturan notifikasi dengan toggle interaktif, ubah password, tutorial per peran, dan dialog bantuan.
- Guru memvalidasi laporan (Valid / Perlu revisi) dan siswa melihat statusnya. Admin mengelola akun, kelas, penugasan guru, dan melihat audit log.
- Pilihan tema warna tampilan yang tersimpan di browser.
- Upload laporan PKL dalam format PDF, DOC, atau DOCX maksimal 10 MB.
- Layout responsif untuk desktop dan layar mobile.

Untuk setup demo, login sebagai Guru, impor CSV siswa, lalu tambahkan lokasi PKL pada halaman Data siswa. Guru dapat menetapkan lokasi dari kolom Tempat PKL atau membiarkan siswa memilihnya pada login pertama. Data siswa, master lokasi, penempatan, dan metadata presensi dibaca dari SQLite; bila belum ada presensi, rekap menampilkan keadaan kosong. Foto dan laporan tetap berupa file lokal. Autentikasi menggunakan session server-side di SQLite, cookie HttpOnly, dan hashing password `scrypt`. Set `ADMIN_PASSWORD` (minimal 12 karakter) untuk membuat akun admin pertama saat server dijalankan; `GURU_ID` dan `GURU_PASSWORD` dapat dipakai untuk membuat akun guru awal. Role siswa harus dibuat oleh admin/guru melalui proses administrasi akun. Akun baru wajib mengganti password sementara melalui `POST /api/password`; admin dapat membuat semua role dan guru dapat membuat akun siswa melalui `POST /api/users`. API memeriksa sesi dan role di server, bukan hanya menyembunyikan kontrol UI. Kamera dan lokasi memerlukan izin browser serta konteks aman (`localhost` atau HTTPS).

## Panduan Penggunaan

### Peran dan hak akses

Hak akses diperiksa di server pada setiap permintaan; menyembunyikan tombol di tampilan hanyalah kemudahan, bukan pengaman.

| Peran | Boleh | Tidak boleh |
| --- | --- | --- |
| Siswa | Presensi (foto + lokasi), melihat rekap sendiri, memilih atau mengusulkan tempat PKL, mengunggah laporan dan melihat status validasinya | Melihat data siswa lain, halaman guru dan admin |
| Guru pembimbing | Memantau **siswa yang diampu** (siswa di kelas yang ditugaskan, atau yang ditugaskan langsung oleh admin): rekap beserta foto presensi, data siswa dan penempatan, usulan lokasi, validasi laporan (Valid / Perlu revisi), notifikasi, impor CSV (siswa impor masuk ke kelas guru, atau ditugaskan langsung bila guru belum memegang kelas) | Presensi, mengunggah laporan, kelola akun/kelas, audit, siswa kelas lain |
| Admin | Seluruh data, kelola akun, kelas dan penugasan guru ke kelas, penugasan siswa ke guru, data guru, sesi aktif, audit log, impor siswa, persetujuan lokasi | Presensi dan validasi laporan (hak guru pembimbing) |

### Setup pertama kali

1. Set `ADMIN_PASSWORD` (minimal 12 karakter), jalankan `node server.js`, lalu login sebagai admin dan ganti password sementara.
2. **Kelas & guru**: tambah kelas. **Kelola akun**: buat akun guru, lalu tugaskan guru ke kelasnya. Siswa tertentu juga dapat ditugaskan langsung ke satu guru lewat **Kelola akun → Penugasan pembimbing**. Master guru dari CSV dapat diimpor dengan `node import-teachers.js` (lihat Master guru di bawah).
3. **Data siswa**: impor CSV (lihat format di bawah). Admin dapat mengatur kelas tiap siswa dari tabel; guru yang memegang satu kelas otomatis memasukkan siswa impor ke kelasnya. Impor juga **membuat akun siswa otomatis** (ID = NISN, password sementara = NISN) yang wajib diganti saat login pertama.
4. **Kelola akun**: akun siswa sudah dibuat otomatis saat impor; pakai **Atur ulang password** untuk memberi password sementara lain. Membuat akun siswa manual hanya perlu bila akunnya belum ada (ID = NISN yang sudah ada di data siswa). Setiap akun baru atau yang di-reset wajib mengganti password saat login pertama; sebelum itu seluruh API ditolak server.
5. Guru menambahkan tempat PKL. Siswa memilih tempat PKL saat login pertama, atau mengusulkan tempat baru yang akan muncul di pilihan setelah disetujui guru/admin.

> **Memperbarui database lama:** saat dijalankan, server menambahkan tabel/kolom baru (kelas, penugasan guru, validasi laporan, status akun) tanpa menghapus data. Guru hanya melihat siswa yang diampu, jadi **guru tidak akan melihat siswa sampai admin menugaskan kelas atau siswa kepadanya.** Database format versi B (kolom `users.active`) dimigrasikan otomatis ke `is_active`. Database format versi A lama memakai tabel `report_reviews` dengan kolom berbeda dan **tidak** dimigrasikan otomatis; mulailah dari database kosong. Buat backup sebelum memperbarui (`node scripts/backup.js`).

### Alur presensi

- Dashboard siswa → **Presensi sekarang** → izinkan lokasi dan kamera → **Buka kamera** → **Ambil foto** (bisa **Ambil ulang**) → **Simpan presensi**.
- Foto pertama pada hari itu tercatat sebagai presensi **masuk**, foto kedua sebagai **pulang**; lebih dari dua ditolak.
- Presensi hanya pada hari kerja (Senin–Jumat). Masuk setelah pukul 08.00 WIB berstatus **Terlambat**.
- Jika tempat PKL punya koordinat dan lokasi siswa lebih dari 200 m darinya, presensi tetap tersimpan tetapi ditandai "perlu review".
- Guru melihat foto presensi hari ini di Dashboard dan di Rekap presensi (filter **Hari ini**). Rekap dapat difilter per periode (semua, hari ini, bulan ini, 3 bulan terakhir) dan status, lalu diunduh sebagai CSV sesuai filter aktif.

### Format CSV siswa

```csv
Nama Siswa,NISN,No. HP Orang Tua,Kelas
Budi Santoso,1111111111,081234567890,XII RPL 1
```

- Kolom wajib: `Nama Siswa` (atau `Nama`) dan `NISN` (tepat 10 angka). Opsional: `No. HP Orang Tua` (format nomor Indonesia) dan `Kelas`.
- Header tidak boleh ganda, NISN tidak boleh dobel, ukuran maksimal 2 MB. Impor bersifat **atomik**: jika satu baris salah, tidak ada data yang tersimpan, dan pesan error menyebut nomor barisnya.
- Admin: kelas yang belum ada dibuat otomatis. Guru: kolom `Kelas` harus kelas yang ia ampu; bila dikosongkan dan guru memegang satu kelas, siswa masuk ke kelas itu. Siswa milik kelas atau pembimbing lain tidak dapat diambil alih. Guru yang belum memegang kelas tetap dapat mengimpor: siswanya ditugaskan langsung kepadanya.
- Nomor HP orang tua hanya tampil dimasking (contoh `0812*****890`) dan tidak dikirim penuh ke browser.

### HTTPS, localhost, dan izin browser

- Kamera dan lokasi hanya berfungsi pada **konteks aman**: `http://localhost` atau `https://`. Membuka aplikasi lewat `http://192.168.x.x` dari ponsel akan membuat kamera tidak tersedia; pasang reverse proxy HTTPS (mis. Caddy atau nginx) atau layanan tunnel HTTPS di depan `node server.js`.
- Saat diminta, pilih **Izinkan** untuk kamera dan lokasi. Jika sempat menolak: ikon gembok di address bar → Izin situs → aktifkan Kamera dan Lokasi → muat ulang.
- Lokasi opsional: tanpa izin lokasi presensi tetap dapat disimpan tanpa koordinat.
- Alamat dari koordinat diperoleh dari OpenStreetMap Nominatim dan memerlukan internet; bila gagal, koordinat tetap tampil.

### Konfigurasi tambahan

| Variabel | Fungsi |
| --- | --- |
| `HELP_CONTACT_NAME`, `HELP_CONTACT_EMAIL`, `HELP_CONTACT_PHONE`, `HELP_CONTACT_NOTE` | Kontak yang tampil di dialog **Butuh bantuan?**. Jika kosong, dialog meminta pengguna menghubungi guru/admin langsung. |
| `LOG_MAX_BYTES`, `LOG_MAX_FILES` | Ukuran maksimum `app.log` sebelum dirotasi (default 5 MB) dan jumlah file rotasi yang disimpan (default 5). |
| `BACKUP_DIRECTORY`, `BACKUP_KEEP` | Lokasi backup (default `backups`) dan jumlah backup terbaru yang dipertahankan (default 14). |

## Operasional

- **Health check:** `GET /healthz` mengembalikan `{"ok":true,"status":"ok"}` bila server dan database sehat (503 bila database bermasalah). Cocok untuk monitor uptime. Alias `GET /api/health` mengembalikan `{"ok":true,"status":"healthy"}`.
- **Log terstruktur:** satu baris JSON per kejadian di `data/logs/app.log` (waktu, level, method, path tanpa query, status, durasi, user). Password dan isi permintaan tidak dicatat. File dirotasi menjadi `app.log.1`, `app.log.2`, dan seterusnya.
- **Backup** (aman saat server berjalan): `node scripts/backup.js` membuat folder `backups/presensi-<waktu>/` berisi snapshot SQLite, foto presensi, serta laporan beserta `laporan-log.jsonl`. Jadwalkan harian, contoh Windows (sesuaikan path):

  ```powershell
  schtasks /Create /SC DAILY /ST 18:00 /TN "Backup Presensi PKL" /TR "\"C:\Program Files\nodejs\node.exe\" \"C:\PKM\demo-pkl-docs-update-task-list\demo-pkl-docs-update-task-list\scripts\backup.js\""
  ```

- **Restore:** (1) hentikan server; (2) `node scripts/restore.js backups/presensi-<waktu> --yes`; (3) jalankan server lagi dan periksa data. Skrip menolak berjalan tanpa `--yes` atau saat server masih hidup, dan menyimpan database lama sebagai `presensi.sqlite.sebelum-restore-<waktu>` sebelum menggantinya. Foto/laporan dengan nama sama ditimpa; file lain dibiarkan.
- Simpan salinan `backups/` di perangkat atau drive lain, bukan hanya di komputer yang sama.
- **Backup tambahan (database akun V2 dan JSONL):** `node backup.js "C:\backup\presensi-2026-10-24"` lalu `node restore-backup.js "C:\backup\presensi-2026-10-24" "C:\restore\presensi"`. Keduanya menolak menimpa folder tujuan dan tidak mencakup foto/laporan; untuk media gunakan `scripts/backup.js`.

### Master guru

`data/database_guru.csv` adalah master guru contoh (nama, NIP 10 digit, telepon). Mengimpornya bersifat opsional dan hanya mengisi daftar **Data guru** di halaman Kelola akun:

```powershell
node import-teachers.js data/database_guru.csv "1020304051,1020304062"
```

Argumen: file CSV, daftar NIP yang dibuatkan akun guru (password sementara = NIP, wajib diganti saat login pertama), NIP tujuan untuk memindahkan seluruh penugasan siswa (opsional), dan ID admin tambahan (opsional). Ganti isi CSV dengan data guru sekolah sebelum dipakai sungguhan.

## Pengujian

```powershell
npm test                # tes API, RBAC, integritas, backup/restore, penugasan guru-siswa, V2 (hanya butuh Node)
npm install             # sekali, untuk tes browser
npx playwright install chromium
npm run test:browser    # tes browser: login per peran, kamera palsu, presensi, rekap, laporan, admin, tampilan ponsel
```

Tes memakai database dan folder sementara, tidak menyentuh `data/`, `images/`, atau `reports/`. Jika Chromium sudah ada di komputer, atur `CHROMIUM_PATH` ke file executable-nya. `npm run test:browser` menjalankan dua project: `e2e` (aplikasi utama, `tests/e2e`) dan `v2-barcode` (`tests/v2-browser.spec.js`). `tests/browser.spec.js` berasal dari tampilan sebelum redesign, tidak dijalankan, dan skenarionya sudah dicakup `tests/e2e`.

## Troubleshooting

| Gejala | Penyebab dan solusi |
| --- | --- |
| `EADDRINUSE` saat menjalankan server | Port 3000 dipakai aplikasi lain. Set `$env:PORT = "3001"` lalu jalankan ulang. |
| Pesan `ExperimentalWarning: SQLite` | Normal pada Node 22; tidak berbahaya. Gunakan Node 22.13 atau lebih baru. |
| Tombol Buka kamera menampilkan "Kamera tidak tersedia" | Halaman tidak memakai `localhost`/HTTPS, atau browser terlalu lama. Lihat bagian HTTPS di atas. |
| "Izin kamera ditolak" | Aktifkan izin kamera untuk situs di pengaturan browser, lalu klik Buka kamera lagi. |
| "Kamera sedang dipakai aplikasi lain" | Tutup aplikasi lain yang memakai kamera (Zoom, Meet, dll.). |
| "Presensi hanya dapat dicatat pada hari kerja" | Presensi Sabtu/Minggu ditolak server. |
| "Presensi masuk dan pulang hari ini sudah tercatat" | Batas dua foto per hari tercapai. |
| "Peran yang dipilih tidak sesuai dengan akun" | Pilihan peran di halaman login harus sama dengan peran akun. |
| "Terlalu banyak percobaan login" | Tujuh kali gagal mengunci ID selama 3 menit; bila gagal lagi setelah masa tunggu, 2 kegagalan berikutnya mengunci 5 menit. Menjalankan ulang server menghapus kuncian. |
| Lupa password | `node reset-password.js <id-akun>` (lihat di atas), atau admin memakai **Atur ulang password** di Kelola akun. |
| Guru melihat daftar siswa kosong | Admin belum menugaskan guru ke kelas atau menugaskan siswa langsung (Kelola akun → Penugasan pembimbing), atau siswa belum diberi kelas. |
| "NISN belum terdaftar di master siswa" saat membuat akun siswa | Impor siswa lebih dulu; akunnya dibuat otomatis saat impor. |
| "ID sudah terdaftar" saat membuat akun siswa | Akun siswa sudah dibuat otomatis saat impor. Gunakan **Atur ulang password** untuk memberi password sementara baru. |
| "Data siswa belum terdaftar" saat siswa login | Akun ada tetapi NISN tidak ada di data siswa; hubungi admin. |
| Siswa tidak melihat tempat PKL baru yang diusulkan | Usulan harus disetujui guru atau admin (panel Usulan tempat PKL di Data siswa). |

## Gambaran yang Sudah Dikonfirmasi

- Pengguna: siswa, guru pembimbing, dan admin sekolah.
- Presensi digunakan di sekolah dan perusahaan.
- Metode presensi: foto wajah dan lokasi perangkat pada demo.
- Presensi memerlukan validasi, tetapi mekanismenya belum ditentukan.
- Status presensi: hadir, tidak hadir, dan sakit.
- Sistem perlu mencatat jam masuk dan jam pulang.
- Admin sekolah berwenang melakukan koreksi presensi.
- Setiap siswa berada di satu perusahaan.

## Batasan dan Keputusan yang Masih Terbuka

- Aturan verifikasi foto wajah.
- Mekanisme validasi.
- Detail hak akses admin dan guru pembimbing.
- Detail data siswa dan perusahaan.
- Laporan, notifikasi, dan integrasi.
- Keamanan, privasi, dan audit log dikonfirmasi untuk implementasi: foto disimpan maksimal 2 tahun, lokasi maksimal 3 tahun, laporan selama tahun ajaran + 1 tahun, dan audit log 2 tahun. Nomor HP dimasking di UI; ekspor data sensitif dibatasi untuk guru/admin. Audit mencatat login sukses/gagal, logout, akun, perubahan password, lokasi, presensi, upload/akses laporan, koreksi, dan proses retensi dengan actor, target, waktu, alamat IP, dan user-agent bila tersedia.

## Golden Rule

Detail yang belum ditetapkan harus ditanyakan kembali kepada pemilik proyek. Jangan membuat alur sistem atau keputusan penting tanpa konfirmasi.

## Struktur Demo

Panduan lengkap pembuatan dan penggunaan akun tersedia di [specs/account-policy.md](specs/account-policy.md). Jangan menaruh password nyata di repository.

- `public/index.html` - shell dokumen; markup halaman dirakit dari partial oleh server.
- `public/views/` - partial login, app shell, dan modal.
- `public/styles.css` - visual design responsif.
- `public/app.js` - sesi, navigasi, filter rekap, kamera, foto wajah, lokasi, laporan, dan pengiriman presensi.
- `public/account.js` - menu akun, ubah password, bantuan, dan tutorial.
- `public/admin.js` - halaman admin (akun, kelas, penugasan pembimbing, data guru, sesi aktif, audit).
- `scripts/` - `backup.js` dan `restore.js` (SQLite, foto, laporan).
- `backup.js` / `restore-backup.js` - backup dan pemulihan database akun V2 dan JSONL tanpa menimpa folder tujuan.
- `import-teachers.js` - impor master guru dari CSV; `reset-password.js` - reset password akun secara lokal.
- `login-attempt-limiter.js` - pembatas percobaan login (dipakai server).
- `tests/` - tes Node (`npm test`) dan tes browser Playwright (`tests/e2e`).
- `server.js` - server lokal dan endpoint aplikasi.
- `data/` - database SQLite dan data awal yang diperlukan demo.
- `images/` - foto presensi dan metadata runtime.
- `reports/` - laporan PKL yang diupload dan metadata runtime.
- `specs/` - spesifikasi dan dokumentasi kebutuhan.
- `legacy/barcode-version/` - implementasi lama berbasis barcode, disimpan sebagai referensi dan tidak dijalankan oleh server utama.

Server utama hanya menyajikan asset dari `public/` serta file runtime dari `images/` dan `reports/`. Folder legacy tidak menjadi bagian dari aplikasi aktif.

Alamat lokasi presensi diperoleh dari OpenStreetMap Nominatim. Koordinat asli tetap disimpan di database untuk audit dan tautan peta.

## Baseline operasional TASK-001

Baseline yang dikonfirmasi pada 18 Oktober 2026:

- **V1 prioritas:** `node server.js`, `http://localhost:3000`.
- **V2 alternatif barcode:** `node legacy/barcode-version/server.js`, `http://localhost:3001`.
- **V1 endpoint:** `GET /api/students`, `GET /api/students/:nisn`, `POST /api/students/import`, `GET/POST /api/pkl-locations`, `PUT /api/students/:nisn/location`, `GET /api/location-address`, `GET /api/attendance-records`, `POST /api/attendance-photo` (siswa), `POST /api/report-upload` (siswa), `GET /api/reports`, `POST /api/reports/:file/review` (guru), `GET/POST /api/pkl-location-requests` serta `POST .../:id/approve|reject`, `GET/POST /api/users` (+ `reset-password`, `active`), `GET/POST /api/classes` (+ penugasan guru), `PUT /api/students/:nisn/class`, `GET /api/audit-logs` (admin), `GET /api/config`, dan `GET /healthz`.
- **V2 endpoint:** `POST /api/attendance-scan`, `POST /api/attendance-correction`, `GET /api/attendance-log`, `POST /api/laporan-pkl`, dan `GET /api/laporan-pkl`.
- **Kondisi awal V1:** database SQLite tetap di `data/presensi.sqlite`; data runtime lama di `images/` dan `reports/` dipertahankan.
- **Kondisi awal V2:** log dan laporan tetap dipertahankan di `legacy/barcode-version/data/` dan `legacy/barcode-version/reports/`.

Konfigurasi TASK-002 menggunakan environment variable. Nilai default tidak mengubah lokasi data yang sudah ada.
