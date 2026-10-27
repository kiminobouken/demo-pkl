# Demo Sistem Presensi PKL

Demo web interaktif untuk **Sistem Presensi PKL Siswa SMK Sasmita Jaya**.

## Menjalankan Demo

Jalankan server lokal dari folder ini:

```powershell
node server.js
```

Kemudian buka `http://localhost:3000` (otomatis menuju halaman masuk). Server membuat folder `data` (log presensi, koreksi, dan laporan) serta `reports` (file laporan) secara otomatis. Kamera untuk scan barcode memerlukan `localhost` atau HTTPS.

## Yang Tersedia

- Halaman masuk (`login.html`) dengan pilihan peran siswa, guru, dan admin.
- Dashboard siswa dengan ringkasan kehadiran, jadwal, lokasi perusahaan, dan riwayat presensi dari server.
- Presensi dengan scan barcode pada kartu siswa (kamera, `BarcodeDetector` atau ZXing sebagai cadangan, plus input manual untuk verifikasi server). Barcode memakai NIS dengan versi aktif di master siswa. Scan pertama hari kerja = masuk, scan kedua mulai 15:00 = pulang, dan scan ketiga ditolak.
- Unggah soft copy laporan PKL oleh siswa (PDF/DOC/DOCX, maks. 10 MB) ke folder `reports`.
- Halaman guru (`guru.html`): daftar roster SQLite, laporan masuk, dan catatan presensi.
- Halaman admin (`admin.html`): koreksi status presensi dengan alasan opsional (data scan asli tetap tersimpan, koreksi dicatat terpisah).
- Halaman keamanan akun (`account.html`): ganti password oleh semua role; akun awal dan hasil reset wajib mengganti password sebelum memakai fitur lain.
- Admin dapat mereset password akun dari halaman koreksi; reset mencabut sesi akun target.
- Rekap presensi dengan filter status hadir dan terlambat.
- Profil siswa dan detail penempatan PKL.
- Pengaturan notifikasi dengan toggle interaktif.
- Layout responsif untuk desktop dan layar mobile.

Data pada demo bersifat lokal dan simulasi. Login sekarang menggunakan session server-side, cookie HttpOnly, dan hashing `scrypt` di `auth.sqlite`. Buat akun awal dengan `ADMIN_PASSWORD`, `GURU_PASSWORD`, dan `SISWA_PASSWORD` (minimal 12 karakter) sebelum menjalankan server; password `demo1234` tidak lagi diterima. Daftar siswa bimbingan di halaman guru masih data contoh.

Akun awal yang baru dibuat memakai password sementara dan wajib menggantinya saat login pertama. Semua role dapat mengganti password melalui tautan **Ganti kata sandi** pada halaman masing-masing. Admin dapat mereset password akun dari halaman koreksi; reset mencabut sesi akun target dan mewajibkan penggantian password saat login berikutnya. Migrasi schema mempertahankan akun lama tanpa memaksa reset.

## Gambaran yang Sudah Dikonfirmasi

- Pengguna: siswa, guru pembimbing, dan admin sekolah.
- Presensi digunakan di sekolah dan perusahaan.
- Metode presensi: scan barcode pada kartu siswa (menggantikan foto wajah dan lokasi).
- Presensi memerlukan validasi, tetapi mekanismenya belum ditentukan.
- Status presensi: hadir, terlambat, alpha, dan pulang.
- Sistem perlu mencatat jam masuk dan jam pulang.
- Admin sekolah berwenang melakukan koreksi presensi.
- Setiap siswa berada di satu perusahaan.

## Keputusan V2

- Zona waktu presensi adalah Asia/Jakarta; masuk terlambat setelah 08:00 dan pulang dimulai 15:00.
- Lokasi wajib untuk masuk dan opsional untuk pulang.
- Guru melihat semua roster siswa yang aktif; Admin dapat mengoreksi status Hadir, Terlambat, Alpha, atau Pulang.

## Golden Rule

Detail yang belum ditetapkan harus ditanyakan kembali kepada pemilik proyek. Jangan membuat alur sistem atau keputusan penting tanpa konfirmasi.

## Struktur Demo

- `login.html`, `login.js` - halaman masuk, pemilihan peran, dan pengalihan password sementara.
- `account.html`, `account.js` - perubahan password dan pengalihan kembali sesuai role.
- `index.html`, `app.js` - dashboard siswa (presensi barcode, rekap, laporan PKL).
- `guru.html`, `guru.js` - halaman guru pembimbing.
- `admin.html`, `admin.js` - halaman admin (koreksi presensi).
- `shared.js` - utilitas bersama halaman guru dan admin.
- `styles.css` - visual design responsif (dipakai semua halaman).
- `server.js` - server lokal dan endpoint presensi, koreksi, serta laporan.
- `data/`, `reports/` - dibuat otomatis saat server berjalan.
- `images/` - tidak lagi dipakai sejak presensi memakai barcode.
