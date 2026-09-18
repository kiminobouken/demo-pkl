# Software Design Document (SDD)

## Status Dokumen

Dokumen ini adalah catatan awal kebutuhan untuk sistem presensi event PKL. Belum ada alur sistem atau keputusan desain penting yang ditetapkan.

## Golden Rule Proyek

Setiap detail yang belum ditetapkan harus ditanyakan kembali kepada pemilik proyek dan ditulis ulang di chat untuk dikonfirmasi. Asisten tidak boleh membuat asumsi mengenai alur sistem maupun keputusan penting.

## 1. Identitas Proyek

- Nama sistem: Sistem Presensi - Event PKL untuk Siswa SMK Sasmita Jaya
- Jenis kegiatan: PKL
- Status: Pencatatan awal

## 2. Detail yang Sudah Ditetapkan

| Area             | Catatan                                                           |
| ---------------- | ----------------------------------------------------------------- |
| Pengguna         | Siswa, guru pembimbing, admin sekolah                             |
| Lokasi presensi  | Sekolah dan perusahaan                                            |
| Metode presensi  | QR Code                                                           |
| Validasi         | Presensi memerlukan validasi; mekanisme validasi belum ditentukan |
| Status presensi  | Hadir, terlambat, alpha, pulang                                   |
| Pencatatan waktu | Jam masuk dan jam pulang diperlukan                               |
| Wewenang koreksi | Admin sekolah                                                     |
| Penempatan siswa | Setiap siswa berada di satu perusahaan                            |

## 3. Hal yang Belum Diputuskan

Bagian berikut sengaja belum diisi dan tidak boleh diasumsikan:

- Aturan hubungan siswa dengan perusahaan PKL.
- Detail data siswa.
- Detail data perusahaan.
- Format dan jenis laporan.
- Notifikasi.
- Integrasi dengan sistem lain.
- Platform aplikasi.
- Pengelolaan akun dan hak akses rinci.
- Keamanan, privasi, dan audit log.
- Periode penggunaan sistem.
- Teknologi atau bahasa pemrograman.
- Format SDD yang diwajibkan.
- Bagian lanjutan SDD yang perlu dibuat.
- Alur sistem.
- Keputusan desain penting lainnya.

## 4. Catatan Konfirmasi

Jawaban terakhir pemilik proyek menyatakan: "catat saja terlebih dahulu, saat ini belum ada keputusan yang lebih lanjut". Karena itu, dokumen ini hanya berisi catatan yang telah disebutkan dan daftar hal yang masih menunggu keputusan.
