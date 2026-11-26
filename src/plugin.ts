import { basename } from "node:path";
import { localDate, localStamp } from "./time";
import { openDb, resolveDbPath } from "./db";
import {
  addObservation,
  addPrompt,
  ensureSession,
  getObservations,
  recentObservations,
  searchObservations,
  stats,
  touchSessionFiles,
} from "./repo";

type AnyContext = {
  location?: { directory?: string; workspaceID?: string };
  event?: { subscribe(options: { signal: AbortSignal }): AsyncIterable<any> };
  session?: { hook(name: string, handler: (event: any) => unknown): Promise<unknown> };
  tool?: {
    transform(callback: (editor: any) => void): Promise<unknown>;
    hook?(name: string, handler: (event: any) => unknown): Promise<unknown>;
  };
};

const EDIT_TOOLS = new Set(["edit", "write", "patch", "multiedit", "apply_patch"]);

function collectFiles(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const record = input as Record<string, unknown>;
  const files: string[] = [];
  for (const key of ["filePath", "file_path", "path", "filename"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) files.push(value);
  }
  if (Array.isArray(record.edits)) {
    for (const edit of record.edits) {
      if (edit && typeof edit === "object") {
        const value = (edit as Record<string, unknown>).filePath;
        if (typeof value === "string" && value.length > 0) files.push(value);
      }
    }
  }
  return [...new Set(files)];
}

function formatContext(project: string, rows: ReturnType<typeof recentObservations>): string {
  if (rows.length === 0) return "";
  const lines = rows.map((row) => {
    let files: string[] = [];
    try {
      const parsed = JSON.parse(row.files);
      if (Array.isArray(parsed)) files = parsed.map((file) => basename(String(file))).slice(0, 3);
    } catch {
      files = [];
    }
    const suffix = files.length > 0 ? ` — ${files.join(", ")}` : "";
    return `- ${localDate(row.created_at)} [${row.type}] ${row.title}${suffix}`;
  });
  return [
    `<memory project="${project}">`,
    "Catatan tersimpan dari sesi sebelumnya. Pakai memory_search untuk mencari, memory_get untuk teks lengkap.",
    ...lines,
    "</memory>",
  ].join("\n");
}

