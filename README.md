<p align="center">
  <img src="docs/peanut.svg" alt="A golden bean with a small green sprout" width="360">
</p>

<h1 align="center">beans-memory</h1>

<p align="center">
  Local, persistent memory for coding agents. One SQLite file. No daemon, no cloud, no account.
</p>

<p align="center">
  English | <a href="README.id.md">Bahasa Indonesia</a>
</p>

The agent can save notes while it works, search them later, and gets a small index injected at the start of each session.

## How it works

```
OpenCode (Bun runtime)
├── plugin  src/plugin.ts   hooks + memory_* tools, runs in-process
├── MCP     src/mcp.ts      same tools over stdio, for other clients
└── SQLite  ~/.local/share/beans-memory/memory.db
              observations + FTS5 + prompts + sessions
```

- **Plugin** captures user prompts, records files touched by edit/write tools, and injects the 8 most recent note titles once per session.
- **Tools** let the agent write and search durable notes. Summaries are written by the agent itself, so no extra model call and no background worker.
- **MCP** exposes the same store to any MCP client (Claude Desktop, Cursor, scripts).
- **Search** uses SQLite FTS5: AND first, OR as fallback, ranked with BM25.
- Everything fails open. If the database or plugin breaks, OpenCode keeps working without memory.

## Requirements

- OpenCode 2
- Bun 1.2+ for the CLI, MCP server, importers, and tests. Not needed for the plugin alone: it runs inside OpenCode's bundled Bun.
  - `curl -fsSL https://bun.sh/install | bash`
- macOS or Linux. Windows works in theory but is untested.

## Quick start

```bash
git clone https://github.com/firasmpratama/beans-memory ~/tools/beans-memory
cd ~/tools/beans-memory
./install.sh
```

Then restart OpenCode and ask the agent to call `memory_stats`. On a fresh install it returns zero notes.

The installer writes the plugin loader, creates the `beans-memory` CLI launcher when Bun is available, and installs the skill. It does not edit `opencode.json` and does not start a service.

No git? Download the source archive from the Releases page, unpack it anywhere permanent, and run `./install.sh` there.

### Manual install

<details>
<summary>Prefer to wire it yourself, or the script failed?</summary>

1. Get the code somewhere permanent:

```bash
git clone https://github.com/firasmpratama/beans-memory ~/tools/beans-memory
cd ~/tools/beans-memory
bun test   # optional, requires Bun; uses a temporary database
```

2. Create the OpenCode loader:

```bash
mkdir -p ~/.config/opencode/plugins/memory
```

`~/.config/opencode/plugins/memory/index.ts`:

```ts
import { pathToFileURL } from "node:url";

const ENTRY = "/absolute/path/to/beans-memory/src/plugin.ts";

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
  console.error("[memory] plugin not loaded:", error);
}

export default plugin;
```

Replace `ENTRY` with the real path. Keep the fallback: if the code is on an external drive that is not mounted, OpenCode still starts with memory disabled instead of failing.

The directory name and file name are free-form. OpenCode loads any `.ts` file under `~/.config/opencode/plugins/`.

3. Restart OpenCode.

4. Verify. Ask the agent to call `memory_stats`. On a fresh install it returns zero notes. If the tool is missing, see Troubleshooting.

Check the loader itself without OpenCode, if Bun is installed:

```bash
bun -e 'import("/absolute/path/to/beans-memory/src/plugin.ts").then((m) => console.log(typeof m.default.setup))'
```

It should print `function`. A path or import error here will also break the plugin in OpenCode.

</details>

## Use

Tools registered by the plugin:

| Tool | Purpose |
|---|---|
| `memory_note` | Save a note: title, body, type, files, concepts |
| `memory_search` | Full-text search, returns compact rows with ids |
| `memory_get` | Full bodies by id |
| `memory_stats` | Counts and last note date |

Suggested workflow for the agent: call `memory_note` after a task that produced a decision, bugfix, or non-obvious wiring discovery. Search first with `memory_search`, then fetch only the rows you need with `memory_get`.

