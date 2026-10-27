# Tutorial V1 Sistem Presensi PKL

Panduan ini khusus untuk aplikasi utama **V1**, yang menggunakan foto dan lokasi saat siswa melakukan presensi. V2/barcode tidak dibahas.

## 1. Persiapan dan menjalankan aplikasi

1. Pastikan Node.js versi **22.13 atau lebih baru** sudah terpasang.
2. Buka PowerShell, lalu pindah ke folder proyek:

   ```powershell
   Set-Location "C:\PKM\demo-pkl-docs-update-task-list\demo-pkl-docs-update-task-list"
   ```

3. Pada penyiapan awal, masukkan ID dan password awal admin serta guru pembimbing. Ganti nilai contoh dengan kredensial milik sekolah; password harus sekurangnya 12 karakter:

   ```powershell
      $env:ADMIN_ID = "admin.sekolah"
      $env:ADMIN_PASSWORD = "<password-awal-admin-minimal-12-karakter>"
      $env:GURU_ID = "guru.pembimbing"
      $env:GURU_PASSWORD = "<password-awal-guru-minimal-12-karakter>"
      node server.js
   ```

   Server membuat akun awal yang belum ada, menyiapkan akun siswa dari master, lalu berjalan di port 3000. Biarkan jendela PowerShell ini tetap terbuka.

   Jika akun admin dan guru sudah tersedia di database, mulai server dengan `node server.js`. Mengisi environment variable kembali **tidak** mengganti password akun yang sudah ada.

4. Buka `http://localhost:3000` di browser dan pilih role pada halaman login.

Data aplikasi disimpan pada `data\presensi.sqlite`; foto presensi pada `images`; laporan siswa pada `reports`. Jangan menghapus atau mengganti database saat aplikasi berisi data yang ingin dipertahankan.
Tombol **Keluar** hanya mengakhiri sesi login; proses `node server.js` tetap berjalan. Biarkan jendela terminal server terbuka. Untuk menghentikan server dengan sengaja, tekan `Ctrl+C` di jendela tersebut.


### Persyaratan kamera dan lokasi

Presensi foto memerlukan izin kamera browser. Lokasi bersifat opsional; jika izin lokasi ditolak, foto masih dapat dikirim tanpa koordinat. Gunakan `localhost` saat mencoba di komputer ini atau situs HTTPS saat dipasang di server.

## 2. Tutorial admin

Login dengan ID dan password admin yang dikonfigurasi. Akun awal atau akun yang direset wajib mengganti password sebelum memakai fitur aplikasi.

1. Buka **Manajemen akun**.
2. **Akun murid tidak dibuat satu per satu.** Sistem menyediakan akun dari data master siswa. Admin dapat membuat akun staf (guru atau admin) dengan password sementara minimal 12 karakter.
3. Buka **Penugasan pembimbing** untuk memilih siswa dan guru yang membimbingnya, lalu simpan. Periksa penugasan terutama jika database memiliki beberapa guru.
4. Di tabel **Pengguna**, admin dapat memuat ulang daftar, mereset password, atau menonaktifkan/mengaktifkan akun. Setelah reset, sampaikan password sementara kepada pengguna lewat kanal yang aman; pengguna harus menggantinya saat login berikutnya.
5. Buka **Audit & sesi** untuk memeriksa sesi aktif dan riwayat tindakan.
6. Admin tidak melakukan presensi dan tidak memvalidasi atau mengunggah laporan. Validasi laporan dilakukan guru pembimbing.

### Master guru dan akun pembimbing

Master guru tersimpan di `data\database_guru.csv` dan ditampilkan pada tabel **Data guru** di Manajemen akun. Untuk memperbarui master dari CSV, jalankan dari folder proyek:

```powershell
node import-teachers.js data/database_guru.csv
```

Untuk membuat akun guru dari NIP yang sudah ada di CSV, ganti placeholder berikut dengan satu atau beberapa NIP 10 digit. Password sementara akun baru sama dengan NIP dan harus diganti saat login pertama:

```powershell
node import-teachers.js data/database_guru.csv "<NIP-guru-10-digit>"
```

Jangan mengisi argumen penugasan jika hanya ingin memperbarui master atau membuat akun. Argumen ketiga secara sengaja memindahkan semua penugasan siswa yang ada ke guru dengan NIP tersebut; gunakan hanya bila memang ingin mengganti seluruh penugasan. Argumen keempat opsional membuat admin tambahan dengan password acak yang hanya ditampilkan sekali di terminal. Simpan password tersebut di kanal aman, bukan di file proyek.

### Akun murid dan password awal

- ID login murid adalah NISN 10 digit yang ada di master siswa.
- Akun siswa yang belum ada dibuat otomatis saat server mulai; siswa baru juga mendapat akun ketika CSV master diimpor.
- Password sementara awal adalah NISN. Murid harus segera menggantinya dengan password baru minimal 12 karakter saat login pertama.
- Migrasi awal mengatur password NISN hanya untuk akun siswa yang masih wajib mengganti password. Password yang sudah menjadi password permanen tidak ditimpa.
- Jangan membagikan password melalui kanal publik. Minta murid menggantinya segera.

