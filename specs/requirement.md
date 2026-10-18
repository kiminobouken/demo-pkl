# Requirements Demo Sistem Presensi PKL SMK Sasmita Jaya

Dokumen ini memuat kebutuhan fungsional, aktor, aturan bisnis, dan kebutuhan non-fungsional yang diekstrak dari `SPECS.md`. Sistem memiliki dua varian demo:

- **V1 Foto + Lokasi** pada root repository.
- **V2 Barcode** pada folder `demo-system-presensi-pkl`.

## 1. Aktor dan Aturan Bisnis

- Sistem mendukung peran **Siswa/Siswi**, **Guru pembimbing**, dan **Admin sekolah**.
- Presensi digunakan di sekolah dan perusahaan tempat PKL.
- Setiap siswa dapat ditempatkan pada satu perusahaan.
- Sistem mencatat waktu masuk dan pulang.
- Admin berwenang melakukan koreksi presensi.
- Presensi harus memiliki mekanisme validasi; mekanisme final belum ditentukan.

### 1.1 Kebijakan penggunaan akun

| Role | Cara akun dibuat | Akses utama |
|---|---|---|
| **Admin sekolah** | Akun pertama dibuat saat server dijalankan menggunakan `ADMIN_PASSWORD` dan opsional `ADMIN_ID`. Akun admin berikutnya dibuat oleh admin. | Seluruh data, seluruh laporan, manajemen akun, koreksi presensi, audit, dan retensi. |
| **Guru pembimbing** | Akun awal dapat dibuat melalui `GURU_ID` dan `GURU_PASSWORD`. Akun guru berikutnya dibuat admin. | Data siswa yang menjadi tanggung jawabnya, lokasi PKL, impor siswa, presensi, dan laporan. Guru tidak boleh membuat admin. |
| **Siswa/Siswi** | Akun dibuat admin atau guru melalui `POST /api/users`, dengan ID sama dengan NISN yang telah terdaftar. | Profil, penempatan sendiri, presensi sendiri, dan laporan sendiri. |

Aturan akun:

- Tidak ada password demo yang disimpan di source code atau diterima sebagai bypass.
- Password awal minimal 12 karakter dan wajib diganti pada login pertama.
- Password disimpan sebagai hash `scrypt`; password asli tidak pernah disimpan atau dicatat di audit.
- Sesi disimpan server-side di SQLite dan dikirim melalui cookie `HttpOnly`, `SameSite=Lax`.
- Logout menghapus sesi server-side; `sessionStorage` hanya menyimpan state tampilan.
- Role UI tidak dapat menaikkan hak akses; setiap endpoint memeriksa session dan role di server.
- Akun siswa hanya boleh dibuat jika NISN sudah ada di master siswa; validasi ini perlu ditegakkan pada task administrasi akun.
- Pembuatan akun, perubahan role/password, reset password, dan penghapusan akun wajib dicatat di audit.

## 2. Requirements V1: Foto + Lokasi

### REQ-V1-001 — Login dan penggunaan akun

- Login menyediakan pilihan role Guru, Siswa, dan Admin, ID/NIS, password, toggle password, dan pesan kesalahan.
- Login siswa memvalidasi keberadaan NISN melalui `GET /api/students/:nisn`.
- Sesi dipulihkan setelah reload melalui `GET /api/session`; cookie session server-side adalah sumber kebenaran.
- Logout menghapus sesi server-side.
- Login membatasi percobaan berulang dan menampilkan pesan umum agar keberadaan akun tidak mudah ditebak.
- Pengguna dengan `mustChangePassword` wajib diarahkan ke alur ganti password sebelum memakai fitur lain.
- `POST /api/users` membuat akun dengan password sementara; `POST /api/password` mengganti password akun yang sedang login.

### REQ-V1-002 — Navigasi dan dashboard

- Aplikasi menyediakan view dashboard, rekap, siswa, laporan, notifikasi guru, profil guru, dan pengaturan.
- Navigasi memperbarui menu aktif, breadcrumb, dan posisi scroll.
- Dashboard menampilkan tanggal, sapaan pengguna, statistik tingkat kehadiran bulan berjalan, jumlah hadir, jumlah sakit, serta tiga catatan terbaru.
- Siswa dapat membuka alur presensi dari dashboard.
- Tombol detail lokasi membaca lokasi siswa dari data tersimpan, bukan nilai hardcoded.
- Jika lokasi siswa belum tersedia, tombol detail lokasi membuka pesan yang menjelaskan bahwa data lokasi belum dimasukkan dan mengarahkan pengguna ke alur pengaturan lokasi.
- Avatar/menu identitas di kanan atas dapat dibuka dan menyediakan akses ke profil atau pengaturan akun yang sesuai role.
- Tombol menu titik tiga pada kartu identitas/sidebar memiliki fungsi yang terlihat oleh pengguna; kontrol dekoratif tidak boleh tetap tidak beraksi.
- Kartu “Butuh bantuan?” dapat dibuka dan menampilkan kanal bantuan atau kontak admin sekolah yang dikonfigurasi.

