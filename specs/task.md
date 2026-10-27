# Task Demo Sistem Presensi PKL SMK Sasmita Jaya

Daftar task ini diturunkan dari requirements dan design. ID requirement yang dicantumkan menjadi acuan penerimaan hasil.

## 1. Fondasi dan Baseline

- [x] **TASK-001 — Menetapkan baseline aplikasi V1 dan V2**  
  Jalankan kedua server, dokumentasikan cara start, endpoint yang tersedia, dan kondisi awal database/log.  
  **Trace:** seluruh requirements; **Output:** baseline operasional.

- [x] **TASK-002 — Memisahkan konfigurasi runtime**  
  Pastikan port, path database, folder upload, dan folder log dapat dikonfigurasi tanpa mengubah source.  
  **Trace:** REQ-V1-007, REQ-V2-004.

## 2. Keamanan dan Autentikasi

- [x] **TASK-003 — Menambahkan autentikasi server dan RBAC**  
  Ganti password demo dengan autentikasi yang aman, hashing password, session server-side atau token aman, dan pemeriksaan role pada setiap endpoint. Akun awal dikonfigurasi melalui environment variable; akun baru memakai password sementara dan wajib menggantinya.  
  **Trace:** REQ-V1-001, REQ-V2-001; **Prioritas:** tinggi.

- [x] **TASK-004 — Memperbaiki keamanan static file V1**  
  Parse pathname tanpa query string dan validasi path secara konsisten untuk mencegah traversal. Tambahkan regression test.  
  **Trace:** desain §7; **Prioritas:** tinggi.

- [x] **TASK-005 — Menetapkan kebijakan privasi dan audit**  
  Tetapkan retensi foto/lokasi/laporan/audit, akses laporan berdasarkan role, audit perubahan akun dan data, masking nomor HP, serta pembatasan akses data sensitif.  
  **Trace:** batasan/keputusan terbuka; **Prioritas:** tinggi.

## 3. V1 Data Siswa dan Presensi

- [x] **TASK-006 — Menyelesaikan validasi dan impor siswa**  
  Validasi header CSV, NISN 10 digit, duplikasi, batas ukuran, pesan error, dan transaksi impor.  
  **Trace:** REQ-V1-004.

- [x] **TASK-007 — Menyelesaikan master lokasi dan penempatan**  
  Terapkan validasi panjang, keunikan, foreign key, alur pilih lokasi pertama kali, dan error handling UI.  
  **Trace:** REQ-V1-004.

- [x] **TASK-008 — Menghubungkan dashboard ke data nyata**  
  Hilangkan nilai hardcoded untuk perusahaan, jumlah presensi, tingkat kehadiran, dan statistik lain dengan agregasi dari database.  
  **Trace:** REQ-V1-002; **Prioritas:** sedang.

- [x] **TASK-009 — Menyempurnakan lifecycle presensi foto**  
  Uji izin kamera/lokasi, pembatalan, stream cleanup, format data URL, metadata gambar, dan rollback file saat insert gagal.  
  **Trace:** REQ-V1-005.

- [x] **TASK-010 — Menetapkan model status dan validasi presensi**  
  Putuskan aturan Hadir/Tidak hadir/Sakit, validasi lokasi, verifikasi foto, serta aturan masuk/pulang dan keterlambatan.  
  **Trace:** REQ-V1-003, REQ-V1-005, batasan terbuka; **Prioritas:** tinggi.

## 4. V1 Laporan dan Pengalaman Pengguna

- [x] **TASK-011 — Memperkuat upload dan penyajian laporan V1**  
  Validasi content type berdasarkan isi bila diperlukan, nama file aman, batas ukuran request, penyimpanan atomik, dan akses file terotorisasi.  
  **Trace:** REQ-V1-006.

- [x] **TASK-012 — Mengimplementasikan notifikasi berbasis data**  
  Tentukan sumber notifikasi, status dibaca, sinkronisasi preferensi, dan refresh tanpa reload penuh.  
  **Trace:** REQ-V1-006.

- [x] **TASK-013 — Menyempurnakan profil dan pengaturan**  
  Simpan profil secara persisten, ganti toggle demo dengan state nyata, dan pastikan tema tetap konsisten saat reload.  
  **Trace:** REQ-V1-006.

