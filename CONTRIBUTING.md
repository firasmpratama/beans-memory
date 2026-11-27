# Contributing

Thanks for taking the time to improve beans-memory. Keep changes small, tested, and easy to review.

## Requirements

- Bun 1.2 or newer
- macOS, Linux, or Windows. Windows is implemented but not tested on a real Windows machine yet.

## Setup

```bash
git clone https://github.com/firasmpratama/beans-memory
cd beans-memory
bun install
```

## Checks

Run these before opening a pull request:

```bash
bun test
bun run typecheck
```

`bun run test:coverage` shows in-process coverage. Coverage does not include files exercised only through child processes, so use it as a guide, not as proof of full coverage.

## Tests

- Every file in `src/` must have at least one test that executes it.
- Cover the failure mode, not only the happy path: null, empty, invalid types, malformed persisted data, boundaries, duplicate replay, and partial failure.
- Do not weaken or delete an existing assertion to make the suite pass.
- If a test exposes a production bug, report the bug and keep the reproduction.

## Pull requests

- Open an issue first for large behavior changes or new integrations.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Describe what changed and why, not only which files changed.
- State which platform and client you tested: OpenCode, Claude Code, Codex, Gemini CLI, Hermes, or CLI only.
- Update the README and CHANGELOG when behavior changes.
- Do not include secrets, tokens, `.env` contents, or real credentials in code, tests, logs, or screenshots.

## Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/firasmpratama/beans-memory/security/advisories/new). Do not open a public issue for a vulnerability.