### REQ-V1-003 — Rekap presensi

- Rekap menampilkan tanggal, waktu masuk, waktu pulang, status, lokasi, dan bukti.
- Rekap dapat difilter berdasarkan status dan periode: semua periode, bulan ini, dan tiga bulan terakhir.
- Status yang tersedia adalah Hadir, Tidak hadir, dan Sakit.
- Lokasi menampilkan tautan Google Maps dengan koordinat dan akurasi, atau keterangan lokasi tidak tersedia.
- Bukti menampilkan identitas pengguna, role, waktu diambil/disimpan, resolusi, tipe, ukuran, nama file, dan user agent.
- Data diambil dari `GET /api/attendance-records` dengan urutan waktu terbaru.
- Kondisi tanpa data menampilkan pesan bahwa belum ada catatan presensi.
- Tombol unduh laporan presensi menghasilkan file yang memuat hasil rekap sesuai filter status dan periode yang sedang dipilih.

### REQ-V1-004 — Data siswa dan lokasi PKL

- Guru dapat melihat daftar siswa dan jumlah siswa.
- Guru dapat mengimpor CSV melalui `POST /api/students/import`.
- CSV wajib memiliki kolom Nama Siswa/Nama dan NISN; nomor HP orang tua bersifat opsional.
- NISN harus unik dan terdiri dari 10 digit.
- Impor memperbarui data yang memiliki NISN sama.
- Guru dapat membuat lokasi PKL melalui `POST /api/pkl-locations`.
- Nama perusahaan maksimal 120 karakter dan alamat maksimal 500 karakter.
- Kombinasi nama perusahaan dan alamat harus unik.
- Guru dapat menetapkan lokasi ke setiap siswa.
- Pada login pertama tanpa lokasi, siswa dapat memilih lokasi, membuat lokasi baru, melewati pilihan, atau keluar.
- Pilihan melewati lokasi disimpan per NISN pada `sessionStorage`.
- Impor bersifat all-or-nothing: satu error membatalkan seluruh transaksi.
- NISN harus tepat 10 digit; nama wajib 2-120 karakter; nomor HP opsional dan divalidasi sebagai nomor Indonesia 8-20 karakter.
- Siswa hanya memilih lokasi yang sudah disetujui. Permintaan lokasi baru dari siswa masuk sebagai usulan, bukan langsung menjadi lokasi aktif.
- Siswa dapat mengusulkan lokasi tambahan, termasuk lokasi PPD, dari dialog pengaturan lokasi; usulan tersebut disimpan dan muncul pada daftar pilihan setelah disetujui guru/admin.
- Setelah lokasi PPD disetujui, lokasi tersebut harus tersedia kembali ketika siswa membuka tombol edit/atur lokasi, termasuk setelah refresh.

### REQ-V1-005 — Presensi foto

- Alur presensi mencoba memperoleh geolokasi dengan akurasi tinggi, timeout 10 detik.
- Kegagalan atau penolakan izin lokasi tidak menghalangi penyimpanan; lokasi dapat bernilai kosong.
- Kamera menggunakan kamera depan.
- Sistem mengambil frame kamera sebagai JPEG kualitas 0.88 dan menyimpan waktu pengambilan.
- Setelah foto diambil, stream kamera dihentikan dan pengguna dapat menyimpan presensi.
- Penyimpanan mengirim foto, lokasi opsional, waktu pengambilan, user ID, role, user agent, dan dimensi gambar ke `POST /api/attendance-photo`.
- Server hanya menerima data URL JPEG/JPG/PNG yang valid.
- File disimpan ke folder `images`; database menyimpan metadata dan status default Hadir.
- Jika penyimpanan database gagal, file yang sudah dibuat harus dihapus.
- Sukses menyegarkan rekap dan menampilkan notifikasi.
- Foto pertama pada hari kerja menjadi presensi masuk dan foto kedua menjadi presensi pulang; foto ketiga ditolak dengan HTTP 409.
- Jam masuk global adalah 08:00 Asia/Jakarta pada Senin-Jumat; presensi setelah 08:00 berstatus `Terlambat`.
- Lokasi tetap opsional jika izin ditolak. Jika koordinat tersedia dan lokasi PKL memiliki koordinat, radius 200 meter dipakai untuk menandai presensi di luar area.
- Validasi foto bersifat teknis: JPEG/PNG, maksimal 5 MB, dan minimal 320x240; verifikasi wajah belum digunakan.