- [x] **TASK-022 — Menyelesaikan menu identitas dan profil kanan atas**
  Hubungkan avatar kanan atas dan tombol titik tiga pada kartu identitas ke menu yang dapat dibuka dengan mouse, keyboard, dan mobile. Sediakan tautan ke profil, pengaturan, tutorial, bantuan, dan logout sesuai role; hilangkan kontrol dekoratif yang tidak berfungsi.
  **Trace:** REQ-V1-002, REQ-V1-006, REQ-V1-008; **Prioritas:** tinggi.

- [x] **TASK-023 — Menambahkan alur ubah password V1**
  Buat UI ubah password pada login pertama dan Pengaturan, hubungkan ke `POST /api/password`, validasi minimal 12 karakter, tampilkan error/sukses, dan blokir penggunaan fitur sampai password sementara diganti.
  **Trace:** REQ-V1-001, REQ-V1-006; **Prioritas:** tinggi.

- [x] **TASK-024 — Menyempurnakan notifikasi dan pusat bantuan**
  Pastikan tombol notifikasi kanan atas membuka pusat notifikasi untuk role yang berwenang, indikator unread konsisten, dan kartu “Butuh bantuan?” membuka kontak/instruksi bantuan yang nyata.
  **Trace:** REQ-V1-002, REQ-V1-006, REQ-V1-008.

- [x] **TASK-025 — Menambahkan tutorial penggunaan aplikasi**
  Buat tutorial singkat yang dapat dibuka dari menu identitas/pengaturan dan menjelaskan login, lokasi PKL, kamera, presensi, laporan, dan navigasi untuk siswa, guru, serta admin.
  **Trace:** REQ-V1-006, REQ-V1-008.

- [x] **TASK-026 — Memperbaiki alur kamera dan tampilan kontrol presensi**
  Perjelas label dan status tombol “Buka kamera” serta “Ambil foto”, pertahankan state disabled sampai kamera aktif, pastikan foto hasil capture tidak mirror, dan tambahkan validasi browser/izin yang mudah dipahami.
  **Trace:** REQ-V1-005, REQ-V1-006, REQ-V1-008.

- [x] **TASK-027 — Menyelesaikan alur lokasi PPD dan detail lokasi kosong**
  Tampilkan usulan lokasi PPD yang disetujui pada daftar pilihan tombol edit/atur lokasi, muat ulang data setelah perubahan, dan ganti toast lokasi hardcoded dengan dialog detail lokasi tersimpan atau pesan “data lokasi belum dimasukkan”.
  **Trace:** REQ-V1-002, REQ-V1-004, REQ-V1-008; **Prioritas:** tinggi.

- [x] **TASK-028 — Menambahkan filter tiga bulan dan unduh rekap presensi**
  Tambahkan opsi periode tiga bulan terakhir, terapkan filter pada tabel dan ringkasan, lalu buat tombol unduh yang menghasilkan laporan dari hasil filter aktif dengan kondisi kosong dan error yang jelas.
  **Trace:** REQ-V1-003, REQ-V1-008.

- [x] **TASK-029 — Memverifikasi persistence setelah refresh**
  Pastikan upload laporan, foto presensi, metadata, lokasi, notifikasi baca, dan profil dimuat ulang dari server/database setelah refresh; tambahkan penanganan agar kegagalan penyimpanan tidak terlihat sebagai sukses.
  **Trace:** REQ-V1-006, REQ-V1-007, REQ-V1-008; **Prioritas:** tinggi.

- [x] **TASK-030 — Menambahkan tag lokasi dan waktu pada foto presensi**
  Tampilkan nama lokasi hasil reverse geocoding, koordinat GPS, dan waktu pengambilan sebagai overlay yang ikut tertanam pada foto. Jika lokasi atau nama tempat tidak tersedia, tampilkan koordinat atau pesan fallback tanpa menghalangi penyimpanan foto.
  **Trace:** REQ-V1-005, REQ-V1-006, REQ-V1-008.

## 5. V2 Barcode, Guru, dan Admin

- [x] **TASK-014 — Menetapkan validasi barcode dan jadwal keterlambatan**  
  Tentukan sumber kebenaran NIS, masa berlaku barcode, aturan scan pertama/kedua, jadwal masuk, dan status Terlambat/Alpha/Pulang.  
  **Trace:** REQ-V2-002, REQ-V2-003; **Prioritas:** tinggi.

- [x] **TASK-015 — Mengganti data statis V2 dengan persistence**  
  Pindahkan identitas, roster, rekap, dan data laporan dari hardcoded menjadi sumber data yang tervalidasi.  
  **Trace:** REQ-V2-002, REQ-V2-003.

