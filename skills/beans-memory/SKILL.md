---
name: Beans Memory
description: Cari catatan proyek yang tersimpan dan simpan keputusan atau bugfix baru ke memory lokal. Gunakan sebelum mulai pekerjaan yang mungkin pernah dikerjakan, dan setelah tugas yang menghasilkan keputusan, bugfix, atau wiring yang sulit ditemukan lagi.
metadata:
  opencode/autoinvoke: true
---

# Beans Memory

Memory lokal berbasis SQLite. Tidak ada cloud, tidak ada akun.

CLI: `beans-memory`. Kalau perintah tidak tersedia, pakai `bunx beans-memory` (paket npm) atau `bun src/cli.ts` dari repo.

## Sebelum mulai

Cari dulu apakah topik ini pernah dikerjakan:

```bash
beans-memory search "kata kunci topik" --limit 5
```

Kalau ada hasil relevan, buka isinya:

```bash
beans-memory get <id> [<id>...]
```

Gunakan `--json` kalau perlu memproses hasil secara terstruktur.

## Setelah tugas

Simpan satu catatan ringkas untuk keputusan, bugfix, aturan bisnis, atau wiring yang tidak jelas dari kode:

```bash
beans-memory note \
  --title "Judul satu baris" \
  --type decision \
  --files "app/Contoh.php,app/Lain.php" \
  --stdin <<'EOF'
Apa yang berubah, kenapa, dan bagian mana yang perlu diingat.
EOF
```

Tipe yang tersedia: `decision`, `bugfix`, `feature`, `refactor`, `security_note`, `note`.

## Aturan

- Satu catatan satu fakta. Jangan menulis ringkasan panjang.
- Sertakan alasan keputusan, bukan hanya perubahan.
- Jangan simpan token, password, isi `.env`, atau data pribadi.
- Project ditentukan dari nama folder kerja. Gunakan `--project <nama>` kalau perlu memisahkan.
- Cek `beans-memory stats` untuk melihat jumlah catatan project ini.
