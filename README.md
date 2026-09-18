# Demo Sistem Presensi PKL

Demo web interaktif untuk **Sistem Presensi PKL Siswa SMK Sasmita Jaya**.

## Menjalankan Demo

Jalankan server lokal dari folder ini:

```powershell
node server.js
```

Kemudian buka `http://localhost:3000`. Server akan membuat folder `images` otomatis dan menyimpan foto presensi di dalamnya.

## Yang Tersedia

- Dashboard siswa dengan ringkasan kehadiran, jadwal, lokasi perusahaan, dan riwayat presensi.
- Foto wajah dari kamera depan perangkat.
- Penyimpanan foto presensi ke folder `images`.
- Berbagi lokasi perangkat melalui Geolocation API dengan indikator akurasi.
- Rekap presensi dengan filter status hadir, tidak hadir, dan sakit.
- Profil siswa dan detail penempatan PKL.
- Pengaturan notifikasi dengan toggle interaktif.
- Pilihan tema warna tampilan yang tersimpan di browser.
- Upload laporan PKL dalam format PDF, DOC, atau DOCX maksimal 10 MB.
- Layout responsif untuk desktop dan layar mobile.

Data pada demo bersifat lokal dan simulasi. Halaman login tersedia sebagai gerbang demo berbasis `sessionStorage`, tetapi belum terhubung ke autentikasi, database, deteksi wajah otomatis, atau integrasi backend produksi. Kamera dan lokasi memerlukan izin browser serta konteks aman (`localhost` atau HTTPS).

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
- Keamanan, privasi, dan audit log.

## Golden Rule

Detail yang belum ditetapkan harus ditanyakan kembali kepada pemilik proyek. Jangan membuat alur sistem atau keputusan penting tanpa konfirmasi.

## Struktur Demo

- `index.html` - struktur halaman dan konten demo.
- `styles.css` - visual design responsif.
- `app.js` - navigasi, filter rekap, kamera, foto wajah, lokasi, dan pengiriman presensi.
- `server.js` - server lokal dan endpoint penyimpanan foto serta laporan PKL.
- `images/` - folder hasil foto presensi dan log metadata.
- `reports/` - folder laporan PKL yang diupload dan log metadata.
