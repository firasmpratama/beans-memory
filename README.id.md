<p align="center">
  <img src="docs/wordmark.svg" alt="beans-memory" width="520">
</p>

<p align="center">
  Memory lokal dan permanen untuk coding agent. Satu file SQLite. Tanpa daemon, tanpa cloud, tanpa akun.
</p>

<p align="center">
  <a href="https://github.com/firasmpratama/beans-memory/tags"><img src="https://img.shields.io/github/v/tag/firasmpratama/beans-memory" alt="Tag terbaru"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/firasmpratama/beans-memory" alt="Lisensi: MIT"></a>
  <a href="https://github.com/firasmpratama/beans-memory/stargazers"><img src="https://img.shields.io/github/stars/firasmpratama/beans-memory" alt="GitHub stars"></a>
  <img src="https://img.shields.io/github/last-commit/firasmpratama/beans-memory" alt="Commit terakhir">
  <img src="https://img.shields.io/badge/Bun-%3E%3D1.2-000000?logo=bun&logoColor=white" alt="Bun 1.2+">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey" alt="Platform">
</p>

<p align="center">
  <a href="README.md">English</a> | Bahasa Indonesia
</p>

Agent bisa menyimpan catatan saat bekerja, mencarinya lagi nanti, dan menerima index kecil di awal setiap sesi.

## Cara kerja

```
OpenCode (runtime Bun)
├── plugin  src/plugin.ts   hook + tool memory_*, jalan di dalam proses
├── MCP     src/mcp.ts      tool yang sama lewat stdio, untuk klien lain
└── SQLite  ~/.local/share/beans-memory/memory.db
              observations + FTS5 + prompts + sessions
```

- **Plugin** mencatat prompt user, mencatat file yang disentuh tool edit/write, dan menyuntik 8 judul catatan terbaru sekali per sesi.
- **Tool** membuat agent bisa menulis dan mencari catatan permanen. Ringkasan ditulis oleh agent sendiri, jadi tidak ada panggilan model tambahan dan tidak ada worker latar.
- **MCP** membuka store yang sama untuk klien MCP mana pun (Claude Desktop, Cursor, skrip).
- **Pencarian** memakai SQLite FTS5: AND dulu, OR sebagai fallback, diurutkan dengan BM25.
- Semua gagal terbuka. Kalau database atau plugin rusak, OpenCode tetap jalan tanpa memory.

## Kebutuhan

- OpenCode 2
- Bun 1.2+ untuk CLI, server MCP, importer, dan test. Tidak perlu untuk plugin saja: plugin berjalan di Bun bawaan OpenCode.
  - `curl -fsSL https://bun.sh/install | bash`
- macOS atau Linux. Windows secara teori bisa, belum diuji.

## Mulai cepat

```bash
git clone https://github.com/firasmpratama/beans-memory ~/tools/beans-memory
cd ~/tools/beans-memory
./install.sh
```

Restart OpenCode, lalu minta agent memanggil `memory_stats`. Di instalasi baru hasilnya nol catatan.

Script memasang loader plugin, membuat launcher CLI `beans-memory` kalau Bun tersedia, dan menyalin skill. Script tidak mengubah `opencode.json` dan tidak menyalakan service.

Tidak punya git? Unduh arsip source dari halaman Releases, ekstrak di lokasi permanen, lalu jalankan `./install.sh` di folder itu.

### Instalasi manual

<details>
<summary>Kalau mau memasang sendiri, atau script gagal</summary>

1. Simpan kode di lokasi permanen:

```bash
git clone https://github.com/firasmpratama/beans-memory ~/tools/beans-memory
cd ~/tools/beans-memory
bun test   # opsional, butuh Bun; memakai database sementara
```

2. Buat loader OpenCode:

```bash
mkdir -p ~/.config/opencode/plugins/memory
```

`~/.config/opencode/plugins/memory/index.ts`:

```ts
import { pathToFileURL } from "node:url";

const ENTRY = "/path/absolut/ke/beans-memory/src/plugin.ts";

const noop = {
  id: "memory",
  async setup() {
    return () => {};
  },
};

let plugin: unknown = noop;

try {
  const loaded = await import(pathToFileURL(ENTRY).href);
  if (loaded?.default?.setup) plugin = loaded.default;
} catch (error) {
  console.error("[memory] plugin tidak dimuat:", error);
}

export default plugin;
```

Ganti `ENTRY` dengan path sebenarnya. Pertahankan fallback: kalau kode ada di disk eksternal yang tidak ter-mount, OpenCode tetap start dengan memory nonaktif, bukan gagal.

Nama folder dan nama file bebas. OpenCode memuat file `.ts` apa pun di `~/.config/opencode/plugins/`.

3. Restart OpenCode.

4. Verifikasi. Minta agent memanggil `memory_stats`. Di instalasi baru hasilnya nol catatan. Kalau tool tidak muncul, lihat Troubleshooting.

Cek loader tanpa OpenCode, kalau Bun terpasang:

```bash
bun -e 'import("/path/absolut/ke/beans-memory/src/plugin.ts").then((m) => console.log(typeof m.default.setup))'
```

