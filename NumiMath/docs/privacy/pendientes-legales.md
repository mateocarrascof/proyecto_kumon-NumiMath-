# Pendientes legales — preguntas para el abogado o el delegado de protección de datos

**Apoyo técnico, no asesoría legal.** Este archivo reúne **todas** las preguntas legales abiertas del proyecto en un solo lugar y las ordena por importancia. Las respuestas de Legal deben quedar registradas aquí (columna "Respuesta") y trasladarse al inventario, al ADR y a la EIPD.

**Actualizado:** 2026-10-12 · **Fuentes consolidadas:** `docs/lote-2-propuesta-consentimiento.md` (12 preguntas), `docs/privacy/eipd/eipd-borrador.md` (sección 8.1), `docs/adr/0001-contrato-fastapi-consentimiento.md`, y las auditorías de privacidad de los Lotes 2, A y B.

## Cómo leerlo

| Prioridad | Significa |
|---|---|
| **P1 — Bloquea el lanzamiento** | Sin respuesta, no se debería publicar la app ni tratar datos reales de niños. |
| **P2 — Antes del lanzamiento** | Hay una solución provisional; debe confirmarse o cambiarse antes de salir. |
| **P3 — Después, con fecha** | No bloquea, pero hay que resolverlo en un plazo razonable. |

Las referencias a artículos de la Ley 21.719 y de las demás leyes están **sin verificar** contra el texto oficial; la columna "Estado actual" describe qué hace hoy el sistema para que Legal pueda juzgarlo.

## Valores provisionales hoy en el sistema (resumen)

| Parámetro | Valor | Estado | Dónde se cambia |
|---|---|---|---|
| Conservación de la evidencia de consentimiento y declaraciones archivadas | **Sin plazo** (nada se purga) | Pendiente legal; genera alerta | `app_settings.consent_evidence_retention_days` |
| Perfiles bloqueados por revocación | **30 días** y luego se suprimen | Provisional; genera alerta | `blocked_profile_retention_days` / `_confirmed` |
| Perfiles inactivos | **12 meses** y luego se suprimen | Provisional; genera alerta | `inactive_profile_retention_days` / `_confirmed` |
| Altas de perfiles por tutor | 10 cada 24 h | Producto | `student_creations_per_day` |
| Aceptaciones de consentimiento por tutor | 10 cada 24 h (las revocaciones nunca se limitan) | Técnico | en la función `consents_before_insert` |
| Perfiles por tutor | 5 (los bloqueados cuentan) | Producto | `tutors.max_students` |
| Fechas de la evidencia | Fecha-hora exacta | Decisión técnica; revisar | — |
| Proveedor de IA | Gemini, **solo prototipo operado por adultos** (términos 18+; ver 9.1) | Condición legal sin resolver para publicar | `AI_PROVIDER` y `GEMINI_MODEL` |

---

# P1 — Bloquean el lanzamiento

## 1. Conservar evidencia del consentimiento después de borrar la cuenta
**Pregunta.** Cuando el tutor borra su cuenta, ¿procede conservar evidencia mínima seudonimizada de que consintió (versión de términos y política, huella del texto, canal, fecha-hora)? ¿Con qué base de licitud, **por cuánto tiempo** y **desde cuándo corre el plazo**?
**Por qué importa.** La carga de la prueba del consentimiento es del responsable (art. 12, verificar); pero conservar datos tras la supresión choca con la minimización y la limitación de la conservación.
**Estado actual.** Se conserva en `consent_evidence`, sin plazo definido (no se purga nada), inmutable, con alerta activa. El plazo se calcula al purgar.
**Qué cambia según la respuesta.** Si no procede: se elimina la conservación y se entrega al tutor un comprobante. Si procede: se fija el plazo (`consent_evidence_retention_days`) y su fecha de inicio.
**Respuesta:** _pendiente_

