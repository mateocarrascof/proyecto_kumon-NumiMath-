#!/usr/bin/env bash
# PreToolUse: bloquea acceso a archivos de secretos (exit 2 = bloquear).
input=$(cat)
target=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.command // ""')
if echo "$target" | grep -Eq '(\.env($|\.)|\.pem|\.key|id_rsa|credentials|secrets/)'; then
  # Permite plantillas de ejemplo versionadas
  if echo "$target" | grep -Eq '\.env\.(example|sample)'; then
    exit 0
  fi
  echo "Bloqueado: acceso a archivo de secretos ($target). Usa variables de entorno documentadas en .env.example." >&2
  exit 2
fi
exit 0