- [x] **TASK-016 — Menyelesaikan alur scanner fallback**  
  Uji BarcodeDetector, fallback ZXing, kamera belakang, manual code, cleanup stream, timeout lokasi, dan state tombol simpan.  
  **Trace:** REQ-V2-002.

- [x] **TASK-017 — Menyelesaikan koreksi admin yang dapat diaudit**  
  Terapkan otorisasi admin, validasi status/ID, pencegahan koreksi tidak sah, riwayat perubahan, dan tampilan sumber vs nilai terkoreksi.  
  **Trace:** REQ-V2-003.

## 6. Testing dan Operasional

- [x] **TASK-018 — Menambahkan test API dan persistence**  
  Uji impor CSV, constraint database, upload, rollback file, attendance scan, merge koreksi, batas body, dan traversal path.  
  **Trace:** semua kontrak API.

- [x] **TASK-019 — Menambahkan test browser responsif**  
  Uji login, navigasi, kamera/lokasi dengan mock, filter rekap, upload, role visibility, tema, toast, dan layout mobile.  
  **Trace:** requirements V1/V2 dan non-fungsional.

- [x] **TASK-020 — Menambahkan observability dan backup**  
  Tambahkan logging terstruktur, health check, rotasi log, backup SQLite/JSONL, dan prosedur restore.  
  **Trace:** desain §8; **Prioritas:** sedang.

- [x] **TASK-021 — Menyusun dokumentasi pengguna dan deployment**  
  Dokumentasikan setup Node, HTTPS/localhost, izin browser, format CSV, role, alur presensi, dan troubleshooting.  
  **Trace:** kebutuhan non-fungsional dan cara jalan.

## 7. Urutan Implementasi yang Disarankan

1. TASK-001 dan TASK-002 untuk baseline serta konfigurasi.
2. TASK-003 sampai TASK-005 untuk keamanan dan keputusan privasi.
3. TASK-006 sampai TASK-010 untuk fondasi data dan presensi V1.
4. TASK-011 sampai TASK-013 untuk laporan dan UX V1.
5. TASK-022 sampai TASK-030 untuk menutup gap UX V1 dan menambahkan tag lokasi pada foto presensi.
6. TASK-014 sampai TASK-017 untuk penyempurnaan V2.
7. TASK-018 sampai TASK-021 untuk verifikasi, observability, dan dokumentasi.

TASK-005 dan TASK-006 sampai TASK-017 sudah dikonfirmasi pemilik proyek. TASK-022 sampai TASK-029 ditambahkan berdasarkan daftar fitur yang tercatat di kertas pada 18 Oktober 2026. TASK-030 menambahkan tag lokasi dan waktu pada foto presensi.

## 8. Analisis kebutuhan lanjutan akun

- **Wajib sebelum produksi:** UI administrasi akun, reset password oleh admin, penonaktifan akun, validasi NISN pada master (akun siswa hanya untuk NISN yang ada di master), dan provisioning otomatis akun siswa dari master tanpa pembuatan manual.
- **Wajib untuk RBAC yang benar:** tabel relasi guru-siswa atau guru-kelas/perusahaan; tanpa relasi ini pembatasan “siswa bimbingan” belum dapat diterapkan.
- **Wajib untuk operasional:** audit viewer untuk admin, pencatatan sesi aktif, penguncian sementara setelah percobaan login berulang, dan prosedur pemulihan akun.
- **Wajib untuk konsistensi V1/V2:** satu kebijakan password, logout, reset, role, dan format error pada kedua server.
- **Tidak boleh dilakukan:** menyimpan password di README, source code, JSONL, audit log, browser storage, atau mengandalkan role dari request body.

**Status cakupan hasil penggabungan yang dikonfirmasi:** administrasi akun, reset/nonaktifkan akun, audit dan sesi admin, validasi NISN master, provisioning otomatis akun siswa, penugasan guru-siswa, serta pengelompokan siswa per kelas dengan guru pengampu telah diimplementasikan pada V1. Guru melihat siswa yang ditugaskan langsung kepadanya atau yang berada di kelas yang ia ampu. V2 menerapkan password sementara, perubahan password per role, reset admin yang mencabut sesi, logout server-side, dan format respons akun yang sama; alur ini diuji pada skema V2 lama dan baru.
