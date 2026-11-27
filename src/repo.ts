import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { redactSecrets } from "./redact";

export type ObservationInput = {
  sessionID?: string | null;
  project: string;
  type?: string;
  title: string;
  body?: string;
  files?: string[];
  concepts?: string[];
  source?: "agent" | "capture" | "import" | "import_summary";
  createdAt?: string;
};

export type ObservationRow = {
  id: number;
  created_at: string;
  type: string;
  title: string;
  files: string;
  snip?: string;
};

function hashOf(project: string, title: string, body: string): string {
  return createHash("sha256")
    .update(JSON.stringify([project, title, body]))
    .digest("hex");
}

export function observationHash(project: string, title: string, body: string): string {
  return hashOf(project, title.trim().slice(0, 300), (body ?? "").trim().slice(0, 20000));
}

function json(value: string[] | undefined): string {
  return JSON.stringify(value ?? []);
}

export function ensureSession(
  db: Database,
  input: { id: string; project: string; directory?: string; title?: string },
): void {
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO sessions (id, project, directory, title, started_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = coalesce(excluded.title, sessions.title)`,
    [input.id, input.project, input.directory ?? null, input.title ?? null, now],
  );
}

export function touchSessionFiles(db: Database, sessionID: string, files: string[]): void {
  if (!sessionID || files.length === 0) return;
  const row = db
    .query<{ files: string }, [string]>("SELECT files FROM sessions WHERE id = ?")
    .get(sessionID);
  if (!row) return;
  let existing: string[] = [];
  try {
    const parsed = JSON.parse(row.files);
    if (Array.isArray(parsed)) existing = parsed.map(String);
  } catch {
    existing = [];
  }
  const merged = [...new Set([...existing, ...files])].slice(-200);
  db.run("UPDATE sessions SET files = ? WHERE id = ?", [JSON.stringify(merged), sessionID]);
}

export function addPrompt(
  db: Database,
  input: { sessionID: string; project: string; body: string },
): void {
  const body = redactSecrets(input.body).trim().slice(0, 8000);
  if (!body) return;
  const now = new Date();
  db.run(
    "INSERT INTO prompts (session_id, project, body, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?)",
    [input.sessionID, input.project, body, now.toISOString(), now.getTime()],
  );
}

export function addObservation(
  db: Database,
  input: ObservationInput,
): { id: number; inserted: boolean } {
  const title = input.title.trim().slice(0, 300);
  const body = (input.body ?? "").trim().slice(0, 20000);
  if (!title) throw new Error("title is required");
  const rawCreatedAt = input.createdAt as string | null | undefined;
  if (
    rawCreatedAt === null ||
    (typeof rawCreatedAt === "string" && rawCreatedAt.trim() === "")
  ) {
    throw new Error(`createdAt tidak valid: ${String(rawCreatedAt)}`);
  }
  const created = rawCreatedAt === undefined ? new Date() : new Date(rawCreatedAt);
  if (Number.isNaN(created.getTime())) {
    throw new Error(`createdAt tidak valid: ${rawCreatedAt}`);
  }
  const hash = observationHash(input.project, title, body);

  const existing = db
    .query<{ id: number }, [string]>("SELECT id FROM observations WHERE content_hash = ?")
    .get(hash);
  if (existing) return { id: existing.id, inserted: false };

  db.run(
    `INSERT INTO observations
      (session_id, project, type, title, body, files, concepts, source, content_hash, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(content_hash) DO NOTHING`,
    [
      input.sessionID ?? null,
      input.project,
      input.type ?? "note",
      title,
      body,
      json(input.files),
      json(input.concepts),
      input.source ?? "agent",
      hash,
      created.toISOString(),
      created.getTime(),
    ],
  );

  const changed = db.query<{ n: number }, []>("SELECT changes() AS n").get()?.n ?? 0;
  const row = db
    .query<{ id: number }, [string]>("SELECT id FROM observations WHERE content_hash = ?")
    .get(hash);
  return { id: row?.id ?? 0, inserted: changed > 0 };
}

export function recentObservations(
  db: Database,
  project: string,
  limit = 8,
): ObservationRow[] {
  const requested = typeof limit === "number" && Number.isFinite(limit) ? limit : 8;
  const bounded = Math.min(Math.max(Math.trunc(requested), 1), 200);
  return db
    .query<ObservationRow, [string, number]>(
      `SELECT id, created_at, type, title, files
       FROM observations
       WHERE project = ? AND source <> 'import_summary'
       ORDER BY created_at_epoch DESC
       LIMIT ?`,
    )
    .all(project, bounded);
}

function tokensOf(query: string): string[] {
  return (query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 8);
}

export function searchObservations(
  db: Database,
  input: { project: string; query: string; limit?: number; type?: string },
): ObservationRow[] {
  const requested = typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : 10;
  const limit = Math.min(Math.max(Math.trunc(requested), 1), 50);
  const tokens = tokensOf(input.query);
  if (tokens.length === 0) return recentObservations(db, input.project, limit);

  const typeFilter = input.type ? "AND o.type = ?" : "";
  const run = (match: string): ObservationRow[] => {
    const params: (string | number)[] = [match, input.project];
    if (input.type) params.push(input.type);
    params.push(limit);
    try {
      return db
        .query<ObservationRow, (string | number)[]>(
          `SELECT o.id, o.created_at, o.type, o.title, o.files,
                  snippet(observations_fts, -1, '[', ']', '…', 12) AS snip
           FROM observations_fts
           JOIN observations o ON o.id = observations_fts.rowid
           WHERE observations_fts MATCH ? AND o.project = ? ${typeFilter}
           ORDER BY bm25(observations_fts)
           LIMIT ?`,
        )
        .all(...params);
    } catch (error) {
      console.error("[memory] pencarian gagal:", error);
      return [];
    }
  };

  const quoted = tokens.map((token) => `"${token}"*`);
  const precise = run(quoted.join(" "));
  if (precise.length > 0) return precise;
  return run(quoted.join(" OR "));
}

export function getObservations(
  db: Database,
  ids: number[],
): Array<{
  id: number;
  created_at: string;
  type: string;
  title: string;
  body: string;
  files: string[];
  concepts: string[];
}> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .query<
      {
        id: number;
        created_at: string;
        type: string;
        title: string;
        body: string;
        files: string;
        concepts: string;
      },
      number[]
    >(
      `SELECT id, created_at, type, title, coalesce(body, '') AS body, files, concepts
       FROM observations WHERE id IN (${placeholders}) ORDER BY created_at_epoch DESC`,
    )
    .all(...ids);

  return rows.map((row) => ({
    ...row,
    files: safeArray(row.files),
    concepts: safeArray(row.concepts),
  }));
}

function safeArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function stats(
  db: Database,
  project: string,
): { observations: number; prompts: number; sessions: number; lastObservation: string | null } {
  const observations = db
    .query<{ n: number }, [string]>("SELECT count(*) AS n FROM observations WHERE project = ?")
    .get(project)?.n ?? 0;
  const prompts = db
    .query<{ n: number }, [string]>("SELECT count(*) AS n FROM prompts WHERE project = ?")
    .get(project)?.n ?? 0;
  const sessions = db
    .query<{ n: number }, [string]>("SELECT count(*) AS n FROM sessions WHERE project = ?")
    .get(project)?.n ?? 0;
  const last = db
    .query<{ created_at: string }, [string]>(
      "SELECT created_at FROM observations WHERE project = ? ORDER BY created_at_epoch DESC LIMIT 1",
    )
    .get(project)?.created_at ?? null;
  return { observations, prompts, sessions, lastObservation: last };
}
