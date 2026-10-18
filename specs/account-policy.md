# Kebijakan Penggunaan Akun

Dokumen ini menjadi panduan penggunaan akun untuk demo Sistem Presensi PKL. Jangan menaruh password nyata di repository atau di dalam file dokumentasi.

## Role dan kewenangan

| Role | Identitas login | Kewenangan |
|---|---|---|
| Admin sekolah | `ADMIN_ID` atau `admin.sekolah` | Mengelola seluruh data, akun, audit, retensi, dan koreksi presensi. |
| Guru pembimbing | `GURU_ID` | Mengimpor siswa, mengelola lokasi, melihat presensi dan laporan sesuai penugasan. |
| Siswa/Siswi | NISN terdaftar | Melihat data sendiri, memilih lokasi PKL, melakukan presensi, dan mengunggah laporan sendiri. |

## Membuat akun awal V1

Gunakan PowerShell dari folder repository. Password contoh di bawah hanya placeholder; ganti dengan password sementara yang aman.

```powershell
$env:ADMIN_ID = "admin.sekolah"
$env:ADMIN_PASSWORD = "<password-admin-minimal-12-karakter>"
$env:GURU_ID = "guru.pembimbing"
$env:GURU_PASSWORD = "<password-guru-minimal-12-karakter>"
node server.js
```

Server hanya membuat akun yang belum ada. Setelah akun pertama dibuat, mengganti environment variable tidak otomatis mengganti password akun yang sudah tersimpan.

## Reset password lokal

Jika password akun lupa, gunakan utilitas lokal berikut dari folder repository. Utilitas ini tidak menampilkan password saat diketik, tidak menghapus data siswa/presensi/laporan, dan mengeluarkan semua sesi akun yang direset:

```powershell
node reset-password.js admin.sekolah
```

Ganti `admin.sekolah` dengan ID akun yang akan dipulihkan. Password baru harus minimal 12 karakter dan akan diminta dua kali secara tersembunyi. Setelah berhasil, login menggunakan ID tersebut dan password baru. Jika database memakai lokasi lain, set `DATABASE_PATH` terlebih dahulu:

```powershell
$env:DATABASE_PATH = "data/presensi.sqlite"
node reset-password.js admin.sekolah
```

Jalankan perintah ini hanya secara lokal dan jangan memasukkan password ke command line, file dokumentasi, atau repository. Utilitas mencatat tindakan reset ke audit tanpa menyimpan password asli. Jika server sedang berjalan, sesi akun yang direset akan dikeluarkan dan pengguna harus login kembali.

## Alur penggunaan

1. Admin login menggunakan akun admin.
2. Guru mengimpor CSV siswa dan menambahkan lokasi PKL.
3. Admin atau guru membuat akun siswa melalui administrasi akun menggunakan ID yang sama dengan NISN.
4. Pengguna login memakai password sementara.
5. Pengguna wajib mengganti password melalui alur ganti password.
6. Siswa hanya dapat mengakses presensi, laporan, dan file miliknya.
7. Guru mengelola data sesuai penugasan; pembatasan per guru membutuhkan relasi guru-siswa yang belum tersedia.
8. Admin melakukan koreksi presensi dan meninjau audit.

## Endpoint akun

| Method | Endpoint | Pengguna | Tujuan |
|---|---|---|---|
| POST | `/api/login` | Semua | Verifikasi ID dan password, lalu membuat session. |
| GET | `/api/session` | Semua yang login | Mengambil role dan status `mustChangePassword`. |
| POST | `/api/password` | Pengguna yang login | Mengganti password sementara. Minimal 12 karakter. |
| POST | `/api/users` | Admin; guru untuk siswa | Membuat akun dengan password sementara. |
| POST | `/api/logout` | Pengguna yang login | Menghapus session server-side. |

## Aturan keamanan

- Password tidak boleh dicatat di audit, log, query string, atau `sessionStorage`.
- Cookie session harus `HttpOnly`, `SameSite=Lax`, dan hanya dikirim ke path aplikasi.
- Role dari UI atau payload request tidak dipercaya; role dibaca dari session server-side.
- Password akun siswa harus dipulihkan melalui proses reset yang ditetapkan admin, bukan dikirim ulang sebagai password lama.
- UI administrasi akun, penonaktifan akun, dan audit viewer masih menjadi pekerjaan lanjutan. Reset password lokal tersedia melalui `reset-password.js`; reset password melalui UI admin masih belum tersedia.

## Konfigurasi V2

V2 memiliki database akun terpisah (`auth.sqlite`). Gunakan environment variable berikut jika membutuhkan akun awal:

```powershell
$env:ADMIN_PASSWORD = "<password-admin-minimal-12-karakter>"
$env:GURU_PASSWORD = "<password-guru-minimal-12-karakter>"
$env:SISWA_PASSWORD = "<password-siswa-minimal-12-karakter>"
node legacy\barcode-version\server.js
```

ID dapat diubah melalui `V2_ADMIN_ID`, `V2_GURU_ID`, dan `V2_SISWA_ID`. Default ID V2 adalah `admin.sekolah`, `198507122010012003`, dan `202312047`.

## Kebutuhan yang belum selesai

- Relasi guru dengan siswa, kelas, atau perusahaan.
- Reset password oleh admin dan mekanisme pemulihan akun.
- Status aktif/nonaktif akun dan pencabutan semua session.
- Halaman UI administrasi akun dan halaman audit.
- Sinkronisasi akun siswa dengan master siswa saat impor CSV.