## 2. Derechos del titular sobre la evidencia ya archivada
**Pregunta.** Si la persona, después de borrar su cuenta, pide **acceso, rectificación, supresión u oposición** sobre esa evidencia: ¿cómo se responde, con qué base se puede negar (si es el caso) y durante cuánto tiempo? La tabla es inmutable por diseño.
**Por qué importa.** Condición para que la decisión de inmutabilidad sea defendible.
**Estado actual.** Acceso tras el borrado: **ya no es posible localizar la evidencia por el correo** (se eliminó esa huella, ver 27); solo por el seudónimo del tutor, que requiere el id. Procedimiento por definir. No existe borrado selectivo: solo se purga por vencimiento.
**Qué cambia.** Podría requerir una función de borrado selectivo de evidencia (hoy descartada) y un procedimiento documentado.
**Respuesta:** _pendiente_

## 3. HMAC del correo y del id del tutor: proporcionalidad y reidentificación
**Preguntas.**
1. ¿Se justifica guardar **dos** identificadores seudonimizados (`tutor_ref` del id y `tutor_email_ref` del correo) frente a la minimización? ¿Basta uno?
2. ¿Es aceptable que, si alguien se registra de nuevo con el mismo correo, la evidencia antigua quede vinculable con la cuenta nueva?
3. ¿Se considera dato personal seudonimizado mientras exista la clave? ¿**Destruir una versión de la clave** equivale a anonimizar (y a perder el valor probatorio)? ¿Qué política de claves se espera?
4. La evidencia se puede reidentificar **sin la clave** mientras existan backups o logs con la tabla `consents` (el orden y la fecha coinciden). ¿Es aceptable? ¿Hay que reducir la precisión de las fechas (ver pregunta 17)?
**Estado actual.** Solo se guarda `tutor_ref` (HMAC del id): `tutor_email_ref` se eliminó el 2026-11-11 (ver 27). La clave vive fuera de la base, versionada; custodio y rotación sin asignar.
**Qué cambia.** Separar dominios del HMAC; separar dominios del HMAC; truncar fechas; fijar la política de claves.
**Respuesta:** _pendiente_

## 4. Alcance y forma del consentimiento
**Preguntas.**
1. ¿Basta **un consentimiento por cuenta de tutor** sobre una versión concreta, con una declaración del adulto por perfil, o se exige un consentimiento **específico por cada niño**?
2. ¿El consentimiento para tratar datos del menor y para usar la IA debe **registrarse aparte** de la aceptación de los términos generales (finalidades separadas)?
3. ¿Qué evidencia mínima debe guardarse además (¿dirección IP?, hoy **no** se guarda por minimización)?
**Estado actual.** Un evento `grant` junta términos y política; la declaración del adulto es por perfil; no hay consentimiento separado para IA.
**Qué cambia.** Agregar un tipo de consentimiento por finalidad (`child_data_consent`, `ai_use`) o uno por perfil.
**Respuesta:** _pendiente_

## 5. Declaración del adulto responsable
**Preguntas.**
1. ¿Qué **texto** debe tener y qué **nivel de verificación** se exige de que quien crea el perfil es el padre, la madre o el representante legal? ¿Basta una declaración o hace falta un mecanismo reforzado?
2. Al **reactivar** un perfil bloqueado, ¿basta el consentimiento de cuenta vigente o hay que repetir la declaración?
3. ¿La prueba debe vincular la declaración con el consentimiento vigente **cuando se hizo** (el original) o con el vigente al borrar el perfil? ¿Debe conservarse tras borrar el perfil o la cuenta, y con qué plazo y desde cuándo corre?
**Estado actual.** Casilla aceptada al crear el perfil (versión del texto y fecha); se archiva al borrar el perfil, ligada al consentimiento **original**; no se repite al reactivar.
**Qué cambia.** Exigir nueva declaración al desbloquear; cambiar el plazo de `declaration_evidence`.
**Respuesta:** _pendiente_

