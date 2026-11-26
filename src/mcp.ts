import { basename } from "node:path";
import { createInterface } from "node:readline";
import { openDb, resolveDbPath } from "./db";
import { localDate, localStamp } from "./time";
import {
  addObservation,
  getObservations,
  recentObservations,
  searchObservations,
  stats,
} from "./repo";

const db = openDb(resolveDbPath());
const project = process.env.MEMORY_PROJECT || basename(process.cwd());

const TOOLS = [
  {
    name: "memory_search",
    description:
      "Cari catatan memory project ini. Mengembalikan index ringkas (id, tanggal, tipe, judul). Pakai memory_get untuk isi lengkap.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Kata kunci pencarian." },
        limit: { type: "number", description: "Jumlah hasil, default 10, maksimal 50." },
        type: { type: "string", description: "Filter tipe, misalnya decision atau bugfix." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_get",
    description: "Ambil isi lengkap catatan memory berdasarkan id hasil memory_search.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "number" }, description: "Daftar id catatan." },
      },
      required: ["ids"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_note",
    description:
      "Simpan catatan permanen untuk project ini: keputusan, bugfix, aturan bisnis, atau temuan wiring.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        type: {
          type: "string",
          enum: ["decision", "bugfix", "feature", "refactor", "security_note", "note"],
        },
        files: { type: "array", items: { type: "string" } },
        concepts: { type: "array", items: { type: "string" } },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_stats",
    description: "Ringkasan isi memory project ini.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function text(value: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: value }] };
}

function callTool(name: string, args: any): string {
  if (name === "memory_search") {
    const rows = searchObservations(db, {
      project,
      query: String(args?.query ?? ""),
      limit: Number(args?.limit ?? 10),
      type: typeof args?.type === "string" ? args.type : undefined,
    });
    if (rows.length === 0) return "Tidak ada catatan yang cocok.";
    return rows
      .map((row) => {
        const snip = row.snip ? ` | ${row.snip.replace(/\s+/g, " ").slice(0, 160)}` : "";
        return `#${row.id} · ${localDate(row.created_at)} · ${row.type} · ${row.title}${snip}`;
      })
      .join("\n");
  }

  if (name === "memory_get") {
    const ids = Array.isArray(args?.ids)
      ? args.ids.map((id: unknown) => Number(id)).filter(Number.isFinite)
      : [];
    const rows = getObservations(db, ids);
    if (rows.length === 0) return "Catatan tidak ditemukan.";
    return rows
      .map((row) =>
        [
          `# ${row.title} (#${row.id})`,
          `Tanggal: ${localStamp(row.created_at)} · Tipe: ${row.type}`,
          row.files.length > 0 ? `File: ${row.files.join(", ")}` : "",
          "",
          row.body,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n---\n\n");
  }

  if (name === "memory_note") {
    const result = addObservation(db, {
      project,
      title: String(args?.title ?? ""),
      body: String(args?.body ?? ""),
      type: typeof args?.type === "string" ? args.type : "note",
      files: Array.isArray(args?.files) ? args.files.map(String) : [],
      concepts: Array.isArray(args?.concepts) ? args.concepts.map(String) : [],
      source: "agent",
    });
    return result.inserted
      ? `Catatan tersimpan sebagai #${result.id}.`
      : `Catatan identik sudah ada sebagai #${result.id}.`;
  }

  if (name === "memory_stats") {
    const value = stats(db, project);
    return `Project ${project}: ${value.observations} catatan, ${value.prompts} prompt, ${value.sessions} sesi. Catatan terakhir: ${value.lastObservation ? localStamp(value.lastObservation) : "belum ada"}.`;
  }

  throw new Error(`Tool tidak dikenal: ${name}`);
}

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id: unknown, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id: unknown, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message: any;
  try {
    message = JSON.parse(trimmed);
  } catch {
    fail(null, -32700, "Parse error");
    return;
  }

  const { id, method, params } = message ?? {};
  const hasId = Object.prototype.hasOwnProperty.call(message ?? {}, "id");
  const isNotification = !hasId;

  if (typeof method !== "string") {
    if (hasId) fail(id ?? null, -32600, "Invalid Request");
    return;
  }

  try {
    if (method === "initialize") {
      const requested = params?.protocolVersion;
      const protocolVersion =
        typeof requested === "string" && SUPPORTED_PROTOCOLS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOLS[0];
      reply(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "beans-memory", version: "0.1.0" },
      });
      return;
    }

    if (method === "notifications/initialized" || method === "initialized") return;
    if (method === "ping") {
      if (!isNotification) reply(id, {});
      return;
    }

    if (method === "tools/list") {
      if (!isNotification) reply(id, { tools: TOOLS });
      return;
    }

    if (method === "tools/call") {
      if (isNotification) return;
      const name = String(params?.name ?? "");
      try {
        reply(id, text(callTool(name, params?.arguments)));
      } catch (error) {
        reply(id, {
          content: [
            { type: "text", text: error instanceof Error ? error.message : String(error) },
          ],
          isError: true,
        });
      }
      return;
    }

    if (!isNotification) fail(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    if (!isNotification) fail(id, -32603, error instanceof Error ? error.message : String(error));
  }
});

function shutdown(): void {
  try {
    db.close();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
