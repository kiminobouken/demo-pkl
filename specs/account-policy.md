# Kebijakan Penggunaan Akun

Dokumen ini menjadi panduan penggunaan akun untuk demo Sistem Presensi PKL. Jangan menaruh password nyata di repository atau di dalam file dokumentasi.

## Role dan kewenangan

| Role | Identitas login | Kewenangan |
|---|---|---|
| Admin sekolah | `ADMIN_ID` atau `admin.sekolah` | Mengelola seluruh data, akun, penugasan siswa, audit, retensi, dan konfigurasi. Tidak memiliki alur UI untuk melakukan presensi. |
| Guru pembimbing | `GURU_ID` | Mengimpor siswa, mengelola lokasi, dan memantau presensi/laporan hanya untuk siswa yang ditugaskan kepadanya. Guru dapat memvalidasi laporan, tetapi tidak dapat melakukan presensi atau mengunggah laporan. |
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
2. Guru mengimpor CSV siswa dan menambahkan lokasi PKL. Siswa baru yang diimpor guru otomatis ditugaskan kepada guru tersebut.
3. Akun siswa dibuat otomatis dari master siswa saat server mulai atau CSV siswa diimpor. ID dan password sementara sama dengan NISN 10 digit. Saat migrasi awal, password hanya diinisialisasi ulang untuk akun siswa yang masih wajib mengganti password; akun yang sudah memiliki password permanen tidak diubah.
4. Siswa login menggunakan NISN sebagai ID dan password sementara.
5. Siswa wajib mengganti password melalui alur ganti password sebelum memakai fitur lain.
6. Admin mengatur atau memindahkan penugasan siswa ke guru melalui Manajemen akun.
7. Siswa hanya dapat mengakses presensi, laporan, dan file miliknya.
8. Guru hanya dapat mengakses siswa yang ditugaskan, melihat foto presensi, dan memvalidasi laporan.
9. Admin meninjau audit dan sesi; tidak ada opsi presensi pada UI admin maupun guru.

## Endpoint akun

| Method | Endpoint | Pengguna | Tujuan |
|---|---|---|---|
| POST | `/api/login` | Semua | Verifikasi ID dan password, lalu membuat session. |
| GET | `/api/session` | Semua yang login | Mengambil role dan status `mustChangePassword`. |
| POST | `/api/password` | Pengguna yang login | Mengganti password sementara. Minimal 12 karakter. |
| POST | `/api/users` | Admin | Membuat akun staf dengan password sementara; akun siswa disediakan otomatis dari master. |
| POST | `/api/logout` | Pengguna yang login | Menghapus session server-side. |

## Aturan keamanan

- Password sementara akun siswa memakai NISN sesuai keputusan pemilik proyek; NISN mudah ditebak, jadi akun tersebut dibatasi hingga password baru minimal 12 karakter ditetapkan. Bagikan NISN/password melalui kanal yang aman dan arahkan siswa menggantinya segera.
- Password tidak boleh dicatat di audit, log, query string, atau `sessionStorage`.
- Cookie session harus `HttpOnly`, `SameSite=Lax`, dan hanya dikirim ke path aplikasi.
- Role dari UI atau payload request tidak dipercaya; role dibaca dari session server-side.
- Password akun siswa harus dipulihkan melalui proses reset yang ditetapkan admin, bukan dikirim ulang sebagai password lama.
- Password sementara wajib diganti sebelum endpoint aplikasi lain dapat digunakan. UI shell tetap dapat dimuat agar dialog penggantian password dapat ditampilkan.
- Akun nonaktif ditolak saat login dan sesi yang masih berlaku dicabut.
- Akun siswa disediakan otomatis dari data master; endpoint pembuatan akun manual hanya menerima role guru atau admin.
- Hanya guru yang dapat mengubah status review laporan; admin hanya melihat laporan.
- `GET /api/health` tersedia tanpa login untuk pemeriksaan aplikasi dan SQLite.

## Konfigurasi V2

V2 memiliki database akun terpisah (`auth.sqlite`). Gunakan environment variable berikut jika membutuhkan akun awal:

```powershell
$env:ADMIN_PASSWORD = "<password-admin-minimal-12-karakter>"
$env:GURU_PASSWORD = "<password-guru-minimal-12-karakter>"
$env:SISWA_PASSWORD = "<password-siswa-minimal-12-karakter>"
node legacy\barcode-version\server.js
```

ID dapat diubah melalui `V2_ADMIN_ID`, `V2_GURU_ID`, dan `V2_SISWA_ID`. Default ID V2 adalah `admin.sekolah`, `198507122010012003`, dan `202312047`.

Akun yang baru dibuat dari environment wajib mengganti password sementara melalui halaman **Ganti kata sandi** sebelum memakai fitur lain. Password dapat diganti lagi dari tautan tersebut pada halaman siswa, guru, atau admin. Admin dapat mereset akun melalui formulir **Reset kata sandi** di halaman koreksi; tindakan tersebut mencabut sesi target dan mengharuskan password sementara diganti saat login berikutnya. Endpoint password memakai format respons `{ ok, message }` yang sama seperti V1. Akun V2 yang sudah ada sebelum migrasi tidak dipaksa mengganti password.

| Method | Endpoint | Pengguna | Tujuan |
|---|---|---|---|
| GET | `/api/session` | Semua yang login | Mengambil role dan status `mustChangePassword`. |
| POST | `/api/password` | Pengguna yang login | Mengganti password; minimal 12 karakter. |
| POST | `/api/users/{id}/password` | Admin | Mereset password akun, mencabut sesi target, dan mewajibkan ganti password. |
| POST | `/api/logout` | Pengguna yang login | Menghapus session server-side. |

## Relasi pembimbing

V1 menyimpan satu penugasan guru per NISN pada tabel `teacher_student_assignments`. Saat migrasi tabel tersebut pertama kali dibuat dan tepat satu akun guru aktif tersedia, siswa master yang sudah ada ditugaskan kepada guru tersebut. Setelah itu, admin dapat mengatur penugasan melalui Manajemen akun. Impor CSV oleh guru menugaskan siswa baru kepada guru pengimpor dan tidak memindahkan siswa yang sudah mempunyai penugasan.

## Backup dan restore

Lihat [README](../README.md#health-log-backup-dan-restore) untuk prosedur backup SQLite/JSONL ke folder baru dan pemulihan yang menolak menimpa folder tujuan. File media `images/` dan `reports/` tidak termasuk dalam backup tersebut.
