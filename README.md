# Demo Sistem Presensi PKL

Demo web interaktif untuk **Sistem Presensi PKL Siswa SMK Sasmita Jaya**.

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
- Foto wajah dari kamera depan perangkat.
- Penyimpanan foto presensi ke folder `images`, hanya melalui kamera (tanpa upload foto).
- Metadata foto presensi berupa ID pengguna, peran, waktu pengambilan dan penyimpanan, lokasi koordinat beserta akurasi, ukuran/resolusi gambar, tipe file, serta informasi browser/perangkat.
- Lokasi perangkat diambil otomatis saat alur presensi dibuka; jika izin ditolak, presensi tetap dapat disimpan tanpa koordinat.
- Rekap presensi mengubah koordinat lokasi foto menjadi alamat melalui reverse geocoding dan tetap menyediakan koordinat serta tautan peta sebagai cadangan.
- Rekap presensi dengan filter status hadir, tidak hadir, dan sakit.
- Profil siswa dan detail penempatan PKL.
- Impor data siswa dari CSV dengan kolom `Nama Siswa` dan `NISN`; kolom `No. HP Orang Tua` juga ditampilkan jika tersedia.
- Guru dapat menambahkan daftar PT/alamat tempat PKL dan menetapkan lokasi melalui tabel siswa.
- Siswa yang belum memiliki penempatan diminta memilih lokasi saat login pertama kali; pilihannya disimpan pada data siswa.
- Pengaturan notifikasi dengan toggle interaktif.
- Pilihan tema warna tampilan yang tersimpan di browser.
- Upload laporan PKL dalam format PDF, DOC, atau DOCX maksimal 10 MB.
- Layout responsif untuk desktop dan layar mobile.

Untuk setup demo, login sebagai Guru, impor CSV siswa, lalu tambahkan lokasi PKL pada halaman Data siswa. Guru dapat menetapkan lokasi dari kolom Tempat PKL atau membiarkan siswa memilihnya pada login pertama. Data siswa, master lokasi, penempatan, dan metadata presensi dibaca dari SQLite; bila belum ada presensi, rekap menampilkan keadaan kosong. Foto dan laporan tetap berupa file lokal. Autentikasi menggunakan session server-side di SQLite, cookie HttpOnly, dan hashing password `scrypt`. Set `ADMIN_PASSWORD` (minimal 12 karakter) untuk membuat akun admin pertama saat server dijalankan; `GURU_ID` dan `GURU_PASSWORD` dapat dipakai untuk membuat akun guru awal. Role siswa harus dibuat oleh admin/guru melalui proses administrasi akun. Akun baru wajib mengganti password sementara melalui `POST /api/password`; admin dapat membuat semua role dan guru dapat membuat akun siswa melalui `POST /api/users`. API memeriksa sesi dan role di server, bukan hanya menyembunyikan kontrol UI. Kamera dan lokasi memerlukan izin browser serta konteks aman (`localhost` atau HTTPS).

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
- `public/app.js` - navigasi, filter rekap, kamera, foto wajah, lokasi, dan pengiriman presensi.
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
- **V1 endpoint:** `GET /api/students`, `GET /api/students/:nisn`, `POST /api/students/import`, `GET/POST /api/pkl-locations`, `PUT /api/students/:nisn/location`, `GET /api/attendance-records`, `POST /api/attendance-photo`, `POST /api/report-upload`, dan `GET /api/reports`.
- **V2 endpoint:** `POST /api/attendance-scan`, `POST /api/attendance-correction`, `GET /api/attendance-log`, `POST /api/laporan-pkl`, dan `GET /api/laporan-pkl`.
- **Kondisi awal V1:** database SQLite tetap di `data/presensi.sqlite`; data runtime lama di `images/` dan `reports/` dipertahankan.
- **Kondisi awal V2:** log dan laporan tetap dipertahankan di `legacy/barcode-version/data/` dan `legacy/barcode-version/reports/`.

Konfigurasi TASK-002 menggunakan environment variable. Nilai default tidak mengubah lokasi data yang sudah ada.
