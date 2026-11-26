#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS="$HOME/.config/opencode/plugins"

if [ ! -d "$HOME/.config/opencode" ]; then
  echo "OpenCode config directory not found: ~/.config/opencode" >&2
  echo "Install OpenCode 2 first, then run this script again." >&2
  exit 1
fi

mkdir -p "$PLUGINS"

# Reuse an existing beans-memory loader instead of creating a second plugin
# instance with the same id.
LOADER=""
for candidate in "$PLUGINS"/*/index.ts "$PLUGINS"/*.ts; do
  [ -f "$candidate" ] || continue
  if grep -qE '(beans|agent)-memory/src/plugin\.ts' "$candidate" 2>/dev/null; then
    LOADER="$candidate"
    break
  fi
done
if [ -z "$LOADER" ]; then
  LOADER="$PLUGINS/beans-memory/index.ts"
  mkdir -p "$(dirname "$LOADER")"
fi

cat > "$LOADER" <<EOF
// Managed by beans-memory install.sh. Re-run the script if the code moves.
import { pathToFileURL } from "node:url";

const ENTRY = "$ROOT/src/plugin.ts";

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
EOF

echo "plugin loader : $LOADER"

BUN_BIN=""
if command -v bun >/dev/null 2>&1; then
  BUN_BIN="$(command -v bun)"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN_BIN="$HOME/.bun/bin/bun"
fi

if [ -n "$BUN_BIN" ]; then
  mkdir -p "$HOME/.local/bin"
  cat > "$HOME/.local/bin/beans-memory" <<EOF
#!/bin/sh
exec "$BUN_BIN" "$ROOT/src/cli.ts" "\$@"
EOF
  chmod +x "$HOME/.local/bin/beans-memory"
  echo "cli launcher  : $HOME/.local/bin/beans-memory"
else
  echo "cli launcher  : skipped (bun not found; plugin still works)"
fi

SKILL_DIR="$HOME/.claude/skills/beans-memory"
mkdir -p "$SKILL_DIR"
cp "$ROOT/skills/beans-memory/SKILL.md" "$SKILL_DIR/SKILL.md"
echo "agent skill   : $SKILL_DIR/SKILL.md"

cat <<'EOF'

Next steps:
  1. Restart OpenCode.
  2. Ask the agent: memory_stats
  3. On a fresh install it should answer with zero notes.
EOF
