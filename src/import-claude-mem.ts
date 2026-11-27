import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { openDb } from "./db";
import { addObservation, stats } from "./repo";
import { normalizeIsoDate } from "./time";

type Row = {
  id?: number;
  project?: string;
  type?: string;
  title?: string;
  subtitle?: string;
  narrative?: string;
  facts?: string;
  concepts?: string;
  files_modified?: string;
  files_read?: string;
  created_at?: unknown;
  source?: string;
};

const args = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  const value = args[index + 1];
  return index >= 0 && value ? value : fallback;
}

const jsonlPath = arg("jsonl", "");
const dbPath = arg("db", "");
const project = arg("project", "");
const includeDiscovery = args.includes("--include-discovery");
const dryRun = args.includes("--dry-run");

if (!jsonlPath || !dbPath || !project) {
  console.error(
    "Usage: bun import-claude-mem.ts --jsonl <observations.jsonl> --db <memory.db> --project <name> [--include-discovery] [--dry-run]",
  );
  process.exit(1);
}

const KEEP_TYPES = new Set([
  "decision",
  "bugfix",
  "feature",
  "change",
  "refactor",
  "security_note",
  "sensitive",
  "test-coverage",
]);

function parseArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const lines = readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean);

const db = dryRun ? null : openDb(dbPath);
let inserted = 0;
let skippedType = 0;
let skippedDup = 0;
let failed = 0;

for (const line of lines) {
  let row: Row;
  try {
    row = JSON.parse(line);
  } catch {
    failed += 1;
    continue;
  }

  const type = (row.type ?? "note").toLowerCase();
  if (type === "discovery" && !includeDiscovery) {
    skippedType += 1;
    continue;
  }
  if (!KEEP_TYPES.has(type) && type !== "discovery") {
    skippedType += 1;
    continue;
  }

  const facts = parseArray(row.facts);
  const body = [row.narrative ?? "", facts.length > 0 ? facts.map((fact) => `- ${fact}`).join("\n") : ""]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  const createdAt = normalizeIsoDate(row.created_at);
  if (createdAt === null) {
    failed += 1;
    console.error("gagal: createdAt tidak valid");
    continue;
  }

  if (dryRun || !db) {
    inserted += 1;
    continue;
  }

  try {
    const result = addObservation(db, {
      project,
      type,
      title: row.title ?? row.subtitle ?? "Tanpa judul",
      body,
      files: parseArray(row.files_modified),
      concepts: parseArray(row.concepts),
      source: "import",
      createdAt,
    });
    if (result.inserted) inserted += 1;
    else skippedDup += 1;
  } catch (error) {
    failed += 1;
    console.error("gagal:", error instanceof Error ? error.message : error);
  }
}

console.log(
  JSON.stringify(
    {
      project,
      db: dbPath,
      totalLines: lines.length,
      inserted,
      skippedType,
      skippedDup,
      failed,
      dryRun,
      stats: db ? stats(db, project) : null,
    },
    null,
    2,
  ),
);

if (db) db.close();
