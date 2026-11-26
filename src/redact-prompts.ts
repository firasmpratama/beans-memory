import { openDb, resolveDbPath } from "./db";
import { redactSecrets } from "./redact";

const db = openDb(process.argv[2] ?? resolveDbPath());

const rows = db
  .query<{ id: number; body: string }, []>("SELECT id, body FROM prompts")
  .all();

let updated = 0;
db.transaction(() => {
  for (const row of rows) {
    const next = redactSecrets(row.body);
    if (next === row.body) continue;
    db.run("UPDATE prompts SET body = ? WHERE id = ?", [next, row.id]);
    updated += 1;
  }
})();

console.log(
  JSON.stringify(
    { db: process.argv[2] ?? resolveDbPath(), scanned: rows.length, redacted: updated },
    null,
    2,
  ),
);
db.close();
