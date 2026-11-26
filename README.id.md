# agent-memory

[English](README.md) | Bahasa Indonesia

Memory lokal dan permanen untuk [OpenCode](https://opencode.ai). Tanpa daemon, tanpa cloud, tanpa akun. Satu file SQLite per mesin.

Agent bisa menyimpan catatan saat bekerja, mencarinya lagi nanti, dan menerima index kecil di awal setiap sesi.

## Cara kerja

```
OpenCode (runtime Bun)
├── plugin  src/plugin.ts   hook + tool memory_*, jalan di dalam proses
├── MCP     src/mcp.ts      tool yang sama lewat stdio, untuk klien lain
└── SQLite  ~/.local/share/agent-memory/memory.db
              observations + FTS5 + prompts + sessions
```

- **Plugin** mencatat prompt user, mencatat file yang disentuh tool edit/write, dan menyuntik 8 judul catatan terbaru sekali per sesi.
- **Tool** membuat agent bisa menulis dan mencari catatan permanen. Ringkasan ditulis oleh agent sendiri, jadi tidak ada panggilan model tambahan dan tidak ada worker latar.
- **MCP** membuka store yang sama untuk klien MCP mana pun (Claude Desktop, Cursor, skrip).
- **Pencarian** memakai SQLite FTS5: AND dulu, OR sebagai fallback, diurutkan dengan BM25.
- Semua gagal terbuka. Kalau database atau plugin rusak, OpenCode tetap jalan tanpa memory.

## Kebutuhan

- OpenCode 2
- Bun 1.2+ hanya kalau mau memakai server MCP, skrip import, atau test. Plugin sendiri berjalan di dalam Bun bawaan OpenCode, jadi tidak perlu instalasi untuk pemakaian normal.
  - `curl -fsSL https://bun.sh/install | bash`
- macOS atau Linux. Windows secara teori bisa, belum diuji.

## Instalasi

1. Simpan kode di lokasi permanen:

```bash
git clone https://github.com/firasmpratama/agent-memory ~/tools/agent-memory
cd ~/tools/agent-memory
bun test   # opsional, memakai database sementara
```

2. Buat loader OpenCode:

```bash
mkdir -p ~/.config/opencode/plugins/memory
```

`~/.config/opencode/plugins/memory/index.ts`:

```ts
import { pathToFileURL } from "node:url";

const ENTRY = "/path/absolut/ke/agent-memory/src/plugin.ts";

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

3. Restart OpenCode.

4. Verifikasi. Minta agent memanggil `memory_stats`. Di instalasi baru, hasilnya nol catatan.

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
      "agent_memory": {
        "type": "local",
        "command": ["/path/absolut/ke/bun", "/path/absolut/ke/agent-memory/src/mcp.ts"]
      }
    }
  }
}
```

- Server memakai JSON-RPC lewat stdio, satu pesan per baris.
- Tool: `memory_search`, `memory_get`, `memory_note`, `memory_stats`.
- Pemilihan database: `MEMORY_DB`, kalau kosong `~/.local/share/agent-memory/memory.db`.
- Nama project: `MEMORY_PROJECT`, kalau kosong basename dari working directory proses.

Contoh Claude Desktop:

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "/path/absolut/ke/bun",
      "args": ["/path/absolut/ke/agent-memory/src/mcp.ts"],
      "env": { "MEMORY_DB": "/Users/kamu/.local/share/agent-memory/memory.db" }
    }
  }
}
```

## Data

Lokasi default:

```
~/.local/share/agent-memory/memory.db
```

Ubah dengan `MEMORY_DB=/path/ke/memory.db`. Semua project memakai satu file; kolom `project` yang memisahkan. Nama project diambil dari basename working directory, jadi `~/work/api` menjadi project `api`.

Backup, dengan OpenCode tertutup:

```bash
cp ~/.local/share/agent-memory/memory.db ~/backup-memory.db
```

Atau saat database hidup:

```bash
sqlite3 ~/.local/share/agent-memory/memory.db ".backup '/path/ke/copy.db'"
```

Reset: hentikan OpenCode, hapus file, jalankan lagi. Skema dibuat ulang dalam keadaan kosong.

Timestamp disimpan dalam UTC dan ditampilkan dalam waktu lokal.

## Import dari claude-mem (opsional)

Kalau punya `~/.claude-mem/claude-mem.db` lama:

```bash
cd /path/ke/agent-memory

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
- Catatan disimpan apa adanya. Tidak ada redaksi rahasia. Jangan simpan token, password, atau isi `.env` ke dalam catatan.
- Database bisa dibaca proses apa pun yang berjalan sebagai user kamu. Perlakukan seperti file catatan, bukan vault.

## Keterbatasan

- Pencarian hanya kata kunci, tanpa embedding.
- Tidak ada ringkasan otomatis. Catatan hanya ada kalau agent menulisnya.
- Injeksi konteks hanya index singkat (8 judul), bukan isi lengkap.
- Satu pengguna, satu mesin. Tanpa sinkronisasi.
- SQLite diakses oleh proses plugin dan proses MCP. Mode WAL plus busy timeout 5 detik menangani itu; penulisan konkuren berat bukan target desain.

## Struktur

```
src/db.ts                   skema, FTS5, migrasi
src/repo.ts                 query: sesi, prompt, observasi, pencarian
src/plugin.ts               plugin OpenCode: hook dan tool
src/mcp.ts                  server MCP stdio
src/time.ts                 format UTC ke waktu lokal
src/import-claude-mem-db.ts import observasi dari claude-mem
src/import-claude-mem-extras.ts import ringkasan dan prompt
src/migrate-legacy-db.ts    salin database agent-memory versi lama
test/repo.test.ts           bun test
```

## Uninstall

1. Hapus `~/.config/opencode/plugins/memory/`.
2. Hapus entri `agent_memory` dari `opencode.json` kalau pernah ditambahkan.
3. Hapus `~/.local/share/agent-memory/` kalau catatan tidak ingin disimpan.