Guided by `AGENTS.md`, the agent should keep notes short: what changed, why, and which files matter.

## MCP server (optional)

For clients that cannot load the plugin:

```jsonc
{
  "mcp": {
    "servers": {
      "beans_memory": {
        "type": "local",
        "command": ["/absolute/path/to/bun", "/absolute/path/to/beans-memory/src/mcp.ts"]
      }
    }
  }
}
```

- The server speaks JSON-RPC over stdio, one message per line.
- Tools: `memory_search`, `memory_get`, `memory_note`, `memory_stats`.
- Database selection: `MEMORY_DB`, otherwise `~/.local/share/beans-memory/memory.db`.
- Project name: `MEMORY_PROJECT`, otherwise the basename of the process working directory.

Claude Desktop example:

```json
{
  "mcpServers": {
    "beans-memory": {
      "command": "/absolute/path/to/bun",
      "args": ["/absolute/path/to/beans-memory/src/mcp.ts"],
      "env": { "MEMORY_DB": "/Users/you/.local/share/beans-memory/memory.db" }
    }
  }
}
```

## CLI and skill (optional)

The same store is available without any tool registration:

```bash
bun src/cli.ts search "query" --limit 5
bun src/cli.ts get 12 13
bun src/cli.ts note --title "Title" --type decision --body "What changed and why"
bun src/cli.ts note --title "Title" --stdin <<'EOF'
Multi-line body.
EOF
bun src/cli.ts recent --limit 5
bun src/cli.ts stats
bun src/cli.ts projects
```

Flags: `--limit`, `--type`, `--files a,b`, `--concepts x,y`, `--json`, `--db <path>`, `--project <name>`.

Install a launcher on PATH:

```bash
printf '#!/bin/sh\nexec /ABSOLUTE/PATH/TO/bun /ABSOLUTE/PATH/TO/beans-memory/src/cli.ts "$@"\n' \
  > ~/.local/bin/beans-memory
chmod +x ~/.local/bin/beans-memory
```

The skill in `skills/beans-memory/SKILL.md` teaches the agent when to run those commands. Copy it to `~/.claude/skills/beans-memory/SKILL.md`; OpenCode and Claude Code both read that directory.

When the skill is the only path you want, set `MEMORY_TOOLS=off` before starting OpenCode. Plugin hooks still capture prompts and inject context; the four plugin tools are not registered.

## Other agents

The MCP server works with any client that speaks stdio MCP. Every agent on the same machine shares one database, so a note saved from Claude Code is visible in Codex, Gemini CLI, and OpenCode.

Ready-to-copy files live in `examples/`. Replace `/ABSOLUTE/PATH/TO/` with real paths first.

### Claude Code

```bash
claude mcp add --scope user --transport stdio beans_memory -- \
  /ABSOLUTE/PATH/TO/bun /ABSOLUTE/PATH/TO/beans-memory/src/mcp.ts
```

Or copy `examples/claude-code.mcp.json` to `.mcp.json` at the project root for a project-scoped server that the whole team can share.

Tool names are prefixed: `mcp__beans_memory__memory_search`.

### Codex

Merge `examples/codex.config.toml` into `~/.codex/config.toml`. For a project-scoped server, use `.codex/config.toml` inside a trusted project instead.

### Gemini CLI

```bash
gemini mcp add -s user beans-memory \
  /ABSOLUTE/PATH/TO/bun /ABSOLUTE/PATH/TO/beans-memory/src/mcp.ts
```

Or merge `examples/gemini.settings.json` into `~/.gemini/settings.json`.

Keep the hyphen in the server name (`beans-memory`). Gemini builds tool names as `mcp_<server>_<tool>` and its policy parser splits on the first underscore, so an underscore in the server name breaks wildcard rules.

### Tell the agent to use it

Config alone only exposes tools. Append `examples/memory-instructions.md` to the agent instruction file: `CLAUDE.md`, `AGENTS.md`, or `GEMINI.md`.

