#!/usr/bin/env bash
# PostToolUse: recuerda actualizar el inventario de datos personales (Ley 21.719)
# cuando se tocan migraciones, esquemas, modelos o logging.
f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] && exit 0
if echo "$f" | grep -Eqi '(supabase/migrations|schema|models?/|entities/|\.sql$|logging|logger)'; then
  jq -n '{hookSpecificOutput:{hookEventName:"PostToolUse",
    additionalContext:"Se modificó un esquema, modelo o logging. Si agrega o cambia datos personales: actualiza docs/privacy/inventario-datos.md (finalidad, base de licitud, plazo de conservación, destinatarios), confirma que solo se guardan apodo y curso del alumno, que la tabla tiene RLS por tutor y que no se registran datos personales ni mensajes del niño en logs. Evalúa si requiere EIPD y usa el subagente privacy-cl-auditor."}}'
fi
exit 0