### REQ-V1-006 — Laporan, notifikasi, profil, dan pengaturan

- Pengguna dapat mengunggah PDF, DOC, atau DOCX maksimal 10 MB melalui `POST /api/report-upload`.
- Validasi upload memeriksa MIME type, ekstensi, dan ukuran.
- File laporan disimpan di folder `reports` dengan nama aman dan dicatat pada log.
- Server memvalidasi signature PDF/DOC/DOCX, ukuran decoded maksimal 10 MB, dan menyimpan file secara atomik.
- Riwayat laporan tersedia melalui `GET /api/reports`.
- Guru dapat melihat notifikasi presensi/laporan, jumlah belum dibaca, menyegarkan daftar, dan menandai notifikasi sudah dibaca; status baca disimpan per akun.
- Preferensi notifikasi disimpan per akun di browser.
- Guru dapat mengubah nama tampilan dan kontak secara persisten di server; ID pengguna bersifat readonly.
- Profil menampilkan jumlah siswa dan jumlah penempatan.
- Tema garden, ocean, dan terracotta disimpan di `localStorage`.
- Toggle pengaturan umum mengubah state visual.
- Pengguna yang memiliki `mustChangePassword` diarahkan ke dialog atau halaman ubah password sebelum dapat menggunakan fitur aplikasi.
- Pengguna dapat membuka fitur ubah password dari Pengaturan setelah login; password baru minimal 12 karakter, dikirim melalui `POST /api/password`, dan status wajib ganti password diperbarui setelah berhasil.
- Profil dari avatar/menu kanan atas membuka profil pengguna yang sedang login; perubahan profil tidak boleh hanya tersimpan di browser.
- Tombol notifikasi kanan atas membuka pusat notifikasi yang sama dengan menu Notifikasi dan menampilkan indikator jumlah belum dibaca sesuai role.
- Kontrol “Buka kamera” dan “Ambil foto” memiliki label, keadaan disabled/aktif, dan bantuan visual yang cukup jelas; preview dan hasil foto tidak boleh mirror.
- Aplikasi menyediakan tutorial singkat yang dapat dibuka pengguna untuk menjelaskan login, pemilihan lokasi, presensi, upload laporan, dan navigasi utama.
- Aplikasi menyediakan alur “Butuh bantuan?” yang dapat dibuka dan menampilkan informasi kontak atau instruksi bantuan.
- Daftar laporan siswa dan metadata foto/presensi dimuat kembali dari persistence server setelah refresh; upload yang berhasil tidak boleh hanya bergantung pada state browser.
- Data upload yang gagal disimpan tidak boleh ditampilkan sebagai upload berhasil.

### REQ-V1-008 — Penyelesaian interaksi UX yang tercatat di kertas

- Semua tombol atau ikon yang tampak interaktif harus memiliki aksi, status, atau alasan yang jelas jika dinonaktifkan.
- Menu identitas kiri atas dan avatar kanan atas harus dapat dibuka melalui mouse, keyboard, dan perangkat mobile.
- Dialog lokasi menampilkan pesan khusus saat data lokasi belum tersedia dan menyediakan jalur langsung untuk mengatur atau mengusulkan lokasi.
- Notifikasi, profil, tutorial, bantuan, ubah password, dan unduh rekap harus memiliki kondisi kosong, kondisi berhasil, dan pesan kegagalan yang terlihat.
- Fitur baru tidak boleh menghapus atau mengubah data presensi, foto, laporan, lokasi, dan profil yang sudah tersimpan ketika halaman dimuat ulang.

### REQ-V1-007 — API dan persistensi

- API siswa menyediakan daftar, detail berdasarkan NISN, impor CSV, dan penempatan lokasi.
- API lokasi menyediakan daftar dan pembuatan lokasi.
- API presensi menyediakan daftar catatan dan penyimpanan foto.
- API laporan menyediakan upload dan daftar laporan.
- SQLite menyimpan siswa, lokasi PKL, dan catatan presensi.
- `DATABASE_PATH` dapat mengubah lokasi database; port default adalah 3000.

## 3. Requirements V2: Barcode

### REQ-V2-001 — Login dan routing role

- Halaman login menyediakan pilihan siswa, guru, dan admin.
- Submit login mengarahkan pengguna ke halaman sesuai role.
- Password diverifikasi server-side menggunakan hash `scrypt`; `demo1234` tidak memiliki hak khusus.
- Akun awal V2 dikonfigurasi melalui environment variable dan sesi memakai cookie `HttpOnly`.
- ID awal yang direkomendasikan adalah NIS `202312047`, NIP `198507122010012003`, dan `admin.sekolah`, tetapi akun hanya aktif jika password environment tersedia.
- Routing halaman mengikuti role server dan endpoint V2 memeriksa role yang sama.

