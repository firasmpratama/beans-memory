# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.6] - 2026-11-28

### Security

- Redact imported prompts and session summaries before storing them.
- Scrub previously imported unsanitized prompts and summaries, including duplicate sanitized and raw rows.

### Fixed

- Continue importing after null prompt bodies, malformed rows, and invalid timestamps.
- Accept numeric and ISO timestamp values; reject empty, null, or invalid `createdAt` with a clear error.
- Prevent dry-run importers from creating a database.
- Ignore malformed session file payloads instead of throwing.
- Fall back to safe limits for non-finite and out-of-range limits.

### Tests

- Add coverage for every file in `src/`, including plugin hooks, CLI/MCP/importer entrypoints, rehash, prompt redaction, and artifact/schema validation.

### Documentation

- Remove the misleading coverage badge.
- Document OpenCode 2 or any stdio MCP client as supported.
- Document that Windows is implemented but not tested on a real Windows machine, with issue and pull request links.

## [0.1.5] - 2026-11-28

### Added

- `beans-memory install` with targets for OpenCode, Claude Code, Codex, Gemini CLI, and Hermes Agent.
- `beans-memory-mcp` binary.
- Windows-safe permission handling and cross-platform path support.

### Deprecated

- npm `0.1.5` is deprecated due to import and redaction bugs. Use `0.1.6` or newer.

## [0.1.4] - 2026-11-26

### Changed

- Branding update for the wordmark and icon. No functional changes.
