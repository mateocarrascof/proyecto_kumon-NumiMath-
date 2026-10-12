# Kit de arranque para Claude Code — App de matemáticas para niños

Contenido:
- `CLAUDE.md`: reglas del proyecto (stack Ionic + Supabase + FastAPI, privacidad, IA para niños).
- `.claude/settings.json`: permisos (deny para secretos y comandos destructivos), sandbox y hooks.
- `.claude/hooks/`: bloqueo de secretos, formato, tests al terminar, aviso de privacidad y alerta de SDKs de tracking.
- `.claude/agents/`: code-reviewer, scalability-reviewer, security-reviewer, privacy-cl-auditor, child-safety-ai-reviewer.
- `.claude/skills/ley-21719-compliance/`: skill de auditoría de la Ley 21.719 con checklist y plantilla de EIPD.
- `.mcp.json`: Context7, Playwright y Supabase (solo lectura, proyecto de desarrollo; reemplaza `project_ref`).
- `docs/privacy/inventario-datos.md`: inventario de datos precargado con el diseño del MVP.
- `.github/workflows/`: revisión de seguridad con IA y escáneres deterministas (secretos y dependencias).
- `INSTALACION-PROMPTS.md`: textos para pegar en Claude Code (instalar skills de GitHub, plugins, arrancar el proyecto).

Empieza por `INSTALACION-PROMPTS.md`.

Aviso: el skill y los agentes legales son apoyo técnico y no reemplazan la revisión de un abogado. Verifica el estado del Boletín 18.623‑07 (posible postergación de la Ley 21.719) y las políticas vigentes de Apple y Google antes de publicar.
