#!/usr/bin/env bun
import { basename } from "node:path";
import { openDb, resolveDbPath } from "./db";
import { install, TARGETS } from "./install";
import {
  addObservation,
  getObservations,
  recentObservations,
  searchObservations,
  stats,
} from "./repo";
import { localDate, localStamp } from "./time";

type Parsed = {
  positional: string[];
  flags: Record<string, string | boolean>;
};

function parse(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [rawKey, inline] = token.slice(2).split("=", 2);
    const key = (rawKey ?? "").trim();
    const next = argv[index + 1];
    if (inline !== undefined) {
      flags[key] = inline;
    } else if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
}

function list(value: string | boolean | undefined): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  beans-memory search <query> [--limit=N] [--type=T] [--json]",
      "  beans-memory get <id...> [--json]",
      "  beans-memory note --title <title> (--body <text> | --stdin) [--type=T] [--files a,b] [--concepts x,y]",
      "  beans-memory recent [--limit=N] [--json]",
      "  beans-memory stats [--json]",
      "  beans-memory projects [--json]",
      "  beans-memory install [--opencode] [--claude] [--codex] [--gemini] [--hermes] [--all] [--dry-run]",
      "",
      "Global: --db <path>, --project <name>",
      "Env: MEMORY_DB, MEMORY_PROJECT",
    ].join("\n"),
  );
  process.exit(1);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const { positional, flags } = parse(process.argv.slice(2));
const command = positional.shift();

if (!command) usage();

if (command === "install") {
  const selectedTargets = TARGETS.filter((target) => flags[target] === true);
  const targets = flags.all === true ? [...TARGETS] : selectedTargets;
  try {
    const reports = install({
      targets: targets.length > 0 ? targets : undefined,
      dryRun: flags["dry-run"] === true,
    });
    for (const report of reports) {
      console.log(`${report.target}: ${report.status} · ${report.detail}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
  process.exit();
}

const dbPath = typeof flags.db === "string" ? flags.db : resolveDbPath();
const project =
  (typeof flags.project === "string" ? flags.project : "") ||
  process.env.MEMORY_PROJECT ||
  basename(process.cwd());
const json = flags.json === true;
const limit = Number(typeof flags.limit === "string" ? flags.limit : 10);

const db = openDb(dbPath);

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

try {
  if (command === "search") {
    const query = positional.join(" ").trim();
    if (!query) usage();
    const rows = searchObservations(db, {
      project,
      query,
      limit,
      type: typeof flags.type === "string" ? flags.type : undefined,
    });
    if (json) print(rows);
    else if (rows.length === 0) console.log("Tidak ada catatan yang cocok.");
    else
      for (const row of rows) {
        const snippet = row.snip ? ` | ${row.snip.replace(/\s+/g, " ").slice(0, 160)}` : "";
        console.log(`#${row.id} · ${localDate(row.created_at)} · ${row.type} · ${row.title}${snippet}`);
      }
  } else if (command === "get") {
    const ids = positional.map((id) => Number(id)).filter(Number.isFinite);
    if (ids.length === 0) usage();
    const rows = getObservations(db, ids);
    if (json) print(rows);
    else if (rows.length === 0) console.log("Catatan tidak ditemukan.");
    else
      for (const row of rows) {
        console.log(`# ${row.title} (#${row.id})`);
        console.log(`Tanggal: ${localStamp(row.created_at)} · Tipe: ${row.type}`);
        if (row.files.length > 0) console.log(`File: ${row.files.join(", ")}`);
        console.log("");
        console.log(row.body);
        console.log("");
      }
  } else if (command === "note") {
    const title = typeof flags.title === "string" ? flags.title : "";
    if (!title) usage();
    const body = flags.stdin === true ? await readStdin() : typeof flags.body === "string" ? flags.body : "";
    const result = addObservation(db, {
      project,
      title,
      body,
      type: typeof flags.type === "string" ? flags.type : "note",
      files: list(flags.files),
      concepts: list(flags.concepts),
      source: "agent",
    });
    if (json) print(result);
    else
      console.log(
        result.inserted
          ? `Catatan tersimpan sebagai #${result.id}.`
          : `Catatan identik sudah ada sebagai #${result.id}.`,
      );
  } else if (command === "recent") {
    const rows = recentObservations(db, project, limit);
    if (json) print(rows);
    else if (rows.length === 0) console.log("Belum ada catatan.");
    else
      for (const row of rows) {
        console.log(`#${row.id} · ${localDate(row.created_at)} · ${row.type} · ${row.title}`);
      }
  } else if (command === "stats") {
    const value = stats(db, project);
    if (json) print(value);
    else
      console.log(
        `Project ${project}: ${value.observations} catatan, ${value.prompts} prompt, ${value.sessions} sesi. Catatan terakhir: ${
          value.lastObservation ? localStamp(value.lastObservation) : "belum ada"
        }.`,
      );
  } else if (command === "projects") {
    const rows = db
      .query<{ project: string; n: number }, []>(
        "SELECT project, count(*) AS n FROM observations GROUP BY project ORDER BY n DESC",
      )
      .all();
    if (json) print(rows);
    else for (const row of rows) console.log(`${row.project}\t${row.n}`);
  } else {
    usage();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  db.close();
}
