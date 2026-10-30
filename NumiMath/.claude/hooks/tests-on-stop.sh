#!/usr/bin/env bash
# Stop: no deja terminar el turno si fallan los tests rápidos de lo que cambió.
input=$(cat)
[ "$(echo "$input" | jq -r '.stop_hook_active')" = "true" ] && exit 0

cd "$CLAUDE_PROJECT_DIR" || exit 0
changed=$(git status --porcelain 2>/dev/null | awk '{print $2}')
[ -z "$changed" ] && exit 0

fail=""

if echo "$changed" | grep -q '^api/' && [ -d api ] && command -v pytest >/dev/null 2>&1; then
  out=$(pytest -q api 2>&1) || fail="$fail\n[api] pytest falla:\n$(echo "$out" | tail -40)"
fi

if echo "$changed" | grep -q '^app/' && [ -f app/package.json ] && jq -e '.scripts["test:ci"]' app/package.json >/dev/null 2>&1; then
  out=$(npm --prefix app run test:ci --silent 2>&1) || fail="$fail\n[app] test:ci falla:\n$(echo "$out" | tail -40)"
fi

if [ -n "$fail" ]; then
  printf "Los tests fallan; corrige antes de terminar:%b\n" "$fail" >&2
  exit 2
fi
exit 0