Hasilnya harus `function`. Error path atau import di sini juga akan membuat plugin gagal di OpenCode.

</details>

## Pemakaian

Tool yang didaftarkan plugin:

| Tool | Fungsi |
|---|---|
| `memory_note` | Simpan catatan: judul, isi, tipe, file, konsep |
| `memory_search` | Pencarian full-text, hasil ringkas berisi id |
| `memory_get` | Isi lengkap berdasarkan id |
| `memory_stats` | Jumlah catatan dan tanggal catatan terakhir |

Alur yang disarankan untuk agent: panggil `memory_note` setelah tugas yang menghasilkan keputusan, bugfix, atau temuan wiring yang tidak jelas dari kode. Cari dulu dengan `memory_search`, lalu ambil hanya baris yang perlu dengan `memory_get`.

Dengan panduan di `AGENTS.md`, agent sebaiknya menulis catatan singkat: apa yang berubah, kenapa, dan file mana yang penting.

## Server MCP (opsional)

Untuk klien yang tidak bisa memuat plugin:

```jsonc
{
  "mcp": {
    "servers": {
      "beans_memory": {
        "type": "local",
        "command": ["/path/absolut/ke/bun", "/path/absolut/ke/beans-memory/src/mcp.ts"]
      }
    }
  }
}
```

- Server memakai JSON-RPC lewat stdio, satu pesan per baris.
- Tool: `memory_search`, `memory_get`, `memory_note`, `memory_stats`.
- Pemilihan database: `MEMORY_DB`, kalau kosong `~/.local/share/beans-memory/memory.db`.
- Nama project: `MEMORY_PROJECT`, kalau kosong basename dari working directory proses.

Contoh Claude Desktop:

```json
{
  "mcpServers": {
    "beans-memory": {
      "command": "/path/absolut/ke/bun",
      "args": ["/path/absolut/ke/beans-memory/src/mcp.ts"],
      "env": { "MEMORY_DB": "/Users/kamu/.local/share/beans-memory/memory.db" }
    }
  }
}
```

## CLI dan skill (opsional)

Store yang sama bisa dipakai tanpa registrasi tool:

```bash
bun src/cli.ts search "query" --limit 5
bun src/cli.ts get 12 13
bun src/cli.ts note --title "Judul" --type decision --body "Apa yang berubah dan kenapa"
bun src/cli.ts note --title "Judul" --stdin <<'EOF'
Isi multi-baris.
EOF
bun src/cli.ts recent --limit 5
bun src/cli.ts stats
bun src/cli.ts projects
```

Flag: `--limit`, `--type`, `--files a,b`, `--concepts x,y`, `--json`, `--db <path>`, `--project <name>`.

Pasang launcher ke PATH:

```bash
printf '#!/bin/sh\nexec /ABSOLUTE/PATH/TO/bun /ABSOLUTE/PATH/TO/beans-memory/src/cli.ts "$@"\n' \
  > ~/.local/bin/beans-memory
chmod +x ~/.local/bin/beans-memory
```

Skill di `skills/beans-memory/SKILL.md` mengajari agent kapan harus menjalankan perintah itu. Copy ke `~/.claude/skills/beans-memory/SKILL.md`; OpenCode dan Claude Code sama-sama membaca folder tersebut.

Kalau ingin skill sebagai satu-satunya jalur, set `MEMORY_TOOLS=off` sebelum OpenCode dijalankan. Hook plugin tetap menangkap prompt dan menyuntik konteks; empat tool plugin tidak didaftarkan.

## Agent lain

Server MCP bisa dipakai klien apa pun yang mendukung stdio MCP. Semua agent di mesin yang sama berbagi satu database, jadi catatan dari Claude Code terlihat di Codex, Gemini CLI, dan OpenCode.

File siap pakai ada di `examples/`. Ganti `/ABSOLUTE/PATH/TO/` dengan path sebenarnya.

### Claude Code

```bash
claude mcp add --scope user --transport stdio beans_memory -- \
  /ABSOLUTE/PATH/TO/bun /ABSOLUTE/PATH/TO/beans-memory/src/mcp.ts
```

Atau copy `examples/claude-code.mcp.json` ke `.mcp.json` di root project untuk server ber-scope project yang bisa dipakai satu tim.

Nama tool diberi prefix: `mcp__beans_memory__memory_search`.

### Codex

Gabungkan `examples/codex.config.toml` ke `~/.codex/config.toml`. Untuk scope project, pakai `.codex/config.toml` di dalam project yang sudah dipercaya.

### Gemini CLI

```bash
gemini mcp add -s user beans-memory \
  /ABSOLUTE/PATH/TO/bun /ABSOLUTE/PATH/TO/beans-memory/src/mcp.ts
```

Atau gabungkan `examples/gemini.settings.json` ke `~/.gemini/settings.json`.

Pertahankan tanda hubung di nama server (`beans-memory`). Gemini menyusun nama tool sebagai `mcp_<server>_<tool>` dan parser policy-nya memecah pada underscore pertama, jadi underscore di nama server merusak aturan wildcard.

