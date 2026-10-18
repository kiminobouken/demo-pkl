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

- [ ] **TASK-018 — Menambahkan test API dan persistence**  
  Uji impor CSV, constraint database, upload, rollback file, attendance scan, merge koreksi, batas body, dan traversal path.  
  **Trace:** semua kontrak API.

- [ ] **TASK-019 — Menambahkan test browser responsif**  
  Uji login, navigasi, kamera/lokasi dengan mock, filter rekap, upload, role visibility, tema, toast, dan layout mobile.  
  **Trace:** requirements V1/V2 dan non-fungsional.

- [ ] **TASK-020 — Menambahkan observability dan backup**  
  Tambahkan logging terstruktur, health check, rotasi log, backup SQLite/JSONL, dan prosedur restore.  
  **Trace:** desain §8; **Prioritas:** sedang.

- [ ] **TASK-021 — Menyusun dokumentasi pengguna dan deployment**  
  Dokumentasikan setup Node, HTTPS/localhost, izin browser, format CSV, role, alur presensi, dan troubleshooting.  
  **Trace:** kebutuhan non-fungsional dan cara jalan.

## 7. Urutan Implementasi yang Disarankan

1. TASK-001 dan TASK-002 untuk baseline serta konfigurasi.
2. TASK-003 sampai TASK-005 untuk keamanan dan keputusan privasi.
3. TASK-006 sampai TASK-010 untuk fondasi data dan presensi V1.
4. TASK-011 sampai TASK-013 untuk laporan dan UX V1.
5. TASK-014 sampai TASK-017 untuk penyempurnaan V2.
6. TASK-018 sampai TASK-021 untuk verifikasi, observability, dan dokumentasi.

TASK-005 dan TASK-006 sampai TASK-017 sudah dikonfirmasi pemilik proyek.

## 8. Analisis kebutuhan lanjutan akun

- **Wajib sebelum produksi:** UI administrasi akun, reset password oleh admin, penonaktifan akun, dan validasi bahwa akun siswa memiliki NISN di master.
- **Wajib untuk RBAC yang benar:** tabel relasi guru-siswa atau guru-kelas/perusahaan; tanpa relasi ini pembatasan “siswa bimbingan” belum dapat diterapkan.
- **Wajib untuk operasional:** audit viewer untuk admin, pencatatan sesi aktif, penguncian sementara setelah percobaan login berulang, dan prosedur pemulihan akun.
- **Wajib untuk konsistensi V1/V2:** satu kebijakan password, logout, reset, role, dan format error pada kedua server.
- **Tidak boleh dilakukan:** menyimpan password di README, source code, JSONL, audit log, browser storage, atau mengandalkan role dari request body.
