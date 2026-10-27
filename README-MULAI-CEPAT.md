# Mulai Cepat — Presensi PKL (hasil gabungan)

Kebutuhan: **Node.js 22.13 atau lebih baru** (memakai `node:sqlite`). Tidak ada dependency untuk menjalankan aplikasi.

## Menjalankan

1. Buka PowerShell di folder ini.
2. Siapkan akun admin. Berkas `.env` berisi dua perintah PowerShell (`$env:ADMIN_ID`, `$env:ADMIN_PASSWORD`). Tempel isinya ke jendela PowerShell yang sama, atau ketik sendiri (password minimal 12 karakter):
   ```powershell
   $env:ADMIN_ID = "admin.sekolah"
   $env:ADMIN_PASSWORD = "<password-minimal-12-karakter>"
   ```
3. Jalankan server, lalu buka `http://localhost:3000`:
   ```powershell
   node server.js
   ```
4. Login sebagai admin dan ganti password sementara. Database **masih kosong** dan dibuat otomatis pada start pertama; isi lewat akun admin:
   **Kelas & guru** (tambah kelas) → **Kelola akun** (buat akun guru, tugaskan guru ke kelas atau tugaskan siswa langsung) → **Data siswa** (impor CSV; contoh format: `data/siswa_pkl_dummy.csv`). Akun siswa dibuat otomatis saat impor (password sementara = NISN, wajib diganti saat login pertama).

## Tes (opsional)

```powershell
npm install
npm test                # tes Node, tanpa browser
npx playwright install chromium
npm run test:browser    # tes browser (butuh Chromium)
```

Dokumentasi lengkap: `README.md`, panduan peran: `TUTORIAL-V1.md`.
