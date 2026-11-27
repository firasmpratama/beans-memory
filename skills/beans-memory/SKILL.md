---
name: beans-memory
description: Find saved project notes and store new decisions or bugfixes in local memory. Use before starting work that may have been done before, and after a task that produced a decision, bugfix, or wiring that is hard to rediscover.
metadata:
  opencode/autoinvoke: true
---

# Beans Memory

Local SQLite memory. No cloud, no account.

CLI: `beans-memory`. If the command is not available, use `bunx beans-memory` (npm package) or `bun src/cli.ts` from the repository.

## Before starting

Search first to see whether the topic was already handled:

```bash
beans-memory search "topic keywords" --limit 5
```

If there are relevant results, open their bodies:

```bash
beans-memory get <id> [<id>...]
```

Use `--json` when the result needs structured processing.

## After a task

Save one short note for a decision, bugfix, business rule, or wiring that is not obvious from the code:

```bash
beans-memory note \
  --title "One-line title" \
  --type decision \
  --files "app/Example.php,app/Other.php" \
  --stdin <<'EOF'
What changed, why, and which parts need to be remembered.
EOF
```

Available types: `decision`, `bugfix`, `feature`, `refactor`, `security_note`, `note`.

## Rules

- One note, one fact. Do not write a long summary.
- Include the reason behind a decision, not only the change.
- Never save tokens, passwords, `.env` contents, or personal data.
- The project is derived from the working directory name. Use `--project <name>` when notes must be separated.
- Run `beans-memory stats` to see the note count for this project.