## 6. Retiro del consentimiento: efecto y plazo
**Preguntas.**
1. ¿Retirar el consentimiento debe ser **tan simple como otorgarlo**? ¿Dónde debe estar disponible?
2. Al revocar, ¿corresponde **bloquear o suprimir** los datos del niño y en qué plazo?
3. ¿Hay que **avisar al tutor antes** de suprimir? ¿Con qué antelación? ¿Hay que informar también al niño en lenguaje adecuado a su autonomía progresiva (Ley 21.430)?
**Estado actual.** La revocación bloquea todos los perfiles de inmediato; la supresión ocurre a los 30 días (provisional), con aviso previo previsto pero sin enviar aún. Las revocaciones nunca se frenan.
**Qué cambia.** Plazo de bloqueo, supresión inmediata, contenido y momento del aviso.
**Respuesta:** _pendiente_

## 7. Vigencia de la ley aplicable
**Pregunta.** La Ley 21.719 entra en vigencia el 1-dic-2026; el Boletín 18.623-07 propone postergarla al 1-dic-2027. ¿En qué estado está y qué exigencias de la **Ley 19.628** y de la **Ley 21.430** se aplican mientras tanto al consentimiento de representantes de menores?
**Estado actual.** El diseño apunta a cumplir ambas.
**Qué cambia.** El calendario de lanzamiento y qué obligaciones son exigibles desde el día uno.
**Respuesta:** _pendiente_

## 8. Copias de seguridad y restauración
**Preguntas.**
1. ¿Basta declarar que la supresión llega a los backups cuando estos vencen? ¿Qué **plazo máximo de retención** es aceptable para datos de menores?
2. Restaurar un backup puede **revivir perfiles ya suprimidos** y cuentas borradas: ¿es aceptable mantener un registro de supresiones (solo identificadores, sin apodo ni curso) que se reaplique tras cada restauración?
**Estado actual.** Plazo, región y proveedor de backups sin definir; sin registro de supresiones ni runbook de restauración.
**Qué cambia.** Plan de Supabase y retención; nueva tabla de supresiones y runbook.
**Respuesta:** _pendiente_

## 9. Transferencias internacionales y proveedores
**Pregunta.** ¿Qué garantías, contratos y acuerdos de tratamiento (DPA) se exigen para **Supabase**, el **proveedor de IA** y el **hosting de FastAPI**, según la región o el país que se elija? ¿Hay que confirmar contractualmente que no retienen ni entrenan con los datos?
**Estado actual.** Región y país sin decidir (`<región>` en el inventario); DPA y garantías "pendiente".
**Qué cambia.** Elección de región; cláusulas contractuales; ADR de región.
**Respuesta:** _pendiente_

