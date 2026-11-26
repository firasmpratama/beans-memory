# Memory instructions

Paste this block into the agent instruction file:

- Claude Code: `CLAUDE.md`
- Codex: `AGENTS.md`
- Gemini CLI: `GEMINI.md`
- OpenCode: `AGENTS.md`

---

## Project memory

Memories live in a local SQLite database, shared by every agent on this machine.

- Before starting work that may have been done before, call `memory_search` with a few keywords. Then call `memory_get` only for the ids that matter.
- After a task that produced a decision, a non-obvious bugfix, or wiring that is hard to rediscover, call `memory_note` with a short title and a body covering: what changed, why, and the files involved.
- Do not save secrets, tokens, passwords, or `.env` contents into a note.
- Keep notes short. One fact per note is easier to find than one long summary.