### REQ-V2-002 — Presensi siswa dengan barcode

- Siswa melihat rekap presensi dari persistence server dengan filter status.
- Identitas siswa, nama, dan kelas berasal dari master siswa SQLite; barcode aktif menggunakan NIS dan versi barcode tersimpan di master.
- Modal presensi menyediakan kamera, canvas foto, waktu, lokasi, koordinat, input kode manual, status scan, dan kontrol kamera/lokasi/simpan.
- Sistem menggunakan `BarcodeDetector` native setiap 300 ms dan fallback ZXing dengan kamera belakang.
- Kode barcode dicocokkan dengan NIS.
- Lokasi wajib tersedia untuk scan masuk; scan pulang boleh disimpan tanpa lokasi. Timeout permintaan lokasi adalah 15 detik.
- Tombol simpan aktif jika kode, lokasi, dan waktu pengambilan tersedia.
- Scan pertama pada hari kerja dicatat sebagai masuk; scan kedua hanya boleh mulai pukul 15:00 sebagai pulang; scan ketiga ditolak.
- Jadwal memakai timezone Asia/Jakarta. Masuk sebelum atau tepat 08:00 berstatus Hadir, setelah 08:00 berstatus Terlambat. Hari Sabtu/Minggu ditolak.
- Hari kerja lampau tanpa scan masuk dapat ditampilkan sebagai Alpha pada rekap; koreksi Admin tetap menyimpan log terpisah.
- Data dikirim ke `POST /api/attendance-scan`.

### REQ-V2-003 — Laporan siswa, guru, dan admin

- Siswa dapat mengunggah laporan PKL PDF/DOC/DOCX maksimal 10 MB melalui `POST /api/laporan-pkl`.
- Riwayat laporan dapat difilter berdasarkan NIS dan menyediakan tautan file.
- Guru melihat roster lima siswa, status laporan sudah/belum, ringkasan, dan presensi roster.
- Admin melihat seluruh presensi dengan koreksi terbaru diterapkan.
- Admin dapat mengoreksi status melalui `POST /api/attendance-correction`.
- Data presensi asli tidak diubah; koreksi ditambahkan sebagai log.
- Status koreksi adalah Hadir, Terlambat, Alpha, atau Pulang.
- Koreksi menyimpan nilai sebelumnya, nilai baru, admin, waktu, dan alasan opsional.

### REQ-V2-004 — API dan keamanan file

- API attendance scan membatasi body hingga 100 KB.
- API attendance log menyediakan filter data presensi.
- API koreksi menambahkan ID, status, admin pengoreksi, dan waktu koreksi ke log.
- API laporan menggunakan batas buffer 10 MB.
- Penyajian file memblokir traversal `dotdot` dan dotfiles.
- Root aplikasi mengarah ke `login.html`; port tetap 3000.

## 4. Kebutuhan Non-Fungsional

- Aplikasi menggunakan vanilla HTML, CSS, dan JavaScript tanpa build step.
- CDN hanya digunakan untuk Google Fonts dan ZXing V2.
- Tema menggunakan CSS variables dan atribut `data-theme`.
- Layout responsif; sidebar berubah menjadi bottom navigation dengan grid dua kolom pada mobile.
- Toast otomatis menghilang sekitar 3–4,2 detik.
- Data dinamis harus di-escape sebelum dirender ke HTML.
- Kamera dan geolokasi membutuhkan `localhost` atau HTTPS serta izin browser.

## 5. Batasan dan Keputusan yang Masih Terbuka

- UI administrasi akun, reset password oleh admin, penguncian akun, dan riwayat sesi belum lengkap.
- Beberapa data masih hardcoded: perusahaan, jumlah 23, tingkat 100 persen, dan roster V2.
- Belum ada verifikasi wajah; validasi foto hanya memeriksa format.
- Barcode hanya disamakan dengan NIS.
- Aturan keterlambatan dan validasi presensi belum ditentukan.
- Relasi guru-siswa belum dimodelkan; perlu diputuskan apakah guru melihat semua siswa atau hanya siswa bimbingannya.
- Prosedur pemulihan akun siswa ketika lupa password belum ditentukan.
- Integrasi laporan/notifikasi lanjutan masih belum ditentukan.
- Hak akses dasar, retensi, dan audit privasi sudah dikonfirmasi pemilik proyek; detail operasionalnya tetap harus diuji pada task testing.