## 9.1 Términos de uso de la API de Gemini con menores (proveedor de IA del prototipo)
**Fuente exacta consultada:** [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) (https://ai.google.dev/gemini-api/terms), con la nota "Last updated 2026-04-28 UTC" y vigencia indicada desde el 23-mar-2026. Secciones: *Age Requirements*, *Unpaid Services > How Google Uses Your Data* y *Paid Services > How Google Uses Your Data*. Léelas tú directamente: aquí hay un resumen, no una cita legal.

**Qué dicen (resumen):**
1. **Edad:** hay que tener 18 años o más para usar las APIs.
2. **Apps dirigidas a menores:** no se pueden usar los servicios dentro de una app o servicio **dirigido a, o con probabilidad de ser usado por, menores de 18 años**.
3. **Nivel gratuito (unpaid):** Google puede usar lo que se envía y las respuestas para mejorar sus productos y tecnologías de aprendizaje automático, y **revisores humanos pueden leer** entradas y salidas (se desvinculan antes de la cuenta, la llave y el proyecto). Los términos desaconsejan enviar información sensible o personal.
4. **Nivel de pago (paid):** Google indica que no usa las entradas ni respuestas para mejorar sus productos; las registra por un tiempo limitado para detectar abusos y cumplir obligaciones legales, bajo su adenda de tratamiento de datos.

**Por qué importa:** esta app **está dirigida a niños de 6 a 10 años**, así que, leyendo los términos tal como están, **usar la API de Gemini en la app para niños no cumple el punto 2**, aunque el texto enviado sea solo un ejercicio de matemáticas.

**Estado actual:** decisión del usuario (2026-10-15): usar Gemini **solo como prototipo operado por adultos** para la demostración, sin niños reales ni datos personales, con la IA detrás de una interfaz reemplazable. **Esto NO resuelve la condición para publicar.**

**Preguntas para Legal / para Google:**
1. ¿Se puede usar la API de Gemini (o Vertex AI, con otros términos) en una app dirigida a menores? ¿Existe un acuerdo o una excepción por escrito?
2. Si no, ¿qué proveedor o modelo alternativo se usa? (Hay que reemplazar el proveedor antes del lanzamiento.)
3. Aun en un prototipo operado por adultos, ¿es aceptable el nivel gratuito (uso para mejorar productos y revisión humana) con textos de ejercicios escritos por un adulto que simula a un niño?

**Qué cambia según la respuesta:** el proveedor de IA y su configuración (`AI_PROVIDER`, `GEMINI_MODEL`), el inventario (transferencia internacional y retención del proveedor), la EIPD (riesgo R14) y el texto de la política de privacidad.
**Respuesta:** _pendiente_

---

# P2 — Antes del lanzamiento

## 10. Plazo máximo de perfiles bloqueados
**Preguntas.**
1. ¿Cuánto tiempo pueden mantenerse bloqueados los datos del menor antes de suprimirlos? (Hoy **30 días, provisional**.)
2. Un perfil bloqueado **a petición del tutor** o por un **reclamo ARCOP**, ¿debe quedar fuera de la purga automática (como hoy) y por cuánto tiempo puede mantenerse?
3. El **bloqueo temporal** ante una solicitud, ¿qué plazo exige (el checklist menciona 2 días hábiles; verificar)?
**Estado actual.** Solo se purgan los bloqueados por revocación; los bloqueados por `tutor_request` y `arcop_claim` se conservan sin plazo.
**Qué cambia.** `blocked_profile_retention_days`; plazos y cierre de bloqueos por reclamo.
**Respuesta:** _pendiente_

## 11. Plazo por inactividad
**Preguntas.** ¿Qué plazo corresponde para **perfiles** y **cuentas** sin uso (hoy **12 meses, provisional**)? ¿Hay que avisar antes de suprimir y con qué antelación?
**Estado actual.** Purga programada para perfiles sin uso; las cuentas inactivas se listan y FastAPI las elimina con el flujo del ADR 0001.
**Qué cambia.** `inactive_profile_retention_days`; contenido y momento del aviso.
**Respuesta:** _pendiente_

## 12. Cambio de versión de términos o política
**Pregunta.** Cuando cambian los términos o la política, ¿hay que **bloquear el servicio** hasta que se re-acepte, o se puede seguir con el consentimiento anterior mientras no cambie la finalidad? ¿Los perfiles existentes siguen usables?
**Estado actual.** Al cambiar la versión vigente, no se pueden crear perfiles ni usar la IA hasta aceptar la nueva (decisión del usuario).
**Qué cambia.** Distinguir cambios menores de cambios de finalidad; gracia para perfiles existentes.
**Respuesta:** _pendiente_

## 13. Decisiones automatizadas y perfilamiento
**Pregunta.** La **adaptación de dificultad** de la IA, ¿es perfilamiento o decisión automatizada con efectos significativos (art. 8 bis, verificar)? ¿Qué obligaciones trae (explicación, intervención humana, oposición)?
**Estado actual.** La adaptación no excluye ni sanciona al niño; sin explicación formal al tutor.
**Qué cambia.** Texto informativo, opción de desactivar la adaptación.
**Respuesta:** _pendiente_

## 14. Evaluación de impacto (EIPD)
**Pregunta.** ¿Es **obligatoria** para este tratamiento (menores de 14 años, IA, perfilamiento posible)? ¿Con qué contenido mínimo, quién la aprueba y cada cuánto se revisa?
**Estado actual.** Borrador técnico en `docs/privacy/eipd/eipd-borrador.md`.
**Qué cambia.** Completar y aprobar la EIPD antes de lanzar.
**Respuesta:** _pendiente_

## 15. Rectificación en un perfil bloqueado
**Pregunta.** Se permite corregir apodo y curso aunque el perfil esté bloqueado (la rectificación no reanuda el tratamiento). ¿Es correcto o debe negarse mientras dure el bloqueo?
**Estado actual.** Permitida.
**Respuesta:** _pendiente_

## 16. Precisión de las fechas de la evidencia
**Pregunta.** En `occurred_at`, `declared_at` y `archived_at` hoy se guarda la fecha-hora exacta. ¿Basta el **día** para acreditar el consentimiento? (Menor precisión reduce el riesgo de reidentificación y también el valor probatorio.)
**Estado actual.** Fecha-hora exacta (decisión del usuario "por ahora").
**Respuesta:** _pendiente_

## 17. Registro de los motivos de supresión
**Pregunta.** ¿Hay que dejar constancia del **motivo** de cada supresión de perfil (purga automática, petición del tutor, borrado de cuenta) para demostrar que se cumplió?
**Estado actual.** No se registra el motivo; el historial de estados se borra con el perfil.
**Qué cambia.** Columna `deletion_reason` en la evidencia de declaración.
**Respuesta:** _pendiente_

## 18. Borrado de cuenta sin evidencia archivada
**Pregunta (con decisión técnica).** Hoy un borrado de cuenta por un canal distinto de FastAPI (panel de Supabase, Admin API) **no deja evidencia**. Si Legal considera que la evidencia es obligatoria, la base debería **impedir** ese borrado.
**Estado actual.** Decisión del usuario: no impedirlo por ahora; el borrado pasa solo por FastAPI. **Pendiente antes de lanzar.**
**Qué cambia.** Trigger que exija evidencia archivada, o una alerta de integración.
**Respuesta:** _pendiente_

---

## 23. Qué pasa con los intentos de práctica (`student_attempts`) cuando se borra un perfil
**Hoy (técnico, sin decidir):** cada intento (tema, enunciado generado por código, si fue correcto, fecha-hora, perfil y tutor) se borra **en cascada** al borrar el perfil o la cuenta. No se conserva nada, ni siquiera agregados. Es el comportamiento por defecto de la migración `20261015120000_student_attempts`, **no una decisión legal**.

**Preguntas:**
1. ¿Está bien borrar todo junto con el perfil (minimización), o hay un motivo para conservar algo (por ejemplo, estadísticas agregadas anónimas para mejorar los ejercicios)?
2. Si se conservan agregados, ¿cuándo dejan de ser datos personales? Un conteo por tema y curso, sin fechas ni perfil, ¿se considera anónimo con tan pocos perfiles?
3. ¿Los intentos de un perfil **bloqueado** deben seguir visibles para el tutor mientras dura el bloqueo?
4. Al purgar por inactividad (12 meses provisionales) o por bloqueo (30 días provisionales), ¿se aplica el mismo tratamiento?

**Qué cambia según la respuesta:** la clave foránea de `student_attempts` (cascada u otro), una tabla de agregados y su purga, el inventario de datos y la EIPD.
**Respuesta:** _pendiente_

---

## 24. Camino de apoyo cuando un niño parece angustiado o en peligro (PENDIENTE DE VALIDACIÓN PROFESIONAL)
**Qué hace hoy (provisional):** si el texto del niño contiene frases de angustia, daño o maltrato (por ejemplo "me quiero morir", "me pegan", "estoy muy triste"), el servidor **no lo envía a la IA, no gasta cuota y no lo guarda ni lo registra**, y responde con un mensaje fijo que lo orienta a hablar con un adulto de confianza. Va **antes** de los filtros de groserías y datos personales. Las frases están en `SUPPORT_PATTERNS` (`api/app/safety/patterns.py`) y el mensaje en `SUPPORT_MESSAGE` (`api/app/safety/input_filter.py`), ambos marcados como pendientes.

**Qué NO hace (a propósito):** no avisa al tutor, no deriva a ningún teléfono ni servicio, no conserva el mensaje. El mensaje **no incluye números de ayuda** porque no los verifiqué.

**Preguntas para una persona con formación en psicología infantil y protección de la niñez (y para Legal):**
1. ¿El texto del mensaje es adecuado para niños de 6 a 10 años? ¿Qué debe decir y qué no?
2. ¿Qué frases deben activarlo y cuáles no? Hoy es conservador: puede activarse con "estoy triste" aunque sea un día malo, y no detecta todo (limitación conocida).
3. ¿Debe avisarse al tutor? ¿Cómo, sin guardar el contenido del mensaje? ¿Hay deber legal de reportar ante sospecha de maltrato o abuso (Ley 21.430)?
4. ¿Qué líneas de ayuda en Chile deben mostrarse (verificar vigencia y números con la fuente oficial)?
5. ¿Se debe registrar solo que "hubo una alerta" (sin texto) para poder auditar? ¿Con qué plazo?

**Qué cambia según la respuesta:** el texto del mensaje, la lista de frases, un posible aviso al tutor, el inventario de datos y la EIPD.
**Respuesta:** _pendiente_

---

## 25. Recuperar contraseña: proveedor de correo, registros y enumeración de cuentas (T19)
**Qué hace hoy:** el tutor pide un enlace por correo; la pantalla muestra SIEMPRE el mismo mensaje, exista o no la cuenta. El enlace (30 minutos, un solo uso) abre la app y el código solo se canjea al pulsar un botón. Al cambiar la contraseña se cierran las sesiones en todos los dispositivos y se envía un aviso. No se guarda ni se trata ningún dato del niño.

**Qué NO está resuelto:**
1. **Enumeración de cuentas por el límite de Supabase.** Quien llame directo a `/auth/v1/recover` con la llave anon (pública) y pida dos veces seguidas el mismo correo recibe 429 si tiene cuenta y 200 si no. La app no lo muestra, pero el endpoint es público. Mitigación pendiente para producción: captcha de Supabase o un proxy por la API con límite por IP y respuesta uniforme. Hay una prueba que documenta esta limitación a propósito.
2. **Proveedor de correo (SMTP):** ¿cuál, en qué país, con qué DPA y retención de registros de envío? ¿Se desactiva el seguimiento de clics?
3. **Registro de auditoría de Auth** (`auth.audit_log_entries`: correo, evento, IP): ¿plazo de conservación? ¿se borra con la cuenta?
4. **Aviso de cambio de contraseña:** ¿base de licitud (contrato o interés legítimo de seguridad)? ¿debe constar en la política de privacidad?
5. **Producción:** `site_url`, redirecciones permitidas y `email_sent` (tope global por hora) de `supabase/config.toml` están configurados para localhost; hay que fijarlos al dominio real antes de publicar. En la app nativa (Capacitor) el enlace necesitará un deep link propio.
**Respuesta:** _pendiente_

---

## 26. Eliminar la cuenta (T21): lo que se conserva y los registros que no controlamos
**Qué hace hoy:** borra de verdad la cuenta y todos sus datos (ver SPEC), tras confirmar con la contraseña (el PIN no vale) y la palabra ELIMINAR. Conserva solo la evidencia mínima del consentimiento (seudónimo del tutor, versiones, fechas, canal) y la declaración del adulto sin apodo ni curso. Purga el registro de auditoría de Auth (correo e IP).

**Preguntas:**
1. **Plazo de conservación de la evidencia:** ver 27 (5 años provisional).
2. **Registros que quedan fuera de la base:** copias de seguridad, registros de la plataforma y correos ya enviados (recuperación de contraseña, avisos). ¿Qué plazo y qué se informa al titular?
3. **Purga del registro de auditoría de Auth:** se borra el correo y la IP del tutor tras eliminar la cuenta. ¿Hay un deber de conservar registros de seguridad por algún plazo?
4. **Revocación irreversible:** al empezar el borrado se registra una revocación (bloquea los perfiles) que no se deshace aunque el borrado falle a medias. ¿Es aceptable?
5. **Constancia del borrado:** hoy solo queda un evento sin datos personales en los registros del servidor. ¿Se debe poder acreditar al titular que se borró y cuándo? ¿Cómo, sin guardar identificadores?
**Respuesta:** _pendiente_

## 27. Plazo de conservación de la evidencia mínima de consentimiento (T21)

**Estado: PROVISIONAL, SUJETO A VALIDACIÓN LEGAL.** La Ley 21.719 no fija un plazo. Base invocada: art. 7 (excepciones por obligación legal y por defensa de reclamaciones). Se eligieron **5 años** por la prescripción general de las acciones civiles (**inferencia a validar**, no una regla verificada).

**Qué se conserva y cuánto.** Solo el seudónimo del tutor (HMAC-SHA256 del id, con una clave que vive fuera de la base), la versión y la huella de los textos aceptados, el tipo de evento, el canal y las fechas; más la declaración del adulto sin apodo ni curso. **Sin correo, sin nombre y sin datos del niño** (se eliminó `tutor_email_ref`, la huella del correo que antes se guardaba).

**Cómo se aplica.**
- Constante configurable: `app_settings.consent_evidence_retention_days` = **1826** (5 años; cubre un día bisiesto, nunca menos). Cambiarla no requiere desplegar código.
- Cuenta desde `archived_at` (el día en que se borró la cuenta) y se lee **al purgar**, así que un cambio de plazo alcanza también a lo ya archivado.
- Tarea de pg_cron `privacy-purge-evidence` (a diario, 03:10 UTC) que ejecuta `purge_expired_consent_evidence()`. Probada en `supabase/tests/database/evidence_retention.test.sql`. Si el job no corre, `privacy_job_warnings()` lo avisa.
- Mientras Legal no lo valide (`consent_evidence_retention_confirmed` = false), `privacy_config_warnings()` emite una alerta de valor provisional.

**Preguntas:**
1. ¿Se confirma el plazo de 5 años y su base (art. 7 y prescripción de acciones civiles)? ¿Cuenta desde el borrado de la cuenta o desde el último evento de consentimiento?
2. Sin la huella del correo ya **no se puede localizar la evidencia a partir del correo** de la persona (derecho de acceso tras el borrado). ¿Es aceptable, o se prefiere un medio distinto de localización?
3. Al vencer el plazo la evidencia se borra definitivamente; los respaldos de la base pueden conservarla más tiempo (ver 26, pregunta 2).
**Respuesta:** _pendiente_

## 28. Revocar el consentimiento (T20): reactivación y constancia

**Qué hace hoy:** el tutor revoca desde el panel (con el PIN); los perfiles quedan bloqueados al instante, sin práctica, informes ni IA; los datos se conservan bloqueados 30 días (provisional, ver 10) y luego se borran; queda un evento con fecha en `consents`. Ver SPEC.

**Preguntas:**
1. **Reactivación:** hoy volver a aceptar los términos **no** reactiva los perfiles bloqueados (no existe un camino en la app hacia `unblock_student`). ¿Debe poder reactivarlos el tutor dentro del plazo (con una nueva aceptación expresa), o el retiro es definitivo para esos perfiles?
2. **Constancia visible:** la fecha de la revocación se muestra una vez. ¿Hay que poder consultarla después (derecho de acceso) y por cuánto tiempo?
3. **IA en curso:** una explicación ya iniciada se corta en el siguiente re-chequeo (segundos), no al instante. ¿Es aceptable?
4. **Quién revoca:** se exige el PIN, que lo puede conocer un niño. ¿Basta, o la revocación (derecho del titular) debe poder hacerse sin PIN, por ejemplo con la contraseña?
5. **Bloqueos previos:** los perfiles que ya estaban bloqueados (`tutor_request`, `arcop_claim`) no se purgan al revocar, así que pueden quedar guardados sin plazo y sin consentimiento. ¿Se purgan con el mismo plazo, o con otro?
6. **Borrar un solo perfil sin consentimiento:** la API lo permite, pero la interfaz solo ofrece eliminar la cuenta entera tras revocar. ¿Hay que ofrecer el borrado por perfil en `/terminos`?
**Respuesta:** _pendiente_
---

# P3 — Después, con fecha

## 29. Modo sin conexión (CU-A12): datos en el dispositivo y revocación sin red
**Contexto.** Para practicar sin internet, la app guarda en el teléfono o la tablet, sin cifrar, el
apodo y el curso de cada perfil, un lote de ejercicios y las respuestas hechas sin conexión (ADR
0002; EIPD R41 y R42). Si el tutor revoca, pausa o borra desde otro equipo, un dispositivo sin red
sigue permitiendo practicar hasta conectarse o hasta que pasen 7 días. Los datos vencidos dejan de
usarse a los 7 días y se borran la próxima vez que se abre la app.
**Preguntas.**
1. ¿Es aceptable que, tras revocar el consentimiento, el tratamiento local (práctica sin red) siga
   hasta 7 días, si está informado de antemano en la política y en la pantalla de revocación?
2. ¿Basta con que los datos queden inaccesibles a los 7 días y se borren la próxima vez que se abre
   la app, o hay que garantizar el borrado en un plazo fijo aunque la app no se abra (lo que
   técnicamente no es posible)?
3. ¿Guardar apodo, curso y respuestas del niño sin cifrar en el dispositivo del tutor es una medida
   de seguridad suficiente? ¿La Ley 21.719 o la Ley 21.430 exigen cifrarlos?
4. Cambiar la versión de la política borra en cada equipo los intentos hechos sin conexión que aún
   no se enviaron. ¿Tiene esto alguna implicancia frente al tutor?
5. (CU-A13) Si el tutor pausa un perfil y lo reactiva antes de que un equipo sin internet se
   conecte, los intentos hechos durante la pausa se guardan al sincronizar. ¿Es aceptable? ¿Y si en
   el futuro se permite reactivar tras revocar el consentimiento?
6. (CU-A13) En los intentos hechos sin conexión, la hora y la duración las informa el dispositivo
   y el servidor solo las acota a la vida del ejercicio. ¿Basta para el principio de exactitud, o
   hay que marcar esos intentos como "sin conexión" ante el tutor?
**Estado actual.** Decisión 8 del ADR 0002 aceptada para esta etapa, pendiente de revisión.
**Respuesta:** _pendiente_

## 19. Información al niño (Ley 21.430)
**Pregunta.** ¿Corresponde informar al niño, en lenguaje adecuado a su autonomía progresiva, de que su perfil fue bloqueado o suprimido?
**Estado actual.** Solo se notifica al tutor (a futuro).
**Respuesta:** _pendiente_

## 20. Portabilidad y acceso estructurado
**Pregunta.** ¿En qué formato y plazo debe entregarse la exportación de los datos (JSON o CSV)? ¿Debe incluir la evidencia de declaración y los eventos de consentimiento?
**Estado actual.** No implementada.
**Respuesta:** _pendiente_

## 21. Cambio de correo entre el registro y el borrado
**Pregunta.** (Sin objeto desde 2026-11-11: la evidencia ya no guarda ninguna huella del correo; ver 27.)
**Estado actual.** Cerrada por diseño.
**Respuesta:** _pendiente_

## 22. Gobierno y gestión de incidentes
**Preguntas.** ¿Conviene designar un **delegado de protección de datos** y adoptar un modelo de prevención? ¿Cuál es el criterio vigente para notificar a la Agencia y a los titulares ante una vulneración de datos de menores (no asumir 72 horas sin verificar)?
**Estado actual.** Sin runbook de incidentes; sin delegado designado.
**Respuesta:** _pendiente_

---

## Cómo se cierra una pregunta

1. Legal responde en la columna "Respuesta" y se anota la fecha y quién respondió.
2. Se actualiza el parámetro o el código afectado (si lo hay) y se marca el valor como confirmado (por ejemplo, `blocked_profile_retention_confirmed = true`).
3. Se actualizan `docs/privacy/inventario-datos.md` y `docs/privacy/eipd/eipd-borrador.md`.
4. `privacy_config_warnings()` debe quedar en cero antes del despliegue a producción.