### Beri tahu agent cara memakainya

Config hanya membuka tool. Tambahkan `examples/memory-instructions.md` ke file instruksi agent: `CLAUDE.md`, `AGENTS.md`, atau `GEMINI.md`.

## Data

Lokasi default:

```
~/.local/share/beans-memory/memory.db
```

Ubah dengan `MEMORY_DB=/path/ke/memory.db`. Semua project memakai satu file; kolom `project` yang memisahkan. Nama project diambil dari basename working directory, jadi `~/work/api` menjadi project `api`.

Backup, dengan OpenCode tertutup:

```bash
cp ~/.local/share/beans-memory/memory.db ~/backup-memory.db
```

Atau saat database hidup:

```bash
sqlite3 ~/.local/share/beans-memory/memory.db ".backup '/path/ke/copy.db'"
```

Reset: hentikan OpenCode, hapus file, jalankan lagi. Skema dibuat ulang dalam keadaan kosong.

Timestamp disimpan dalam UTC dan ditampilkan dalam waktu lokal.

## Import dari claude-mem (opsional)

Kalau punya `~/.claude-mem/claude-mem.db` lama:

```bash
cd /path/ke/beans-memory

# observasi; baris bertipe discovery dilewati secara default
bun src/import-claude-mem-db.ts --dry-run
bun src/import-claude-mem-db.ts

# ringkasan sesi dan prompt historis
bun src/import-claude-mem-extras.ts --dry-run
bun src/import-claude-mem-extras.ts
```

Flag: `--source`, `--db`, `--project`, `--include-discovery`, `--dry-run`.

Untuk memindahkan database dari versi lama project ini:

```bash
bun src/migrate-legacy-db.ts --from /lama/memory.db
```

## Keamanan

- Data tetap di mesin ini. Tidak ada panggilan jaringan, tidak ada telemetri.
- Catatan disimpan apa adanya. Tidak ada redaksi rahasia pada catatan. Jangan simpan token, password, atau isi `.env` ke dalam catatan.
- Prompt yang ditangkap otomatis diredaksi untuk pola rahasia umum: API key OpenAI/GitHub/AWS/Google, webhook Slack/Discord, dan pola `password=` / `token:`. Redaksi ini tidak lengkap, jadi tetap jangan menempelkan rahasia ke chat.
- Database bisa dibaca proses apa pun yang berjalan sebagai user kamu. Perlakukan seperti file catatan, bukan vault.

## Troubleshooting

- `memory_stats` tidak muncul setelah restart: cek path `ENTRY` di loader dan jalankan pengecekan `bun -e` di atas. OpenCode mencatat error loader di `~/.local/share/opencode/log/opencode.log`.
- Plugin diam saja: loader menangkap error import, biasanya karena kode ada di disk yang tidak ter-mount. Mount lalu restart.
- `Cannot use import statement outside a module`: buat `~/.config/opencode/plugins/package.json` berisi `{"type":"module"}`.
- `database is locked`: ada proses lain yang menulis. Tutup agent lain atau tunggu; database memakai WAL dengan busy timeout 5 detik.
- Permission denied pada database: file `0600` dan folder `0700` memang disengaja. Jalankan sebagai user yang membuatnya.

## Keterbatasan

- Pencarian hanya kata kunci, tanpa embedding.
- Tidak ada ringkasan otomatis. Catatan hanya ada kalau agent menulisnya.
- Injeksi konteks hanya index singkat (8 judul), bukan isi lengkap.
- Identitas project adalah basename working directory. Dua repo berbeda dengan nama folder sama akan berbagi catatan, kecuali kamu set `MEMORY_PROJECT`.
- Satu pengguna, satu mesin. Tanpa sinkronisasi.
- SQLite diakses oleh proses plugin dan proses MCP. Mode WAL plus busy timeout 5 detik menangani itu; penulisan konkuren berat bukan target desain.

## Struktur

```
src/db.ts                   skema, FTS5, migrasi
src/repo.ts                 query: sesi, prompt, observasi, pencarian
src/plugin.ts               plugin OpenCode: hook dan tool
src/mcp.ts                  server MCP stdio
src/cli.ts                  CLI untuk pemakaian lewat skill
src/time.ts                 format UTC ke waktu lokal
src/redact.ts               redaksi rahasia untuk prompt yang ditangkap
src/rehash.ts               migrasi hash sekali jalan
src/redact-prompts.ts       redaksi baris prompt lama
src/import-claude-mem-db.ts import observasi dari claude-mem
src/import-claude-mem-extras.ts import ringkasan dan prompt
src/migrate-legacy-db.ts    salin database beans-memory versi lama
skills/beans-memory/        skill agent untuk CLI
test/                       bun test: repo, edge, time, MCP, CLI, redaksi
```

## Uninstall

1. Hapus `~/.config/opencode/plugins/memory/`.
2. Hapus entri `beans_memory` dari `opencode.json` kalau pernah ditambahkan.
3. Hapus `~/.local/share/beans-memory/` kalau catatan tidak ingin disimpan.