## 3. Tutorial guru pembimbing

Login dengan akun guru. Guru hanya dapat memantau siswa yang ditugaskan kepadanya dan tidak memiliki menu untuk melakukan presensi.

### Mengimpor master siswa

1. Buka **Data siswa**, lalu pilih **Impor CSV**.
2. File CSV wajib memiliki kolom `Nama Siswa` (atau `Nama`) dan `NISN`. Kolom `No. HP Orang Tua` opsional.
3. Setiap NISN harus tepat 10 angka; nama harus 2–120 karakter. File impor maksimal 2 MB.
4. Setelah impor berhasil, aplikasi menampilkan jumlah siswa dan akun yang dibuat otomatis. Siswa baru yang diimpor guru otomatis ditugaskan kepada guru tersebut; penugasan siswa lama tidak dipindah oleh impor.

### Menambahkan lokasi PKL dan memantau siswa

1. Pada **Data siswa**, isi nama PT/tempat PKL dan alamat pada bagian **Daftar tempat PKL**, lalu pilih **Tambah lokasi**.
2. Tetapkan lokasi pada siswa melalui pilihan lokasi di tabel siswa. Latitude dan longitude dapat ditambahkan secara opsional ketika membuat lokasi.
3. Buka **Rekap presensi** untuk memantau catatan siswa bimbingan dan melihat foto bukti presensi.
4. Buka **Laporan PKL** untuk membuka laporan yang dikirim siswa. Pilih **Disetujui** atau **Perlu revisi**, tulis catatan bila diperlukan, lalu tekan **Simpan**. Status dan catatan akan terlihat oleh siswa.
5. Buka **Notifikasi** untuk melihat aktivitas yang relevan. Menu **Profil guru** dan **Pengaturan** digunakan untuk memperbarui profil serta preferensi yang tersedia.

## 4. Tutorial siswa

Login dengan NISN sebagai ID dan password sementara NISN. Saat login pertama, ganti password menjadi password pribadi minimal 12 karakter. Selama password sementara belum diganti, fitur lainnya dikunci.

### Memilih atau mengatur lokasi PKL

1. Jika diminta memilih lokasi saat masuk, pilih tempat PKL yang tersedia lalu simpan.
2. Jika lokasi belum tersedia, guru dapat menambahkannya. Siswa juga dapat memilih **Usulkan tempat lain** dan mengisi nama serta alamat untuk ditinjau guru.
3. Lokasi yang sudah tersimpan dapat dilihat atau diubah pada **Data siswa** melalui **Atur tempat PKL**.

### Melakukan presensi foto

1. Pastikan browser memiliki izin kamera. Izin lokasi membantu mencatat koordinat dan nama tempat, tetapi tidak wajib.
2. Pada **Dashboard**, pilih **Presensi sekarang**.
3. Tekan **Buka kamera** dan izinkan akses kamera.
4. Tunggu kamera aktif, lalu tekan **Ambil foto**. Periksa tag lokasi/waktu pada foto jika tersedia.
5. Tekan **Simpan presensi** dan tunggu konfirmasi berhasil. Jangan menutup halaman sebelum hasilnya muncul.
6. Buka **Rekap presensi** untuk melihat catatan dan foto yang tersimpan.

### Mengirim laporan PKL

1. Buka **Laporan PKL**.
2. Pilih file PDF, DOC, atau DOCX berukuran maksimal 10 MB. Gunakan nama file yang jelas.
3. Tekan **Upload laporan** dan tunggu konfirmasi.
4. Periksa status pada bagian laporan terakhir. Guru pembimbing dapat menyetujui laporan atau meminta revisi dengan catatan.

Menu **Pengaturan** menyediakan ubah password dan pilihan tema Taman, Laut, Terracotta, serta mode Gelap. Pilihan tema tersimpan pada browser. Gunakan menu **Bantuan** bila memerlukan bantuan sekolah; jangan mengirimkan password kepada siapa pun.

## 5. Lupa password atau kendala

- Jika password terlupa, hubungi admin sekolah untuk reset akun.
- Pembatas login memberi 7 percobaan gagal awal. Setelah itu login dikunci selama 3 menit. Jika percobaan gagal berlanjut setelah masa tunggu, 2 kegagalan berikutnya memicu penguncian 5 menit.
- Admin yang perlu memulihkan password menggunakan utilitas lokal dari folder proyek:

  ```powershell
  node reset-password.js <ID-akun>
  ```

  Skrip meminta password baru secara tersembunyi. Jangan menaruh password di command line, source code, atau file panduan.
- Jika kamera tidak menyala, periksa izin kamera browser dan gunakan `localhost` atau HTTPS.
- Jika menu atau data tidak muncul sesuai role, keluar lalu login kembali dengan akun yang benar; akses data juga dibatasi di server.

## 6. Menjalankan tes

Dari folder proyek:

```powershell
npm test
npm run test:browser
```