export default {
  id: "memory",
  async setup(ctx: AnyContext) {
    const directory = ctx.location?.directory ?? process.cwd();
    const project = process.env.MEMORY_PROJECT || basename(directory);

    let db: ReturnType<typeof openDb>;
    try {
      db = openDb(resolveDbPath(directory));
    } catch (error) {
      console.error("[memory] gagal membuka database:", error);
      return () => {};
    }

    const delivered = new Set<string>();
    const controller = new AbortController();

    const safe = async <T>(label: string, run: () => T | Promise<T>, fallback: T): Promise<T> => {
      try {
        return await run();
      } catch (error) {
        console.error(`[memory] ${label}:`, error);
        return fallback;
      }
    };

    if (ctx.tool?.transform && process.env.MEMORY_TOOLS !== "off") {
      const registered = await safe<unknown>(
        "register tools",
        () =>
          ctx.tool!.transform((editor) => {
            editor.add({
              name: "memory_note",
              description:
                "Simpan catatan permanen untuk project ini: keputusan, bugfix, aturan bisnis, atau temuan wiring. Tulis singkat dan spesifik. Panggil setelah tugas selesai atau saat menemukan hal yang layak diingat sesi berikutnya.",
              input: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Judul satu baris, maksimal 120 karakter." },
                  body: {
                    type: "string",
                    description: "Penjelasan: masalah, keputusan, alasan, dan file terkait.",
                  },
                  type: {
                    type: "string",
                    enum: [
                      "decision",
                      "bugfix",
                      "feature",
                      "refactor",
                      "security_note",
                      "note",
                    ],
                    description: "Jenis catatan. Default note.",
                  },
                  files: {
                    type: "array",
                    items: { type: "string" },
                    description: "Path file yang relevan.",
                  },
                  concepts: {
                    type: "array",
                    items: { type: "string" },
                    description: "Tag konsep singkat.",
                  },
                },
                required: ["title", "body"],
                additionalProperties: false,
              },
              execute: async (input: any) => {
                const result = addObservation(db, {
                  project,
                  title: String(input?.title ?? ""),
                  body: String(input?.body ?? ""),
                  type: typeof input?.type === "string" ? input.type : "note",
                  files: Array.isArray(input?.files) ? input.files.map(String) : [],
                  concepts: Array.isArray(input?.concepts) ? input.concepts.map(String) : [],
                  source: "agent",
                });
                return {
                  content: result.inserted
                    ? `Catatan tersimpan sebagai #${result.id}.`
                    : `Catatan identik sudah ada sebagai #${result.id}.`,
                };
              },
            });

            editor.add({
              name: "memory_search",
              description:
                "Cari catatan memory project ini dengan FTS. Mengembalikan index ringkas berisi id, tanggal, tipe, dan judul. Pakai memory_get untuk isi lengkap.",
              input: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Kata kunci pencarian." },
                  limit: { type: "number", description: "Jumlah hasil, default 10, maksimal 50." },
                  type: {
                    type: "string",
                    description: "Filter tipe, misalnya decision atau bugfix.",
                  },
                },
                required: ["query"],
                additionalProperties: false,
              },
              execute: async (input: any) => {
                const rows = searchObservations(db, {
                  project,
                  query: String(input?.query ?? ""),
                  limit: Number(input?.limit ?? 10),
                  type: typeof input?.type === "string" ? input.type : undefined,
                });
                if (rows.length === 0) return { content: "Tidak ada catatan yang cocok." };
                const lines = rows.map((row) => {
                  const snip = row.snip ? ` | ${row.snip.replace(/\s+/g, " ").slice(0, 160)}` : "";
                  return `#${row.id} · ${localDate(row.created_at)} · ${row.type} · ${row.title}${snip}`;
                });
                return { content: lines.join("\n") };
              },
            });

            editor.add({
              name: "memory_get",
              description:
                "Ambil isi lengkap satu atau beberapa catatan memory berdasarkan id hasil memory_search.",
              input: {
                type: "object",
                properties: {
                  ids: {
                    type: "array",
                    items: { type: "number" },
                    description: "Daftar id catatan.",
                  },
                },
                required: ["ids"],
                additionalProperties: false,
              },
              execute: async (input: any) => {
                const ids = Array.isArray(input?.ids)
                  ? input.ids.map((id: unknown) => Number(id)).filter(Number.isFinite)
                  : [];
                const rows = getObservations(db, ids);
                if (rows.length === 0) return { content: "Catatan tidak ditemukan." };
                const blocks = rows.map((row) =>
                  [
                    `# ${row.title} (#${row.id})`,
                    `Tanggal: ${localStamp(row.created_at)} · Tipe: ${row.type}`,
                    row.files.length > 0 ? `File: ${row.files.join(", ")}` : "",
                    "",
                    row.body,
                  ]
                    .filter(Boolean)
                    .join("\n"),
                );
                return { content: blocks.join("\n\n---\n\n") };
              },
            });

            editor.add({
              name: "memory_stats",
              description: "Ringkasan isi memory project ini: jumlah catatan, prompt, sesi, dan tanggal catatan terakhir.",
              input: { type: "object", properties: {}, additionalProperties: false },
              execute: async () => {
                const value = stats(db, project);
                return {
                  content: `Project ${project}: ${value.observations} catatan, ${value.prompts} prompt, ${value.sessions} sesi. Catatan terakhir: ${value.lastObservation ? localStamp(value.lastObservation) : "belum ada"}.`,
                };
              },
            });
          }),
        null,
      );
      if (registered === null) {
        try {
          db.close();
        } catch {
          // ignore
        }
        return () => {};
      }
    }

    if (ctx.session?.hook) {
      await safe(
        "context hook",
        () =>
          ctx.session!.hook("context", async (event: any) => {
            const sessionID = String(event?.sessionID ?? "");
            if (!sessionID || delivered.has(sessionID)) return;
            try {
              const rows = recentObservations(db, project, 8);
              const text = formatContext(project, rows);
              if (!text || !Array.isArray(event.system)) return;
              event.system.push({ type: "text", text });
              delivered.add(sessionID);
            } catch (error) {
              console.error("[memory] context gagal:", error);
            }
          }),
        null,
      );

      await safe(
        "prompt hook",
        () =>
          ctx.session!.hook("prompt", async (event: any) => {
            const sessionID = String(event?.sessionID ?? "");
            const text = typeof event?.prompt?.text === "string" ? event.prompt.text : "";
            if (!sessionID || !text) return;
            try {
              ensureSession(db, { id: sessionID, project, directory });
              addPrompt(db, { sessionID, project, body: text });
            } catch (error) {
              console.error("[memory] prompt gagal:", error);
            }
          }),
        null,
      );
    }

    if (ctx.tool?.hook) {
      await safe(
        "tool hook",
        () =>
          ctx.tool!.hook!("execute.after", async (event: any) => {
            const sessionID = String(event?.sessionID ?? "");
            if (!sessionID || event?.status !== "completed") return;
            const tool = String(event?.tool ?? "");
            if (!EDIT_TOOLS.has(tool)) return;
            try {
              const files = collectFiles(event?.input);
              touchSessionFiles(db, sessionID, files);
            } catch (error) {
              console.error("[memory] tool hook gagal:", error);
            }
          }),
        null,
      );
    }

    if (ctx.event?.subscribe) {
      void (async () => {
        try {
          for await (const event of ctx.event!.subscribe({ signal: controller.signal })) {
            const sessionID = event?.data?.sessionID;
            if (typeof sessionID !== "string" || !sessionID) continue;
            if (event.type === "session.created") {
              ensureSession(db, { id: sessionID, project, directory });
            } else if (event.type === "session.deleted") {
              delivered.delete(sessionID);
            } else if (event.type === "session.compaction.ended" || event.type === "session.compacted") {
              delivered.delete(sessionID);
            }
          }
        } catch {
          // stream closed; nothing to do
        }
      })();
    }

    return () => {
      controller.abort();
      try {
        db.close();
      } catch {
        // ignore
      }
    };
  },
};
