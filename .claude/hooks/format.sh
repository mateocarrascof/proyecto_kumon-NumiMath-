#!/usr/bin/env bash
# PostToolUse: formatea el archivo editado según su extensión.
f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] && exit 0
case "$f" in
  */app/*.ts|*/app/*.html|*/app/*.scss|*/app/*.json)
    (cd "$CLAUDE_PROJECT_DIR/app" 2>/dev/null && npx --no-install prettier --write "$f" >/dev/null 2>&1) ;;
  */api/*.py)
    ruff format "$f" >/dev/null 2>&1
    ruff check --fix "$f" >/dev/null 2>&1 ;;
esac
exit 0