## Data

Default location:

```
~/.local/share/beans-memory/memory.db
```

Override with `MEMORY_DB=/path/to/memory.db`. All projects share one file; the `project` column separates them. The project name comes from the basename of the working directory, so `~/work/api` is project `api`.

Backup, with OpenCode closed:

```bash
cp ~/.local/share/beans-memory/memory.db ~/backup-memory.db
```

Or online:

```bash
sqlite3 ~/.local/share/beans-memory/memory.db ".backup '/path/to/copy.db'"
```

Reset: stop OpenCode, delete the file, start again. The schema is recreated empty.

Timestamps are stored in UTC and displayed in local time.

## Import from claude-mem (optional)

If you have an old `~/.claude-mem/claude-mem.db`:

```bash
cd /path/to/beans-memory

# observations; discovery-type rows are skipped by default
bun src/import-claude-mem-db.ts --dry-run
bun src/import-claude-mem-db.ts

# session summaries and historical prompts
bun src/import-claude-mem-extras.ts --dry-run
bun src/import-claude-mem-extras.ts
```

Flags: `--source`, `--db`, `--project`, `--include-discovery`, `--dry-run`.

To migrate a database created by an older version of this project:

```bash
bun src/migrate-legacy-db.ts --from /old/memory.db
```

## Security

- Data stays on this machine. No network calls, no telemetry.
- Notes are stored as written. There is no secret redaction for notes. Do not save tokens, passwords, or `.env` contents into a note.
- Prompts captured automatically are redacted for common secret patterns: OpenAI/GitHub/AWS/Google API keys, Slack/Discord webhooks, and `password=` / `token:` style assignments. Redaction is best effort, not a guarantee, so still avoid pasting secrets into chat.
- The database is readable by any process running as your user. Treat it like a notes file, not a vault.

## Troubleshooting

- `memory_stats` is missing after restart: check the `ENTRY` path in the loader and run the `bun -e` check above. OpenCode logs loader errors to `~/.local/share/opencode/log/opencode.log`.
- Plugin silently does nothing: the loader caught an import error, usually because the code lives on an unmounted drive. Mount it and restart.
- `Cannot use import statement outside a module`: create `~/.config/opencode/plugins/package.json` with `{"type":"module"}`.
- `database is locked`: another process is writing. Close extra agents or wait; the database uses WAL with a 5 second busy timeout.
- Permission denied on the database: files are `0600` and the directory `0700` by design. Run as the user that created it.

## Limitations

- Keyword search only, no embeddings.
- No automatic summarization. Notes exist only when the agent writes them.
- Context injection is a short index (8 titles), not full bodies.
- Project identity is the working-directory basename. Two unrelated repositories with the same folder name share notes unless you set `MEMORY_PROJECT`.
- Single user, single machine. No sync.
- SQLite is accessed by the plugin process and the MCP process. WAL mode plus a 5 second busy timeout handles that; heavy concurrent writes are not a design goal.

## Layout

```
src/db.ts                   schema, FTS5, migrations
src/repo.ts                 queries: sessions, prompts, observations, search
src/plugin.ts               OpenCode plugin: hooks and tools
src/mcp.ts                  MCP stdio server
src/cli.ts                  CLI for skill-based use
src/time.ts                 UTC to local formatting
src/redact.ts               secret redaction for captured prompts
src/rehash.ts               one-time hash migration
src/redact-prompts.ts       redact existing prompt rows
src/import-claude-mem-db.ts import observations from claude-mem
src/import-claude-mem-extras.ts import summaries and prompts
src/migrate-legacy-db.ts    copy an older beans-memory database
skills/beans-memory/        agent skill for the CLI
test/                       bun test: repo, edges, time, MCP, CLI, redaction
```

## Uninstall

1. Remove `~/.config/opencode/plugins/memory/`.
2. Remove the `beans_memory` entry from `opencode.json` if you added it.
3. Delete `~/.local/share/beans-memory/` if you do not want to keep the notes.
