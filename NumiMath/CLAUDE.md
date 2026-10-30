# Proyecto: App de matemáticas para niños (1° a 4° básico, 6–10 años)

Mascota animada + IA tutora que explica matemáticas. Móvil (Android/iOS) y web.
Actores del MVP: Tutor (adulto, único con cuenta) y Alumno (perfil dependiente, sin registro propio).
Fase posterior: Profesor, reportes, gamificación. Administrador: gestión de usuarios y contenido.

## Stack y carpetas
- `app/`      Ionic + Angular, Capacitor (Android/iOS), Lottie o Rive para la mascota, KaTeX para fórmulas.
- `supabase/` PostgreSQL, Auth, Storage, políticas RLS por tutor. Migraciones en `supabase/migrations/`.
- `api/`      FastAPI: llama al modelo de IA, filtros de seguridad, límites de uso y costos, streaming.
- `docs/`     SPEC, ADRs y `docs/privacy/` (inventario de datos, EIPD).

## Comandos (ajustar al crear el proyecto)
- App: `npm --prefix app run lint` · `npm --prefix app run test:ci` · `npm --prefix app run build`
- API: `ruff check api && ruff format api` · `pytest -q api`
- DB: `supabase db reset` · `supabase test db` (pgTAP, incluye tests de RLS)

## Reglas inamovibles (privacidad, seguridad, niños)
- IMPORTANT: solo el tutor tiene cuenta en Supabase Auth. El alumno es una fila en `students` sin credenciales ni email.
- IMPORTANT: del alumno solo se guarda apodo y curso. Nunca apellidos, fotos, ubicación, fecha de nacimiento, voz ni identificadores de dispositivo con fines de perfilado.
- IMPORTANT: ningún dato personal del niño llega al modelo de IA. El prompt lleva solo curso, tema y ejercicio. El texto libre que escriba el niño se filtra (PII, groserías, temas fuera de matemáticas) antes de enviarse.
- IMPORTANT: la app nunca llama a la IA directamente. Todo pasa por FastAPI. Las claves viven solo en variables de entorno del servidor.
- IMPORTANT: toda tabla nueva con RLS activada y política por tutor, y un test de RLS que pruebe que otro tutor no puede leer ni escribir.
- IMPORTANT: sin SDK de publicidad ni analítica de terceros en la app (Apple Kids Category y Google Families Policy). Antes de agregar cualquier dependencia nueva a `app/`, preguntar.
- Sin contenido de conversaciones ni datos personales en logs, errores ni herramientas de monitoreo.
- Consentimiento: guardar `tutor_id`, versión de términos, versión de política de privacidad y fecha-hora UTC. Re-pedirlo si cambia la versión.
- Zona de tutor protegida con control parental (PIN o pregunta de adulto) antes de ajustes, compras y enlaces externos.
- Las respuestas de IA se validan también a la salida: solo matemáticas, lenguaje apto para 6–10 años, sin pedir datos al niño.

## Flujo de trabajo
- Tareas no triviales (3+ archivos, auth, RLS, consentimiento, IA, migraciones): plan mode primero.
- Features grandes: entrevistarme y escribir `docs/SPEC.md` antes de codificar.
- Siempre verificar: correr tests/lint/typecheck y mostrar la salida como evidencia.
- Antes de abrir PR, correr los subagentes: `code-reviewer`, `security-reviewer` y `scalability-reviewer`.
  Si el cambio toca datos personales, consentimiento, perfiles o logs: `privacy-cl-auditor`.
  Si toca prompts, filtros de IA, SDKs o la UI infantil: `child-safety-ai-reviewer`.
- Cada migración que agregue o cambie datos personales actualiza `docs/privacy/inventario-datos.md`.
- Ramas `feat/…`, `fix/…`. Commits convencionales. Nunca commitear `.env`.

## Arquitectura (decisiones que no se ven en el código)
- RLS por tutor es la frontera de seguridad principal; FastAPI valida el JWT de Supabase y comprueba que el alumno pertenezca al tutor.
- Streaming de respuestas de IA con límites por perfil y por día, y tope de costo por tutor.
- Catálogo curricular (habilidades, niveles, prerrequisitos y OA de 1° a 4°): definido en `docs/MAPA_CURRICULAR_MATEMATICA_1A4.md` y `docs/habilidades_1a4_basico.csv`. No inventar códigos de habilidad ni de objetivos de aprendizaje (OA); usar solo los de esos archivos.
- Contenido pedagógico propio o con licencia (Ley 17.336). Registrar la autoría de mascota, ilustraciones y voces.

## Contexto legal (apoyo técnico, no asesoría legal)
Ley 21.719 (vigencia legal 1‑dic‑2026; hay un proyecto que propone postergarla a 2027: verificar estado), Ley 19.628 (vigente mientras tanto),
Ley 21.430 (niñez), Ley 19.496 (consumidores), Ley 21.459 (delitos informáticos), Ley 17.336 (propiedad intelectual), Ley 21.663 (ciberseguridad, referencia).
Usar el skill `ley-21719-compliance`.

## Al compactar
Conservar: archivos modificados, comandos de test, decisiones pendientes y hallazgos abiertos de los subagentes.
