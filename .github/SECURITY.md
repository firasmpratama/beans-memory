# Security Policy

## Supported versions

Only the latest commit on `main` receives security fixes.

## Reporting a vulnerability

Use GitHub private vulnerability reporting:

https://github.com/firasmpratama/beans-memory/security/advisories/new

Do not open a public issue for a vulnerability.

Please include:

- the affected commit or version
- steps to reproduce
- the impact (data exposure, code execution, denial of service)
- any suggested fix, if you have one

## Scope

This project stores prompts and notes in a local SQLite database and exposes them through an MCP server, an OpenCode plugin, and a CLI. Areas of interest:

- secret leakage in captured prompts or saved notes
- SQL or FTS5 query injection through search input
- path handling through the `--db` and `--files` arguments
- MCP JSON-RPC protocol handling
- unsafe defaults for database file permissions

## Data handling

- The database is local by default. No telemetry, no outbound network calls.
- Captured prompts are redacted for common secret patterns on a best-effort basis. Redaction is not a guarantee.
- Do not store credentials, tokens, or `.env` contents in notes.

## Response

This is a personal project maintained in spare time. Reports are handled on a best-effort basis, typically with an acknowledgement within 7 days. Please allow time for a fix before public disclosure.
