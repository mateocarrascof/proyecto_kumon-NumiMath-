# SPEC

## Racha diaria ("días seguidos")

Migración: `supabase/migrations/20261026120000_student_daily_streaks.sql`. Decidido el 2026-10-26.

### Qué es
Cada **perfil de alumno** tiene su propia racha de días. Un día cuenta cuando el perfil
**responde al menos un ejercicio** (correcto o incorrecto). Si pasa un día completo sin responder,
la racha vuelve a 0 y el siguiente día practicado empieza en 1.

Es distinta de la racha de **aciertos seguidos** que ya existía (`streak` en el progreso y las
estrellas/medallas de la práctica). En la UI, la nueva se llama siempre "días seguidos".

### Qué día es "hoy"
La **fecha local del dispositivo** (`YYYY-MM-DD`, `app/src/app/core/time/local-day.ts`).
No se envía ni se guarda la zona horaria.

- Al responder, la app manda `local_date`. Al pedir el progreso, manda `today`.
- El servidor solo acepta fechas entre la fecha UTC del servidor −1 y +1 día (cubre UTC−12 a UTC+14).
  Si la fecha falta o no es creíble, el intento se registra igual y la racha no cambia.
- Una fecha anterior al último día registrado se ignora: no se pueden rellenar días perdidos.

### Reglas al responder (en `record_attempt`, misma transacción que el intento)
| Situación | Resultado |
|---|---|
| Primer día del perfil | racha = 1 |
| Mismo día que el último | sin cambio |
| Día siguiente al último | racha + 1 |
| Dos o más días después | racha = 1 |
| Día anterior al último | sin cambio |
| Ejercicio ya respondido (`duplicate`) | sin cambio |

### Reglas al leer (`GET /v1/students/{id}/progress?today=YYYY-MM-DD`)
- `daily_streak` = racha guardada si el último día es hoy o ayer; si no, 0.
- `practiced_today` = el último día es hoy (o posterior, por diferencias de zona).
- Sin `today` se usa la fecha UTC.

### Datos
Solo una fila por perfil: largo de la racha y último día local. Sin historial. Ver
`docs/privacy/inventario-datos.md`. Nada de esto llega a la IA.

### UI y tono
- Práctica: insignia "🔥 N" **siempre visible** en la barra superior (al elegir tema y durante los
  ejercicios, también con 0; dorada si ya practicó hoy). Bajo "¿Qué quieres practicar?", "N días
  seguidos" y la frase de ánimo si aún no practicó hoy. Tras la primera respuesta del día, un aviso
  "¡N días seguidos!". Si la racha no se puede leer, la insignia no aparece y la práctica sigue.
- Progreso: la racha y una frase de ánimo si aún no practicó hoy.
- Nunca se dice que la racha "se perdió" ni se culpa al niño. Sin notificaciones push. El
  recordatorio de racha es local, opcional y lo activa solo el tutor (CU-A9, ADR 0003).

### Límite conocido
Cambiando el reloj del dispositivo se puede ganar como máximo un día extra (por la tolerancia de ±1 día).
Se acepta: la racha es solo motivacional y no da premios canjeables.

## Dificultad progresiva (dominio por habilidad)

Reemplaza la regla del 2026-10-26 ("3 aciertos seguidos sube / 2 errores seguidos baja"). Decidido el
2026-10-27. Migración: `supabase/migrations/20261028100000_skill_progress.sql`.

### Qué es
Cada habilidad de fase A del catálogo (`docs/habilidades_1a4_basico.csv`) tiene 3 niveles por perfil:
1 (fácil), 2 (medio) y 3 (difícil), según las columnas `nivel_1..3` del CSV. El niño elige libremente
qué habilidad practicar (sin candados): las de su curso, agrupadas por eje, y las de cursos anteriores
como repaso (sección plegada). Las del curso siguiente no se muestran por ahora.

### Regla (base: `record_attempt`; espejo en `api/app/exercises/levels.py`)
| Situación | Resultado |
|---|---|
| Sin intentos en la habilidad | Nivel 1, bloque vacío |
| Bloque de 10 ejercicios en el nivel actual con 8 o más aciertos | Sube 1 (en el nivel 3: habilidad **dominada**) |
| Bloque de 10 con 4 o menos aciertos | Baja 1 (mínimo 1) |
| Bloque de 10 con 5 a 7 aciertos | Repite el nivel |

- El bloque se llena aunque el niño cambie de día o salga de la app. Al cambiar de nivel empieza uno
  nuevo. Un ejercicio emitido en otro nivel (antes de un cambio) no cuenta.
- Dentro del bloque no se repiten enunciados mientras haya otros posibles; si el nivel tiene menos de
  10 (p. ej. 2 × 1 a 2 × 5), se acepta repetir.
- Si la lectura del progreso falla, el ejercicio sale en nivel 1 (mejor esfuerzo).
- Más adelante, el profesor podrá fijar el nivel a mano (por eso el nivel se guarda en
  `student_skill_progress` y no se recalcula desde los intentos).

### Seguridad
- El nivel lo decide el servidor y va **firmado** en el token del ejercicio (versión 4); el cliente no
  puede elegirlo. El servidor regenera el ejercicio con ese nivel al corregir.
- El nivel no llega a la IA. A la IA llega el curso del perfil y el nombre de la habilidad.

### UI y tono
- Lista: tarjetas por eje con estrellas del nivel (★★☆) o ✅ si está dominada.
- Ejercicio: estrellas del nivel y "🎯 4/10" (ejercicio del bloque en curso), sin mostrar umbrales.
- Al subir: "¡Subiste de nivel!", confeti y frase de Numi. Al dominar: "¡Dominaste …!" con 🏆. Al
  bajar no se dice nada.
- Enunciados con palabras se muestran con letra más chica para que quepan.

## Papel para calcular

Botón "📝 Papel para calcular" bajo el ejercicio: abre un papel cuadriculado para hacer el cálculo
a mano con el dedo, un lápiz o el mouse (`app/src/app/core/scratchpad/`). Herramientas: lápiz en
3 colores, goma, "Mover" y "Borrar todo". Canvas nativo, sin librerías nuevas.

"Borrar todo" no borra de inmediato: abre "¿Seguro que quieres borrar todo el papel?" con
"No, volver" y "Sí, borrar". "Sí, borrar" queda bloqueado 3 segundos con cuenta regresiva visible
("Espera 3…"), para que un toque sin querer no borre el trabajo. Pasar al siguiente ejercicio
cierra el aviso.

Zoom (2026-10-27): la hoja mide 1200×900 y la pantalla muestra una ventana. Se acerca/aleja con
botones grandes (+, −, "Ver toda la hoja"; de "hoja completa" a 300 %), pellizcando con dos dedos
o con Ctrl + rueda. "Mover" recorre la hoja con un dedo. Los trazos se guardan en memoria como
líneas (no como imagen) para verse nítidos con cualquier zoom. Si un segundo dedo toca mientras se
dibuja, ese trazo se descarta y el gesto pasa a ser zoom.

Privacidad: lo dibujado no se guarda, no se exporta y no se envía a ningún lado; se borra al pasar
al siguiente ejercicio o salir de la pantalla. No se analiza ni llega a la IA.

## Perfiles

Decidido el 2026-10-27. Migración: `supabase/migrations/20261027120000_student_delete_via_server.sql`.

### Selección ("¿Quién practica?", `/perfiles`)
Pantalla para el **niño**: Numi pregunta "¿Quién va a practicar hoy?" y cada perfil es una tarjeta
grande de color con un **animalito** (🦊🐼🦁🐸…), el apodo, el curso y "🔥 N días seguidos".
Tocar la tarjeta abre la práctica; "Mi progreso" abre su progreso. Un perfil bloqueado se ve
apagado ("En pausa") y no abre la práctica. Sin perfiles: "Pide a un adulto que cree tu perfil en
el Panel del tutor". **Aquí no se crean ni se eliminan perfiles.**

El animalito y su color salen de un hash del id del perfil (`core/profiles/avatar.ts`): siempre el
mismo para el mismo perfil, solo decorativo, no se guarda y no es un dato del niño.

### Crear y eliminar (solo en el Panel del tutor, con PIN)
- Sección "Perfiles" del panel: lista con animalito, "Crear perfil" (apodo, curso y declaración del
  adulto, igual que antes) y "Eliminar".
- Eliminar muestra qué se borra (progreso, racha y tareas, sin vuelta atrás) y **pide el PIN otra
  vez** antes de borrar.
- El borrado va por la API: `DELETE /v1/students/{id}` exige el token parental. El cliente **ya no
  puede borrar en la base** (se quitó `delete` a `authenticated` y la política `students_delete_own`);
  solo `delete_student` (service_role). Los triggers siguen archivando la declaración del adulto y
  borrando en cascada intentos, racha y tareas.
- Borrar **no** exige consentimiento vigente ni perfil desbloqueado: suprimir datos es un derecho
  del titular. Si el tutor olvida el PIN, lo recupera con su contraseña ("Olvidé mi PIN").
- Crear sigue yendo directo a la base con RLS (compuerta de consentimiento y límites intactos);
  en la app solo se ofrece dentro del panel.

## Panel del tutor

Decidido el 2026-10-26; acceso cambiado el 2026-10-27. Pantalla para el adulto (`/panel`),
separada de "Progreso" (que sigue siendo la vista del niño, con Numi). Se entra desde **Inicio**
con "Panel del tutor", junto a "Perfiles de niños", y siempre pide el **PIN**. Arriba hay pestañas
con el apodo de cada perfil; al cambiar se recargan informe y tareas. Estilo sobrio, sin mascota.
Contiene: resumen, gráfico semanal, feedback, aciertos por tema, tareas, "Cambiar PIN" y "Salir".

### PIN del tutor (control parental)
Reemplaza la "pregunta de adulto" provisional. Tabla `tutor_pins` (migración `api_support`), solo
`service_role`.

| Situación | Resultado |
|---|---|
| Entrar sin PIN creado | "Crea un PIN de 4 dígitos" + repetirlo |
| PIN débil (4 iguales o secuencia como 1234 / 9876) | 422 `pin_weak` |
| PIN correcto | Token parental de **10 minutos** (`X-Parental-Token`), solo en memoria de la app |
| PIN incorrecto | 401 `pin_wrong` con intentos restantes |
| 5 errores seguidos | 423 `pin_locked` durante 15 minutos |
| Cambiar PIN | Con un token parental vigente |
| "Olvidé mi PIN" | El tutor escribe la contraseña de su cuenta; el servidor acepta un PIN nuevo solo si el JWT muestra un login con contraseña de hace < 5 minutos (claim `amr`) |
| Llamada al panel sin token o vencido | 401 `parental_required` → la app vuelve a pedir el PIN |

- Hash **argon2id** calculado en el servidor; el PIN nunca se guarda en claro ni se registra.
- El token es HMAC-SHA256 (clave derivada de la de ejercicios, con separación de dominio) y va
  ligado al tutor del JWT. No se guarda en ningún lado.
- Protegen con PIN: `GET /report`, `GET /assignments/all`, `POST /assignments`,
  `DELETE /assignments/{id}`. La vista del niño (`GET /assignments`, responder) no lo pide.

#### Salir de la zona del tutor (fix 2026-11-12)
El botón "Inicio" del panel volvía a `/home` sin borrar el token: al entrar de nuevo no se pedía
el PIN mientras siguiera vigente. Ahora `core/parental/parental-zone.ts` cierra la zona por
cualquier camino, desde un solo lugar:
- **Zona del tutor:** `/panel` y `/pin` (`/pin` es zona porque "Cambiar PIN" usa el token). Las
  pestañas de perfil dentro del panel no son salidas.
- **Navegación:** el token se borra al INICIAR una navegación hacia fuera de la zona, aunque
  después se cancele (en el peor caso se pide el PIN una vez más), y también si una URL de la
  zona termina redirigida fuera (`/panel/x` → `/home`). Cubre "Inicio", volver
  (navegador o botón atrás de Android), cambiar de perfil (ir desde `/home` a la pantalla de un
  niño), cerrar sesión y cualquier enlace futuro.
- **Sesión:** también se borra si se cierra la sesión o cambia el tutor, aunque no haya navegación.
- **Segundo plano:** con `visibilitychange` (el mismo evento de la purga y la sincronización, sin
  `@capacitor/app`). Al ocultarse la app se borra el token; al volver, si estaba en `/panel`, se
  lleva a `/pin` para no dejar los datos del niño a la vista sin PIN.
- Las acciones sensibles (borrar, exportar, revocar, cambiar el PIN) siguen exigiendo el token en
  el servidor. El vencimiento de 10 minutos no cambia.

Pendientes:
1. **Verificar en un equipo real (Android e iOS)** el paso a segundo plano: la prueba en
   navegador solo simula `visibilitychange`, y no está comprobado que el WebView de Android y
   WKWebView lo disparen. Revisar también:
   - si la miniatura del selector de apps muestra el panel (se toma al ocultarse, antes de volver
     a `/pin`);
   - si el diálogo de permiso de notificaciones del recordatorio de racha dispara `hidden` (el
     guardado siguiente saldría sin token y pediría el PIN).
   Si hiciera falta un respaldo, `@capacitor/app` (`appStateChange`) ya está en `package.json`
   aunque no se usa; decidir con el dueño.
2. **Revocar el token en el servidor:** hoy es una firma sin estado; una copia seguiría siendo
   válida hasta 10 minutos. Vive solo en memoria de la app, así que se deja para después (haría
   falta una tabla y una migración).
3. Si la app pasa a segundo plano durante "Cambiar PIN" (`/pin?cambiar=1`), al volver el cambio
   ya no tiene token: el servidor lo rechaza y hay que salir y escribir el PIN otra vez.
4. **Bajos de la revisión (no implementados):** `if (!doc)` sobrante en el vigilante; la regex de
   la zona repetida (un `pathOf(url)`); el `session.end()` de "Salir del panel" ya sobra (se deja
   explícito); la prueba de "cerrar sesión" pasa por el efecto y por la navegación a la vez; "dejar
   de vigilar" no comprueba que se quite el evento de visibilidad; ninguna prueba comprueba el
   registro en `app.module.ts`.

Revisión (`security-reviewer` y `code-reviewer`): sin altos. Corregidos en `fix(pin)`: al volver a
primer plano se usa `NavController.navigateRoot('/pin')` (el panel sale de la pila de Ionic); una
URL de la zona redirigida fuera (`/panel/x` → `/home`) también borra el token; prueba de que el
mismo tutor con una sesión renovada no pierde el token.

## Explicación con IA en práctica

Decidido el 2026-10-28. Conecta la pantalla de práctica (`/practica/:id`) con
`POST /v1/students/{id}/explanations` (ADR 0001). La app sigue funcionando con `AI_PROVIDER=mock`.

### Cuándo aparece
- Solo tras una respuesta **incorrecta**: el aviso dice "Casi. La respuesta era X." y
  "¿Quieres ver cómo se hace? 👇", justo encima del botón "💡 Explícame cómo se hace".
- Con la explicación abierta (cargando, mostrándose o terminada), el aviso queda solo en
  "La respuesta era X.": el ánimo lo da Numi al final. Si la explicación no se pudo dar (cuota,
  sin servicio, rechazo), vuelve "Casi. La respuesta era X." sin la invitación. En las tareas del tutor (sin botón) el
  aviso es solo "Casi. La respuesta era X.". Nunca "mal", "incorrecto" ni "fallaste".
- **No** aparece en las tareas del tutor (tema `tarea_tutor`): su texto nunca se envía a la IA.
- Una explicación por ejercicio: al terminar bien, el botón desaparece (no gasta más cuota).

### Qué se envía
- Solo `{ topic, exercise }`: `topic` es el id de la habilidad que devolvió el servidor
  (`exercise.topic`, p. ej. `"3-11"`, también de repaso) y `exercise` es el enunciado **generado por
  el sistema** (`exercise.text`). Nunca la respuesta del niño, su apodo, su curso ni texto escrito
  por él. El curso lo lee el servidor de la base.
- Con el JWT del tutor, a FastAPI. La app nunca llama a la IA.
- `fetch` + `ReadableStream` con el SSE parseado a mano (`core/explanation/`), porque `EventSource`
  no permite la cabecera `Authorization`.

### Formato de la explicación: un paso por línea
- Una operación por línea, frases cortas, sin párrafos, viñetas, markdown ni HTML. Ejemplo:
  "¡Vamos a sumar 481 + 155!" / "Separa 155 en 100 + 50 + 5." / "Primero: 481 + 100 = 581" /
  "Luego: 581 + 50 = 631" / "Al final: 631 + 5 = 636" / "¡Así se llega a 636!" / "¡Tú puedes!".
- Rótulos de varias cuentas seguidas: con 2 pasos "Primero / Al final"; con 3 o más
  "Primero / Luego… / Al final".
- Cierre: "¡Tú puedes!" (no da por hecho que el niño entendió; antes era "¡Ahora ya sabes cómo se
  hace!").
- Lo pide `_RULES` (`api/app/ai/prompt.py`) al modelo real y lo cumple el simulado.
- Transporte: el filtro de salida sigue validando oración por oración; si una oración cierra una
  línea, el texto del evento `chunk` termina en `\n` (cada salto cuenta 1 carácter para el tope
  total de 1.200). Si un fragmento termina justo en ". ", la oración se valida al instante pero se
  entrega con el fragmento siguiente, para no perder un salto que llegue después.
- Cierre en la derivación: si la respuesta le dice que hable con un adulto de confianza, termina con
  eso, sin "¡Tú puedes!". La app une los trozos y muestra la burbuja con
  `white-space: pre-line` (texto plano por interpolación, sin `innerHTML`).

### Estados y mensajes
| Situación | Lo que ve el niño |
|---|---|
| Esperando el primer trozo | Burbuja de Numi "Numi está pensando…", mascota `thinking`, botón inactivo (`aria-disabled`) |
| Llega texto | Aparece de a poco en la burbuja, mascota `talking` |
| Termina (`done`) | Queda el texto completo, mascota `idle` |
| 422 `input_rejected` | El mensaje del servidor |
| 429 (cuota) | "Numi necesita descansar por hoy. ¡Sigue practicando mañana!" |
| 503, 401/403 u otra falla / sin red | "Numi no pudo explicarlo ahora. Intenta de nuevo en un rato" (con "Intentar otra vez") |
| Corte a mitad (evento `error` o fin sin `done`) | Se conserva lo recibido + el mensaje neutro del servidor o "Numi no pudo terminar la explicación…" |

En todos los casos la mascota no se pone triste, no se usa el aviso de error de la práctica y
"Siguiente" sigue funcionando.

### Cancelación y datos
- La petición se cancela (`AbortController`) al pasar al siguiente ejercicio, cambiar de tema o
  salir de la pantalla; lo que llegue después se descarta.
- El texto vive solo en memoria de la pantalla y se borra al pasar de ejercicio. No se guarda en
  ningún almacenamiento ni se registra.

### Dónde está Numi mientras explica
Al pedir la explicación, Numi "baja" junto a su burbuja: deja su lugar de arriba y aparece pegada
a la explicación (encima en teléfono; a la izquierda desde 600 px, con el piquito apuntándola). En
pantalla hay siempre una sola Numi. La pantalla se desplaza suave hasta ella (sin animación si el
dispositivo pide menos movimiento). Con "Siguiente" o "Cambiar de tema" vuelve arriba.

### Accesibilidad
Burbuja con `aria-live="polite"` y `aria-busy` mientras llega; letra de 1,25 rem como el resultado.
"Numi dice:" está visible para el lector de pantalla y se lee antes del texto. Colores fijos (la
app es solo modo claro): texto #2b2d42 sobre blanco (13,5:1), "Numi dice:" #5b3bc4 (7,3:1).
Si el botón tenía el foco y desaparece, el foco pasa a la burbuja.

### Nombres de habilidad con miles
Los nombres del catálogo escriben los miles con espacio ("Sumas hasta 1 000"). La app cambia ese
espacio por uno sin salto (U+00A0) al mostrarlos, para que el número no se parta entre dos líneas;
el catálogo no cambia. En el encabezado del ejercicio el nombre envuelve por palabras y el reloj,
el nivel y el bloque conservan su ancho.

### Cambios del servidor que vinieron con esto
- El filtro de entrada busca los términos "fuera de tema" **al inicio de una palabra**: como
  subcadena rechazaba enunciados del propio catálogo ("medios kilos" contiene "dios").
- 4-22 dice "Un paseo dura…" en vez de "Una película dura…" ("película" sigue siendo fuera de tema).
- Un test exige que **todo** enunciado generado pase el filtro de entrada y que su tema sirva para
  pedir explicación.
- El proveedor simulado (`mock_provider.py`) explica paso a paso cada forma de enunciado del
  catálogo (antes la mayoría caía en una guía genérica y fracciones y familias salían mal).
- 2026-10-28 (textos): el prompt de producción solo sumó la regla de formato (un paso por línea,
  sin markdown ni HTML, cierre que no dé por hecho que entendió); las demás reglas no cambiaron.
  La frase de Numi "¡Inténtalo otra vez!" tras un error pasó a "¡Así se aprende!" (sonaba a repetir
  el mismo ejercicio).

## Pantallas del niño: selector, tamaños y textos de Numi

Decidido el 2026-10-28. La app apunta a teléfono y tablet; el PC es solo para probar. Revisado con
capturas a 360×740, 768×1024 y 1024×768.

### Selector de habilidades (`practice/skill-tiles.component`)
- **Baldosas agrupadas por eje**, con color e ícono fijos por eje: Números y operaciones (verde
  azulado 🔢), Patrones y álgebra (lila 🔷), Medición (coral 📏) y Geometría (amarillo 📐). Antes
  los colores rotaban por posición y no significaban nada.
- 2 columnas en teléfono, 3 desde 600 px y 4 desde 1000 px.
- Cada baldosa (blanca, con borde y círculo del color del eje) muestra el ícono, el **nombre
  completo** (envuelve, nunca se corta) y "★★☆" con una barrita del bloque en curso ("3/10"); si está
  dominada, "✅ Dominada". El encabezado del eje dice "N de M dominadas" (solo si hay alguna).
- Lector de pantalla: cada baldosa se lee como "Sumas hasta 1 000, nivel 2 de 3, 5 de 10 ejercicios"
  (o "…, dominada"; en el repaso agrega "repaso de 2° básico").
- "Tareas de tu tutor" sigue arriba, a todo el ancho. "Repasar cursos anteriores" abre las mismas
  baldosas agrupadas por curso ("Repaso de 2° básico") con un chip del curso en cada una.
- Sin candados ni tarjeta de sugerencia ("Para hoy"): el niño elige libremente.

### Tamaños durante la práctica
- Numi se achica mientras hay un ejercicio (96 px en teléfono, 140 px en tablet) para que la casilla
  de respuesta y "Responder" se vean sin desplazar.
- La zona de juego (ejercicio, respuesta, resultado, explicación) mide 480 px en teléfono y 600 px
  desde 768 px. El enunciado escala con el ancho ("481 + 155 = ?" cabe en una línea a 360 px).
- En teléfono, el nombre de la habilidad va en su propia fila sobre el reloj, el nivel y el bloque.
- El marcador "N de M correctas" aparece recién con la primera respuesta (antes decía "0 de 0").
- Con `prefers-reduced-motion` se apagan las animaciones.

### Login del tutor: colores
"Ya tengo cuenta" usa el verde azulado y "Soy nuevo" (crear cuenta) el **lila** de Numi en la barra,
la pestaña elegida, los pasos y el botón (antes coral, que contrastaba demasiado). Texto blanco
sobre lila: 5,5:1.

### Globo de Numi y frases
- El globo envuelve las frases largas (antes no envolvía y se salía en pantallas angostas) y el
  lector de pantalla lo lee (ya no es `aria-hidden`; no es `aria-live` para no leer dos veces).
- Numi **complementa** el aviso de la pantalla, no lo repite: tras un error dice "¡Tú puedes!",
  "¡Así se aprende!" o "¡Sigue así, vas bien!" (el aviso ya dice "Casi…"); al subir de nivel,
  al dominar, al ganar medalla y al terminar tareas usa frases distintas del aviso. Sin género
  gramatical ("¡Qué crack!", "¡Esto ya lo manejas!" en vez de "un crack" o "experto") y sin frases
  que inviten a no parar. Frases de 32 caracteres o menos.
- Tras una respuesta incorrecta Numi queda "pensando" (no triste): sin culpa. El estado triste
  queda solo para fallas técnicas.
- Errores en pantallas del niño (`core/kid-messages.ts`): sin "servidor", "sesión" ni "acceso"; si
  el niño no puede resolverlo, se le pide ayuda a un adulto ("Pide ayuda a un adulto para volver a
  entrar."). Las pantallas del tutor mantienen sus mensajes para adultos.

## Ejercicios propios ("Tareas de tu tutor")

Migración: `supabase/migrations/20261027100000_assigned_exercises.sql`.

### Qué es
El tutor escribe un enunciado (1–200 caracteres) y la respuesta (entero de 0 a 1.000.000).
El niño tiene siempre un botón "📌 Tareas de tu tutor" arriba de los temas que abre su pantalla
de tareas (`/tareas/:id`): **pendientes** (tocar una para resolverla, o "Resolver todas") y **ya
hechas** con ✔ o ↻ (sin mostrar la respuesta). Sin tareas: "Todavía no hay tareas". Se resuelven
con la misma pantalla de práctica (solo números, papel para calcular, confeti), en modo tareas
(`/practica/:id?tareas=1&desde=<id>`).

### Reglas
| Situación | Resultado |
|---|---|
| Crear con texto que no pasa el filtro | 422 con un mensaje para el adulto (sin repetir el texto) |
| Más de 20 pendientes por perfil | 409 (`limit`) |
| Responder | Se marca respondida, se guarda si acertó y se registra un intento (tema `tarea_tutor`), que suma al progreso y a la racha diaria |
| Responder otra vez | 409 (`already_answered`) |
| Borrar una pendiente | Se borra |
| Borrar una respondida | No se puede (404) |
| Editar una pendiente (T8, `PATCH`) | Mismo filtro que al crear, **PIN recién verificado** (2 min); 204 |
| Editar una respondida | 409 (`already_answered`) |
| Editar la tarea de otro tutor | 404 |

### Seguridad y privacidad
- El texto pasa por `check_input` (datos personales, groserías, temas inseguros, intentos de
  manipular, fuera de matemáticas) **antes de guardarse**. Aviso en el formulario: "No escribas el
  nombre real ni datos del niño". El filtro no detecta todos los nombres propios.
- El texto del tutor **nunca se envía a la IA**: estas tareas no tienen explicación de Numi.
- La vista del niño recibe `{pending: [{id, text}], done: [{id, text, status}]}` (últimas 20
  hechas), **nunca la respuesta**. La corrección es del servidor.
- Escritura solo vía FastAPI (service_role); el tutor solo lee las de sus perfiles (RLS).
- Nada del texto aparece en logs (solo códigos).

## Informe y feedback para el adulto

`GET /v1/students/{id}/report?today=YYYY-MM-DD`. Se calcula con los últimos 500 intentos; no guarda
datos nuevos.

### Contenido
- Resumen: intentos, % de aciertos, días practicados en los últimos 7 días, racha de días.
- `weeks`: 8 periodos de 7 días que terminan "hoy" (fecha local del dispositivo, validada a ±1 día
  como la racha), cada uno con intentos y aciertos. Fecha de cada intento: UTC.
- Por tema: intentos y % de aciertos.
- `feedback`: frases fijas elegidas por reglas (`api/app/report_feedback.py`), sin IA:

| Regla | Condición | Frase (ejemplo) |
|---|---|---|
| Pocos datos | < 5 intentos en total | "Aún hay pocos ejercicios para sacar conclusiones. ¡Anímalo a practicar!" |
| Punto fuerte | tema con mayor %, ≥ 5 intentos y ≥ 70 % | "Su punto fuerte es Sumas hasta 20 (90 % de aciertos)." |
| A reforzar | tema con menor %, ≥ 5 intentos y < 70 % (distinto del fuerte) | "Le conviene practicar más Restas con canje (45 % de aciertos)." |
| Constancia baja | < 3 días practicados en 7 | "Practicó 1 día esta semana: unos 10 minutos diarios ayudan mucho." |
| Constancia alta | ≥ 5 días en 7 | "¡Practicó 6 días esta semana! La constancia se nota." |
| Mejora | % de esta semana ≥ % anterior + 10 (ambas con ≥ 5 intentos) | "Esta semana mejoró: de 60 % a 80 % de aciertos." |
| Baja | % de esta semana ≤ % anterior − 10 (ambas con ≥ 5) | "Esta semana le costó más (de 80 % a 60 %). Repasar con calma puede ayudar." |

Tono para adultos, sin culpar al niño ni compararlo con otros.

### Gráfico
SVG propio (`app/src/app/core/charts/`), sin librerías: una barra por semana (alto = intentos,
tramo de aciertos destacado) y el % encima. Accesible: `role="img"`, `aria-label` con resumen y una
tabla oculta para lectores de pantalla. Colores del tema (claro/oscuro).

## Exportar historial y estadísticas (T22)
`GET /v1/students/{id}/export.csv` (zona del tutor, con PIN). CSV con las estadísticas por habilidad y el
historial (`fecha_hora_utc`, habilidad, resultado, segundos); **nunca enunciados ni respuestas** y las tareas del
tutor salen como "Tarea del tutor". Toda celda de texto que empiece con `=`, `+`, `-`, `@`, tab o CR (también tras espacios o tabs) se antecede con
`'` (inyección de fórmulas). Se arma en memoria y se devuelve como descarga (`no-store`): **no se guarda en el
servidor**. Hasta 5 000 intentos (los más recientes); si hay más, una línea final lo avisa. Sin datos: 404 `no_data` y la app lo informa. La app pide el archivo por HTTP (lleva la
sesión y el PIN en cabeceras) y lo ofrece con un `Blob`; solo CSV (el PDF de la ficha no se hace).

## Tiempo por ejercicio

Decidido el 2026-10-27. Migración: `supabase/migrations/20261027130000_attempt_duration.sql`.

### Para el niño (sin presión)
Reloj pequeño "⏱ 0:42" en la esquina de la tarjeta del ejercicio (`core/timer/`): cuenta **hacia
arriba**, en gris, sin colores de alerta, sin sonidos y sin mensajes de apuro. Se detiene al
responder y vuelve a 0 con el siguiente ejercicio. Tocarlo lo oculta o lo muestra (mientras siga
abierta la pantalla). Es solo informativo: no se envía nada desde la app.

### Cómo se mide (en el servidor)
- Ejercicios: el token firmado lleva la hora de emisión (`i`, versión 3); al responder,
  segundos = ahora − emisión.
- Tareas del tutor: al abrir una, `POST …/assignments/{id}/start` entrega un ticket firmado
  (tarea, perfil, hora); la respuesta lo devuelve. Ticket ausente, alterado o de otra tarea → se
  registra sin tiempo (la respuesta nunca se bloquea por esto).
- Tope: 600 s (lo que dura un ejercicio). Más que eso o una hora "del futuro" → sin tiempo.
- Se guarda en `student_attempts.duration_s` (segundos, nullable).

### Para el tutor
"Tiempo típico" = **mediana** de los segundos (no la distorsiona un ejercicio que quedó abierto
mucho rato). En el panel: una tarjeta con el tiempo típico general y "⏱ 35 s" por tema. Con menos
de 3 intentos con tiempo en un tema se muestra "—".


## Docentes y administradores

Decidido el 2026-11-12 (reemplaza el borrador anterior de "Perfil del profesor", que hablaba de
cursos, dominios de colegios y fotos de hojas). Todo entra al MVP. Los roles y la base de datos
están implementados; el resto se construye en el orden de abajo.

### Reglas de base
- **Solo adultos tienen cuenta**: tutor, docente y administrador. El niño nunca (ver `CLAUDE.md`).
- El rol está en `app_metadata.role` de Supabase Auth (`teacher` o `admin`). Solo lo escribe el
  servidor; el usuario no puede cambiarlo. Quien no lo tiene es tutor. El administrador es solo ese
  rol (sin tabla propia).
- Un docente o administrador **no es tutor**: el alta no le crea fila en `tutors` (y si el rol llega
  después, se retira esa fila; si ya tenía datos de niños, falla). Las rutas del tutor rechazan
  tokens de docente o administrador (403); cada rol tiene su dependencia en FastAPI.
- El docente **no se registra solo**: lo crea el administrador.

### Autorización = el vínculo
- **No hay casillas de compartir.** La autorización es el **vínculo** docente–alumno (`teacher_links`)
  que el tutor crea al ingresar el código del docente y **confirmar un aviso que muestra el nombre del
  docente** (T25). Queda `accepted_at` (UTC), la versión de los términos aceptada (`terms_version_id`) y el nombre del docente que se mostró (`teacher_name`). Solo se puede crear con consentimiento vigente.
- El código de vínculo (8 caracteres, sin letras ambiguas, único e inmutable) **solo identifica al
  docente**; no da acceso por sí solo, y hay límite de intentos.
- Un docente ve a un niño **solo si** hay vínculo activo, el consentimiento del tutor no está
  revocado, el perfil no está bloqueado y el rol del docente sigue verificado. Toda lectura pasa por
  `teacher_can_view`; los docentes no tienen `select` directo sobre tablas de niños.
- El docente ve **solo apodo, curso, progreso e historial** de esos niños. **Desde cuándo:** el progreso por
  habilidad (estado actual) lo ve completo; el historial de ejercicios y las hojas, **solo desde `accepted_at` del
  vínculo** (nunca lo anterior ni hojas guardadas para otro docente). Nunca la identidad ni el
  correo del tutor. En el historial **no ve el texto de las tareas que escribió el tutor** (solo "tarea
  del tutor" y si acertó), ve la fecha sin hora y no ve los segundos de respuesta.
- El tutor puede quitar el vínculo cuando quiera (T26) y el acceso se corta al instante.
- **Revocar el consentimiento borra todos los vínculos** del tutor; volver a consentir no los
  restaura (hay que vincular de nuevo). Eliminar la cuenta del tutor o un perfil los borra en cascada.
- La autorización del docente es un **anexo aparte y versionado** (`teacher_authorization`, con su huella): se
  acepta en cada vínculo y no modifica los términos ni la política generales (no obliga a re-aceptarlos). Si el
  anexo cambia de versión, los vínculos existentes conservan la que se aceptó (pendiente decidir si se reconfirman).
- Borrar un docente borra sus vínculos; no toca perfiles, progreso ni hojas de niños (las hojas solo
  dejan de verse para ese docente). Sin contraseñas, correos ni contenido en logs.

### Hojas guardadas (papel para calcular, A22 y D8)
- Por defecto el papel para calcular no se guarda. Se guarda **solo si el niño tiene un docente vinculado
  activo**: **sola, sin botón**: al responder, al pasar a "Siguiente" y al cerrar el papel, si hay trazos nuevos desde el último
  guardado (los guardados salen en fila y no se duplican; el upsert deja el último). Sin vínculo o sin red no guarda y no
  muestra error ni aviso. Con docente vinculado, bajo el papel abierto dice "Tu profe puede ver este papel" (la consulta
  `sheets/enabled` se hace una vez por perfil y se reutiliza 5 minutos). Una hoja por ejercicio (upsert). No hay casilla aparte.
- **Solo cuentan los vínculos cuyo texto de autorización describe las hojas** (`covers_sheets`, desde `autorizacion-docente-prov-5`):
  los vínculos con textos anteriores no guardan ni muestran hojas (EIPD R35, solo para hojas; el historial y el progreso
  no cambian). Para no subir trazos sin destinatario, el dispositivo consulta `GET /v1/students/{id}/sheets/enabled`.
- **Límite por tutor:** 30 guardados por minuto y 100 por día (`sheet_saves_per_minute`, `sheet_saves_per_day`); y un tope de
  300 hojas por perfil (al pasarse se borran las más antiguas);
  pasado el límite, `429 rate_limited` (el niño no ve error).
- **Respuesta del niño:** se contrasta que acierte o no con el intento, no el valor exacto (aceptado: solo afecta a
  datos propios del tutor).
- **Datos:** trazos vectoriales en jsonb (tope de 300 KB, sin imágenes ni metadatos), el enunciado (de las
  tareas del tutor solo "Tarea del tutor"), la respuesta del niño y la correcta, si acertó y la fecha. La
  tabla es `student_sheets` (RLS por tutor, escribe solo el servidor); no hay columnas nuevas en `student_attempts`.
- **API:** `POST /v1/students/{id}/exercises/sheet` y `/assignments/{id}/sheet` (después de responder; el cuerpo
  admite hasta 256 KB solo en esas rutas) y, para el docente, `GET /v1/teacher/students/{id}/sheets[/{sheet_id}]`
  (solo lectura, desde `accepted_at`, el mismo 404 sin acceso).
- **Las hojas pertenecen al niño.** Eliminar a un docente o quitar un vínculo **no borra las hojas**: solo dejan
  de verse para ese docente. Se borran al borrar el perfil o la cuenta y al revocar el consentimiento; el tutor
  las ve y las elimina desde su panel (T27). Sin docente vinculado activo no se guardan hojas nuevas. No llegan a la IA.
- **T27 (el tutor):** por perfil, "Hojas guardadas" lista fecha y hora de Chile, ejercicio y resultado, y dibuja cada hoja
  con el mismo visor del docente (`app-sheet-view`). Puede borrar una o todas (la confirmación dice cuántas y que no se
  puede deshacer) con el **PIN recién verificado cada vez** (menos de 2 minutos en el servidor). Borrar es definitivo y
  el docente deja de verlas de inmediato. Solo el tutor titular (mismo 404 genérico); ver y borrar funciona aunque el
  consentimiento esté revocado (derecho del titular). API: `GET /v1/students/{id}/sheets[/{sheet_id}]` y
  `DELETE /v1/students/{id}/sheets[/{sheet_id}]`; el cliente no puede escribir ni borrar directo (RLS solo lectura).
- **Plazo máximo: 90 días desde que se guarda (provisional, `sheet_retention_days`, sin confirmar por Legal)**,
  con purga diaria (pg_cron).
- **Límite conocido:** las hojas no entran a la cola sin conexión de CU-A12/A13; sin red no se guardan.
- Justificación: `docs/privacy/hojas-guardadas-justificacion.md`.
- **Los intentos de juego (`activity = game`, CU-A21) no se muestran al docente ni generan hojas:** el historial del
  docente (D7) y las hojas (A22) solo consideran `activity = practice`. Cubierto por la prueba pgTAP
  `game_hidden_from_teacher.test.sql`.

### Lecturas del docente (D4, D5, D7) y del tutor (T5)
**El docente solo lee.** Toda lectura pasa por `teacher_can_view` dentro de la base (vínculo activo,
consentimiento vigente, perfil no bloqueado y rol docente verificado). Sin acceso, la respuesta es **siempre
el mismo 404**, exista o no un niño con ese id. Las rutas del docente solo aceptan GET (el resto, 405).
- **D4 Alumnos vinculados** (`GET /v1/teacher/students`, pantalla `/docente/alumnos`): apodo y curso, en orden
  alfabético. Nada más.
- **D5 Progreso por habilidad** (`GET /v1/teacher/students/{id}/progress`): estado actual de las habilidades ya
  practicadas (nivel de 1 a 3, avance del bloque y si está dominada). **Sin tiempo típico ni racha.**
- **D7 Historial** (`GET /v1/teacher/students/{id}/history?offset&limit`, paginado de a 30): solo ejercicios de
  práctica **desde `accepted_at` del vínculo** vigente (un vínculo nuevo parte de su propia fecha), con
  habilidad, nivel, resultado y **fecha sin hora (hora de Chile)**, sin duración. El enunciado se muestra solo en
  los ejercicios generados por la app; en las **tareas del tutor** se muestra que fue una tarea y si acertó,
  **sin su texto** (la base ni siquiera lo entrega). Sin el diagnóstico inicial. Los intentos **no guardan la
  respuesta del niño ni la respuesta correcta**, así que no se muestran (ver `docs/plan-docente-admin.md`).
- **T5 Historial del hijo** (tutor, `GET /v1/students/{id}/history`, zona del tutor con PIN): los intentos de
  práctica de su hijo (habilidad, resultado, nivel y **hora**), paginados; lista vacía si no hay. Sección
  "Historial" del panel del tutor.

- **D6 Evolución** (docente, `GET /v1/teacher/students/{id}/evolution`): ejercicios y aciertos por semana de las
  últimas 8 semanas (hora de Chile), **solo práctica desde `accepted_at`** (sin diagnóstico ni juegos), solo
  totales (sin duración, hora ni textos). Mismo `teacher_can_view` y 404 genérico. Gráfico `app-weekly-chart`
  con tabla accesible; con menos de 5 ejercicios: "Aún hay pocos ejercicios para sacar conclusiones".

### Vincular y quitar docentes (T25, con T24 integrado, y T26)
Hecho en el panel del tutor, sección "Docentes de <apodo>" del perfil seleccionado. **Cada hijo se
vincula por separado.** La lectura de datos del niño por el docente llega después.
- **T25 Vincular:** el tutor escribe **su PIN (siempre de nuevo)** y el código de 8 caracteres del docente.
  - El servidor exige que el PIN se haya verificado hace **menos de 2 minutos** (el permiso del panel no basta).
  - Se muestra el **nombre del docente** y el texto de autorización (`docs/legal-provisional/autorizacion-docente.md`,
    tipo `teacher_authorization`, versionado con su huella, provisional): qué verá (progreso por habilidad:
    estado actual completo; historial de ejercicios y hojas: solo desde que se vincula, sin el texto de las tareas del tutor), qué se guardará (las hojas, solo con vínculo
    activo) y cómo quitarlo. Solo se puede aceptar si la huella del texto coincide con la publicada.
  - Al aceptar ("Entiendo y autorizo", opt-in) se crea el vínculo con `accepted_at`, `terms_version_id` y el
    nombre mostrado. Exige consentimiento vigente. El código no se reenvía: la búsqueda entrega un token de
    confirmación firmado (8 minutos) ligado a ese tutor, ese hijo, ese docente, su nombre y esa versión.
  - **Límite de intentos:** 5 códigos que no existen seguidos y el tutor queda bloqueado 15 minutos (429), por
    tutor. Un código que no existe, uno mal formado y uno de un docente sin perfil responden lo mismo (404).
    El docente no se entera de nada y el código no se registra en logs.
- **T26 Quitar:** lista de docentes vinculados al hijo; "Quitar" pide el PIN de nuevo (recién verificado) y una
  confirmación. Funciona aunque el perfil esté bloqueado. **No borra datos del niño ni sus hojas**: el docente
  solo deja de verlas. Si el docente cambió de nombre, se muestra el nombre con el que se vinculó.
- Quitar un vínculo solo se puede por el servidor (con el PIN): el tutor no puede borrarlo directo desde el
  cliente. Un acierto de código no reinicia el contador de fallos: se reinicia al crear el vínculo o tras 15
  minutos sin fallos.
- Endpoints (`/v1/students/{id}`): `POST /teacher-links/lookup`, `POST /teacher-links`, `GET /teachers`,
  `DELETE /teachers/{teacher_id}`.

### Administrador (AD1 a AD5)
El administrador gestiona **cuentas de adultos (docentes)**. Nunca ve datos de niños ni hojas, y cada
cambio suyo queda registrado (quién, qué, cuándo) sin datos personales de niños (`admin_audit`). Hoy registra
altas de docentes (`teacher_created`); AD4 y AD5 agregarán `teacher_updated` y `teacher_deleted`. Consultar la lista
no genera registro.
- **AD1 Iniciar sesión como administrador:** ruta propia (`/admin/login`) con correo y contraseña;
  llega a la lista de docentes. Su cuenta **no se crea desde la app**: la crea la empresa directamente en
  Supabase (`api/scripts/create_admin.py`, ver `docs/como-correrlo.md`). Credenciales incorrectas: se
  informa y puede reintentar; una cuenta válida que no sea de administrador recibe el mismo mensaje.
  **No hay ningún enlace al administrador dentro de la app**: se entra por la versión web escribiendo
  `/admin/login`. En cambio, el inicio de sesión del tutor tiene un enlace discreto "Acceso para docentes"
  (`/docente/login`) y esa pantalla un "Volver" al inicio de sesión del tutor.
- **AD2 Crear cuenta de docente:** el administrador escribe nombre (hasta 60), correo y contraseña
  inicial (mínimo 8). El sistema crea la cuenta (`POST /v1/admin/teachers`, con la llave de servicio y
  `app_metadata.role = teacher`) y genera el código de vínculo de 8 caracteres; la app muestra correo,
  contraseña y código **una sola vez** (con "Copiar") para que la empresa los entregue. La contraseña
  no se guarda en la base ni en logs. Pendiente (decisión): aviso de privacidad para el docente, cambio
  obligatorio de contraseña en el primer ingreso y canal de entrega definido. Reemplaza al antiguo CU-D1. Correo ya registrado: 409 y no se
  crea nada. Si falla el guardado del perfil tras crear la cuenta, se borra esa cuenta (503).
- **AD3 Consultar docentes:** lista de solo lectura (`GET /v1/admin/teachers`), orden alfabético, con
  nombre, correo y código; desde cada fila se puede editar o eliminar; sin docentes se ofrece crear el
  primero.
- **AD4 Editar docente:** cambia nombre y/o correo (`PATCH /v1/admin/teachers/{id}`); el código no cambia
  y se conservan los vínculos. El correo nuevo **rige de inmediato, sin correo de confirmación** (cambio
  hecho con la API de administración de Auth y `email_confirm`): el docente entra con el nuevo y no con el
  viejo, y se **cierran sus sesiones** (sus tokens de refresco dejan de servir; el token de acceso ya
  emitido vence solo). Correo usado por otra cuenta: 409 y no se cambia nada (se comprueba en la base antes de tocar
  Auth). Sin cambios: no se hace nada ni se registra. Si falla el guardado del nombre tras cambiar el
  correo, el correo se revierte. Queda registro `teacher_updated` en `admin_audit` (solo ids).
- **AD5 Eliminar docente:** pantalla de confirmación que explica qué se borra (la cuenta y sus
  vínculos) y qué no (datos de los niños y hojas); "Cancelar" no cambia nada. `DELETE
  /v1/admin/teachers/{id}` borra la cuenta de Auth (el perfil del docente y sus vínculos caen por
  cascada) y después registra `teacher_deleted`. Los perfiles, el progreso y las hojas de niños no se
  tocan. El docente deja de poder entrar; un token que conserve unos minutos recibe 403, porque
  `CurrentTeacher` comprueba que el perfil exista y `teacher_can_view` exige la cuenta.

### Docente (D2 y D3)
El docente no se registra desde la app: la empresa le entrega correo y contraseña.
- **D2 Iniciar sesión como docente:** ruta propia `/docente/login`. Credenciales incorrectas: se informa y
  puede reintentar. Una cuenta válida que no sea de docente recibe el mismo error y se cierra su sesión.
  Con rol docente llega a su inicio (`/docente`, protegido con `roleGuard('teacher')`).
- **D3 Consultar mi código de vínculo:** el inicio muestra el código de 8 caracteres (`GET /v1/teacher/me`)
  con botón "Copiar" y una explicación de que se lo entregue al tutor. El código no cambia. El resto del
  inicio es el menú de lo que vendrá (desactivado): el docente nunca ve datos de niños sin un vínculo
  activo.
- **Recuperar la contraseña:** el docente puede usar "recuperar contraseña" (`/recuperar`), que termina en
  el inicio de sesión del tutor; después entra por `/docente/login`.

### Casos de uso y orden de construcción
1. **Base y roles** (hecho): migración, trigger, `roleGuard`, dependencias por rol, pruebas de RLS.
2. **AD1, AD2 y AD3** (hecho).
3. **D2** entrada del docente; **D3** ver mi código (hecho). **AD4** editar y **AD5** eliminar (hecho).
4. **T24–T26** (hecho) el tutor vincula por código con PIN, confirmación del nombre y límite de intentos, ve
   y quita vínculos. *(T24 ya no es un interruptor: es el aviso previo.)*
5. **D4**, **D5**, **D7** y **T5** (hecho): alumnos vinculados, progreso por habilidad, historial del alumno
   (docente) e historial del hijo (tutor).
6. **T8** editar tareas asignadas; **T22** exportar CSV (neutralizando celdas que empiecen con `=`,
   `+`, `-`, `@`, tab o CR); **D6** evolución.
7. **T27 y D8** hojas guardadas.

### Datos y privacidad
- Tablas: `teachers` (nombre hasta 60, código, fecha; el correo solo en Auth) y `teacher_links`
  (docente, perfil, tutor, `accepted_at`, `terms_version_id`, `teacher_name`). RLS: el tutor lee y borra sus vínculos; el
  docente lee los suyos; solo el servidor inserta. Pruebas pgTAP de que otro tutor y otro docente no
  leen ni escriben.
- El docente es un **tercero** (Ley 21.719): inventario de datos, EIPD y textos legales lo reflejan
  (`docs/privacy/`).
- Revisores antes del PR: `privacy-cl-auditor`, `child-safety-ai-reviewer`, `security-reviewer`,
  `code-reviewer`, `scalability-reviewer`.

## Catálogo curricular: decisiones sobre el mapa (2026-10-27)

Base: `docs/MAPA_CURRICULAR_MATEMATICA_1A4.md` y `docs/habilidades_1a4_basico.csv`. Estas decisiones
ajustan el mapa; mientras no se edite el mapa, mandan las de aquí.

- **Regla de dominio nueva** (reemplaza "3 aciertos seguidos sube / 2 errores seguidos baja"):
  bloques de 10 ejercicios de una habilidad en un mismo nivel; con 8 o más aciertos sube de nivel,
  con 4 o menos baja, con 5 a 7 repite el nivel. Dominar el nivel 3 desbloquea la habilidad
  siguiente.
- **Sin alternativas ni teclado numérico especial.** El niño siempre escribe la respuesta a mano
  en la casilla de respuesta, apoyado en el papel para calcular. Las habilidades marcadas
  "alternativas" en el CSV se reformulan para que la respuesta sea un número.
- **Bloque de 10:** se va llenando aunque el niño cambie de día o salga de la app; se evalúa al
  llegar a 10 ejercicios de esa habilidad en ese nivel. Al cambiar de nivel empieza un bloque nuevo.
- **Fracciones: casilla de fracción.** Dos casillas apiladas (numerador arriba, denominador abajo),
  escritas a mano. El enunciado muestra fracciones apiladas con CSS propio (`app-math-text`; KaTeX no
  está instalado y no hizo falta agregarlo). El servidor acepta
  fracciones equivalentes (6/10 = 3/5); si acierta sin simplificar, Numi muestra la forma simple
  como dato extra, sin marcar error. Un ejercicio que pida simplificar exige la forma simple.
  Sirve para 4-10 y, más adelante, 3-13, 4-09, 4-11 y 4-13.
- **Reformulación de las habilidades "alternativas" de fase A** (respuesta = número escrito):
  - 1-03, 2-03, 3-03, 4-02 (comparar y ordenar): "¿Cuál es el número mayor/menor: a o b?" →
    escribe el número. Ordenar: "Ordena a, b y c de menor a mayor. ¿Qué número queda al medio?"
    (con 4 números: "¿cuál queda segundo?").
  - 2-16 (igualdad y desigualdad): N1 completar la igualdad hasta 10 (3 + 4 = □ + 2);
    N2 hasta 20; N3 "¿Cuánto le falta al lado menor para ser igual?" (9 + 6 y 8 + 4 → 3).

## Recuperar contraseña (T19)

Pantallas del ADULTO (el niño no tiene cuenta ni correo): `/recuperar` y `/nueva-clave`. Se llega desde "¿Olvidaste tu contraseña?" en el login.

### Reglas
- **Misma respuesta exista o no el correo**: la pantalla siempre dice "Si ese correo tiene una cuenta, te enviamos un enlace…". El puerto `requestPasswordReset` nunca lanza ni distingue (tampoco ante un 429). Pausa de 60 s en la pantalla.
- **El enlace** (en el correo) abre la APP: `<SiteURL>/nueva-clave?token_hash=…&type=recovery`. Dura **30 minutos** (`otp_expiry`) y sirve **una sola vez**. Abrirlo NO lo gasta: el código se canjea (`verifyOtp`) solo cuando la persona **pulsa el botón**, para que un escáner de correo que solo abra el enlace no lo consuma ni obtenga una sesión. El código se borra de la barra de direcciones al abrir.
- **Sesión de recuperación**: no cuenta como usuario autenticado (no abre el panel ni los perfiles) hasta que se cambie la contraseña. Si la persona se va o recarga a medias, esa sesión se cierra.
- **Contraseña nueva**: la misma regla que el registro (mínimo 8 caracteres; `password-rules.ts` en la app y `minimum_password_length` en Supabase). Al cambiarla se cierran las sesiones en TODOS los dispositivos y llega un aviso por correo.
- **Límites** (Supabase, `config.toml`): un correo de recuperación por usuario cada 60 s (`max_frequency`).

### Limitación conocida
El 429 por usuario de Supabase permite saber, llamando directo al endpoint público, si un correo tiene cuenta. La app no lo muestra. Pendiente para producción: captcha o proxy por la API (`docs/privacy/pendientes-legales.md`, 25).

### Local
El correo se ve en **Mailpit: http://127.0.0.1:54324** (`supabase start` lo levanta). Pruebas reales: `api/tests/test_integration_password_recovery.py`.

## Eliminar la cuenta y todos los datos (T21)

Se hace en el **Panel del tutor** (sección "Eliminar mi cuenta"), con el orden del ADR 0001, decisión 3. Ruta: `POST /v1/tutor/account/delete` con `{"confirm": "ELIMINAR"}`.

### Confirmación fuerte
- La app pide la **contraseña de la cuenta** (el PIN lo puede conocer un niño) y la palabra ELIMINAR (acepta minúsculas; al servidor se envía exacta). Vuelve a iniciar sesión con la contraseña: eso da una sesión "recién iniciada con contraseña".
- El servidor acepta SOLO la **contraseña** escrita hace menos de 5 minutos (claim `amr` del JWT). El PIN no vale para esto, ni siquiera uno recién escrito: lo puede conocer un niño. Sin contraseña reciente: 401 y no se toca nada.
- El id a borrar sale solo del JWT: no se puede borrar la cuenta de otro.

### Orden (si algo falla antes del paso 5, no se borra nada y se descongela)
1. **Congelar**: revoca el consentimiento (bloquea los perfiles; la revocación NO se deshace) y bloquea el acceso en Auth por 15 minutos (si algo falla y el desbloqueo también, se levanta solo).
2. Seudónimo del tutor (`tutor_ref` = HMAC-SHA256 del id con la clave del servidor). No se guarda ninguna huella del correo.
3. y 4. Archivar la evidencia mínima del consentimiento (dos veces, idempotente) y comprobar que cada consentimiento tiene su evidencia (por `source_seq`: sirve aunque la clave haya cambiado).
5. Borrar el usuario en Auth (borrado real). La cascada borra tutor, perfiles, progreso, rachas, tareas, uso, PIN y consentimientos.
6. Verificar que ya no queda el tutor (la evidencia ya se comprobó en 3 y 4: tras la cascada no quedan consentimientos contra los que contarla).
7. Purgar el registro de auditoría de Auth (correo e IP del tutor). Mejor esfuerzo.

Reintentar es seguro: si la cuenta ya no existe, el resultado es el mismo.

### Qué se conserva
Solo la evidencia mínima que exige la ley: seudónimo del tutor (HMAC del id), versión y huella de los textos aceptados, tipo de evento, canal y fechas; sin correo, nombre ni datos del niño; más la declaración del adulto de cada perfil sin apodo ni curso. **Plazo: 5 años (1826 días), provisional y sujeto a validación legal**, configurable en `app_settings.consent_evidence_retention_days`; cuenta desde `archived_at` (el día del borrado). Lo borra a diario la tarea de pg_cron `privacy-purge-evidence`; mientras Legal no lo confirme, `privacy_config_warnings()` lo avisa (`consent_evidence_retention_confirmed`). Ver `pendientes-legales.md`, 26 y 27.

### Pruebas
`supabase/tests/database/account_deletion.test.sql` (revisa DINÁMICAMENTE todas las tablas con `tutor_id` o `student_id`: si alguien agrega una tabla y olvida la cascada, falla), `api/tests/test_account.py` y `api/tests/test_integration_account_deletion.py` (cuenta real: no queda nada) y `supabase/tests/database/evidence_retention.test.sql` (plazo de 5 años, tarea de pg_cron y purga). Tras correr pruebas de integración, hacer `supabase db reset` antes de `supabase test db`: la evidencia es inmutable y algunas pruebas antiguas cuentan filas de toda la tabla.

## Revocar el consentimiento (T20)

Se hace en el **Panel del tutor** (sección "Revocar mi consentimiento"). Ruta: `POST /v1/tutor/consent/revoke`, con el PIN (token parental). Reutiliza `revoke_consent` (T21) y el bloqueo de perfiles que ya hacen los triggers de la base.

### Qué pasa al revocar
- **Desde ese momento no se usan datos del niño ni la IA:** todos los perfiles del tutor quedan bloqueados en la misma transacción, y `authorize_student_use` los rechaza (403 en ejercicios, práctica, tareas, progreso, informe y explicaciones).
- **Constancia con fecha:** un evento `revoke` en `consents` con la fecha-hora del servidor (`occurred_at`). La respuesta la devuelve y la pantalla `/terminos` la muestra. Revocar otra vez no crea otro evento y devuelve la fecha original.
- **Los datos NO se borran al instante:** quedan bloqueados `purge_after_days` días (hoy **30, provisional**, pendientes-legales 10) y luego los borra la tarea de pg_cron `privacy-purge-blocked`. Antes de eso el tutor puede borrarlos eliminando los perfiles o la cuenta (T21).
- **La evidencia mínima** (el evento de aceptación y el de revocación con fecha, versión y huella de los textos) sigue en `consents` mientras exista la cuenta; si se elimina la cuenta, se archiva y se conserva 5 años (T21, pendientes-legales 27).
- **El servidor comprueba el resultado** antes de afirmarlo: debe constar la revocación con fecha y 0 perfiles activos; si no, responde 503 sin decir que se hizo. Si la base falla a medias, el mensaje dice que *puede* estar hecha y que hay que entrar para comprobarlo.

### Alcance y límites conocidos
- Sin consentimiento, `/panel` no es accesible (guard de consentimiento). Por eso la pantalla `/terminos` ofrece también **eliminar la cuenta y los datos** (derecho de supresión), que no depende del consentimiento.
- **Aceptar los términos otra vez NO reactiva los perfiles bloqueados:** no hay ningún camino en la app que llame a `unblock_student`. La interfaz lo dice. Pendiente (pendientes-legales 28).
- Una explicación de IA que ya esté en curso cuando se revoca se corta en el siguiente re-chequeo del streaming (`stream_recheck_seconds`: 10 s por defecto, 60 como máximo), no al instante. Una respuesta de ejercicio que ya había pasado la autorización justo antes puede guardar su intento (sin verificar que las funciones de escritura vuelvan a mirar `blocked_at`).
- Solo se borran solos los perfiles bloqueados **por la revocación**. Los que ya estaban bloqueados antes (`tutor_request`, `arcop_claim`) no se purgan al revocar (decisión de Lote D; pendientes-legales 28). `profiles_blocked` cuenta todos los perfiles del tutor.
- Tras revocar no se puede borrar un perfil suelto desde la interfaz (`/panel` exige consentimiento); sí se puede eliminar la cuenta entera. La API de borrar perfiles no exige consentimiento (pendientes-legales 28).
- La constancia viaja por la dirección (`/terminos?revocado=…`): se puede falsificar con un enlace manipulado (solo muestra un aviso; no cambia datos). La fecha de borrado es una cota ("a partir del"): pg_cron corre una vez al día.
- La constancia con fecha solo se muestra justo después de revocar; no hay todavía una pantalla que la consulte después.

### Pruebas
`supabase/tests/database/consent_revocation.test.sql` (constancia, bloqueo, datos intactos, plazo, idempotencia, aislamiento entre tutores, solo `service_role`), `api/tests/test_consent_revocation.py` (PIN, constancia, fallos honestos, logs sin datos personales) y `api/tests/test_integration_consent_revocation.py` (cuenta real: antes funciona, después 403 en todo, los datos siguen y otro tutor no se ve afectado), más las pruebas de la app (`revoke-consent.component.spec.ts`, `http-consent-revocation.service.spec.ts`, `terms.page.spec.ts`).

## Diagnóstico inicial (CU-A2)

Ficha CU-A2 de los Anexos ("Realizar diagnóstico inicial", RF-04, extiende CU-A1). Decidido el 2026-11-12. Migración: `supabase/migrations/20261112100000_diagnostic_attempts.sql`.

### Qué es
Prueba corta y **opcional** que estima el nivel de entrada de una habilidad antes de la primera práctica. Se ofrece solo si la habilidad **no tiene intentos** (ni de práctica ni de diagnóstico). Si el niño no la hace o la abandona, parte en el nivel 1 y el motor de bloques de 10 sube o baja el nivel como siempre.

### Reglas
| Situación | Resultado |
|---|---|
| Prueba | Siempre 6 ejercicios: 2 de nivel 1, 2 de nivel 2 y 2 de nivel 3, en ese orden. No se corta aunque falle |
| Nivel de entrada | El nivel **más alto** en que acertó los 2 ejercicios; mínimo 1, tope 3. No se suma uno (acierta los niveles 1 y 2 y falla el 3 → nivel 2) |
| Dominio | El diagnóstico nunca deja la habilidad "dominada" |
| Termina | Se guardan los 6 intentos (`activity = 'diagnostic'`) y el nivel de entrada con el bloque vacío; la práctica (CU-A1) sigue en ese nivel. Ya no se vuelve a ofrecer |
| Abandona (cambiar de tema, salir, falla de red o prueba vencida) | **No se guarda nada**: la habilidad queda en nivel 1 y la prueba se puede volver a ofrecer |
| La habilidad ya tenía intentos al enviar | 409 `diagnostic_not_available`; la app sigue directo con la práctica |

Los intentos de diagnóstico **no cuentan** para el bloque de 10, las medallas, el gráfico y el informe del tutor, el progreso ni la racha de días (`list_attempts` y `list_recent_exercises` leen solo `activity = 'practice'`; el diagnóstico no pasa por `record_attempt`).

### Seguridad
- Los ejercicios los genera el mismo código determinista que la práctica. El nivel de cada paso lo fija el **servidor** (`step // 2 + 1`); el cliente solo dice qué paso pide.
- El token va firmado con un **dominio propio** (`diagnostic-token|`) y lleva el paso: un token de práctica no sirve en el diagnóstico ni al revés. Caduca a los 10 minutos.
- Las 6 respuestas se envían **juntas al final** (`POST /v1/students/{id}/diagnostic`). El servidor exige los pasos 0 a 5, cada uno una vez, todos de la misma habilidad y con su nivel, y corrige (fracciones equivalentes valen). `save_diagnostic` (solo `service_role`) guarda todo en una transacción, con el perfil bloqueado (`for update`) para que dos envíos no guarden dos diagnósticos.
- Mismas comprobaciones que la práctica (JWT, perfil del tutor, no bloqueado, consentimiento). No usa IA.

### UI y tono
- Oferta: "¿Hacemos una prueba corta?" y "Son 6 ejercicios para empezar en tu nivel. No importa si te equivocas.", con "Sí, probar" y "No, empezar a practicar".
- Durante la prueba: "Prueba corta: N de 6" (`aria-live`), la misma tarjeta, la misma casilla y el mismo papel para calcular. **No se dice si cada respuesta estaba bien** y no hay explicación de Numi, medallas ni marcador.
- Al final: "¡Listo! Empiezas en el nivel N" con las estrellas y "Empezar a practicar". Si no se pudo guardar: "Esta vez la prueba no se pudo guardar. Empiezas en el nivel 1." (Numi no se pone triste).

### Pendientes (no implementados; revisar)
1. **Caducidad.** Cada token vence a los 10 minutos y se comprueba al enviar las 6 respuestas. Si el niño tarda más de 10 minutos desde el primer ejercicio, la prueba no se guarda y parte en nivel 1.
2. **Enunciados repetidos.** Dentro del diagnóstico, los 2 ejercicios de un mismo nivel pueden salir con el mismo enunciado: el servidor no guarda estado entre pedidos.
3. **Regla literal.** Con la regla tal cual, fallar el nivel 1 y acertar 2 de 2 en el nivel 3 da nivel de entrada 3. Confirmar si es lo deseado.
4. **Racha de días.** El diagnóstico **no** suma a la racha (comentario inline en la migración, para revisarlo).
5. **Oferta.** `GET /topics` (`diagnostic_available`) usa la fila de `student_skill_progress` como señal de "sin intentos". `save_diagnostic` vuelve a comprobar los intentos exactos al guardar.
6. **Roles de cuenta.** Las reglas del encargo dicen que el administrador crea las cuentas de docente. CLAUDE.md dice "solo el tutor tiene cuenta" y el borrador del profesor (más arriba) dice registro con dominio del colegio. Hay que resolverlo antes del perfil docente.
7. **Presupuesto de estilos.** `practice.page.scss` quedó en 7,95 kB de 8 kB (límite de error del build). El próximo estilo de esa pantalla no cabrá.

### Pruebas
`supabase/tests/database/diagnostic.test.sql`, `api/tests/test_diagnostic.py`, `api/tests/test_supabase_gateway.py` (filtro `activity` y `save_diagnostic`), `http-practice.service.spec.ts` y `practice.page.spec.ts`.

## Evolución del progreso (CU-A23)

Ficha CU-A23 de los Anexos ("Ver la evolución de mi progreso", RF-43, extiende CU-A11). Lo pidió el profesor guía. Decidido el 2026-11-11. **Sin migración y sin datos nuevos**: es otra forma de mostrar los intentos de práctica que ya se guardan.

### Qué es
En "Mi progreso", el niño ve un gráfico de barras de las **últimas 8 semanas**. Cada barra muestra los ejercicios de esa semana y los aciertos de esos ejercicios. Así puede notar cómo avanza, sin compararse con otros niños.

### Reglas
| Situación | Resultado |
|---|---|
| Sin intentos | Se muestra lo de siempre ("Todavía no hay intentos…"); no aparece la sección |
| Menos de 5 ejercicios en las 8 semanas | "Aún hay pocos ejercicios para ver tu avance", sin gráfico. Es la misma regla de "pocos datos" del informe del tutor |
| 5 o más | Gráfico con la frase "¡Cada semana que practicas, aprendes más!" |

- **Semanas:** 8 periodos de 7 días que terminan "hoy", la fecha local del dispositivo validada a ±1 día como en la racha. Las semanas sin práctica aparecen con 0, como un hueco.
- **Intentos:** cuentan los de práctica y las tareas del tutor. **El diagnóstico inicial no cuenta**, porque `list_attempts` solo lee `activity = 'practice'`.
- **Fecha de cada intento:** la UTC. Un intento con fecha UTC de **mañana** cuenta como de hoy (`local_attempt_day`, misma tolerancia de ±1 día que la fecha del dispositivo). Sin esto, lo que el niño practica de noche en Chile (después de las 20–21 h ya es "mañana" en UTC) no aparecía en el gráfico. El ajuste también corrige los días practicados y las semanas del informe del tutor. Como no se guarda la zona horaria, un intento de la noche anterior puede caer un día después.

### Cómo está hecho
- `GET /v1/students/{id}/progress` (solo lectura, `AuthorizedStudentDep`, sin PIN porque es la vista del niño) agrega `weeks: [{start, total, correct}]`.
- La agrupación es `weekly()`, la misma del informe del tutor. Se movió a `api/app/weekly.py` para que la usen las dos rutas sin un import circular.
- La vista `student_daily_progress` que proponía el encargo **no existía**. Se decidió reutilizar `weekly()` en vez de crearla.
- La app reutiliza el gráfico SVG propio del panel del tutor (`core/charts/weekly-chart.component.ts`), sin librerías, con `[kid]="true"`. En modo niño el gráfico usa:
  - leyenda "Bien hechos" / "Ejercicios";
  - resumen para el lector de pantalla: "En las últimas 8 semanas hiciste N ejercicios. Esta semana hiciste X y te salieron bien Y.";
  - fechas de la tabla en palabras ("20 de octubre");
  - letra de 13 unidades (antes 10, unos 9 px reales en el teléfono).

  El panel del tutor conserva sus textos. En ambas vistas, la barra clara lleva un borde del color primario, porque el relleno solo contrastaba 1,2:1 con el fondo blanco (el mínimo para elementos gráficos es 3:1). Además, el gráfico ya traía:
  - `role="img"` con un resumen;
  - la leyenda;
  - el % escrito sobre cada barra, para no depender solo del color;
  - una tabla oculta para el lector de pantalla.

### Pendientes
1. **Ventana de 500 intentos** (la misma del informe): un niño con más de 500 intentos en 8 semanas vería incompletas las semanas más antiguas.
2. **Revisión de CU-A2:** las correcciones que propusieron los revisores siguen sin aplicar.
3. **Mejoras opcionales de la revisión de CU-A23, no aplicadas:**
   - cambiar el % sobre cada barra por "N de M";
   - no dibujar "–" en las semanas vacías;
   - un título sin "avanzando";
   - avisar en pantalla cuando la ventana de 500 intentos corta semanas;
   - que la prueba de integración se salte si la URL no es local;
   - desacoplar `progress.port` de `report.port`.

### Pruebas
- `api/tests/test_progress.py`: agrupación en 3 semanas, semanas vacías, límites de la ventana, fecha no creíble y aislamiento.
- `api/tests/test_integration_progress_evolution.py`: cuenta real con diagnóstico y 2 prácticas; la evolución cuenta solo las 2.
- `progress.page.spec.ts`: barras, tabla y ánimo; mensaje con 2 ejercicios; umbral de 5; sin comparaciones.
- `http-progress.service.spec.ts`.

## Usar la aplicación sin conexión (CU-A12)

Ficha CU-A12 de los Anexos ("Usar aplicación sin conexión", RF-18, RNF-06; la extiende CU-A13).
Diseño y decisiones: **ADR 0002** (opción A). Decidido e implementado el 2026-11-12. Migración:
`supabase/migrations/20261112120000_offline_batch_limit.sql`. CU-A13 (sincronizar) es otro encargo:
aquí los intentos solo quedan en una cola local.

### Qué es
Con conexión, al abrir la práctica de un perfil, la app descarga sola un **lote de ejercicios
firmados**. Sin internet, el niño practica con ese lote: la app corrige con la solución guardada y
**guarda cada intento en el dispositivo antes de mostrar el resultado**.

### Reglas
| Situación | Resultado |
|---|---|
| Lote | Habilidades del **curso** del perfil (sin repaso); por habilidad, 10 ejercicios en el nivel actual y 10 en cada nivel vecino. Unos 240 a 300 ejercicios y 100 a 125 kB |
| Vigencia | 7 días para responder; 14 días más de margen para sincronizar (CU-A13) |
| Descarga | Sola, al abrir la práctica con conexión, si no hay lote, quedan menos de la mitad, vence en menos de 2 días o alguna habilidad se agotó en su nivel. Máximo 5 por perfil y día (429), contadas solo si se entrega el lote. Dos aperturas seguidas comparten una descarga. El lote nuevo reemplaza al anterior |
| Sin conexión | Si el navegador cree que hay red, siempre se intenta en línea; el lote se usa solo si la petición falla por red (`navigator.onLine` no es la única señal). Aviso: "Estás sin internet. Puedes practicar con los ejercicios guardados." (no se muestra junto al aviso de "sin lote") |
| Disponible sin conexión | Inicio, "¿Quién practica?" (copia local de apodo y curso) y la práctica de las habilidades del lote. Sin diagnóstico, repaso, racha ni explicación de Numi. "Tareas de tu tutor" y "Mi progreso" se ven, pero al tocarlos dicen "Esto necesita internet. Cuando vuelva, aquí estará." |
| Corrección | Provisional, con la solución en hash. Correcto: "¡Correcto!" (y la forma simple de una fracción). Incorrecto: **solo "Casi."**, porque el dispositivo no conoce la solución |
| Nivel y bloque | Se calculan en el dispositivo con la misma regla de bloques de 10, solo para mostrar estrellas y "¡Subiste de nivel!". El nivel real lo recalcula el servidor al sincronizar (CU-A13) |
| Lote agotado (excepción de la ficha) | La baldosa dice "Sin ejercicios guardados" (1 rem) y al tocarla: "Ya hiciste todos los ejercicios guardados de este tema. Puedes elegir otro tema." |
| Cerrar sesión | Se oculta sin conexión: borraría los intentos sin enviar y dejaría al niño fuera de la app |
| Sin lote | "Para practicar sin internet, primero hay que conectarse una vez. Pide ayuda a un adulto." |
| No se pudo guardar el intento | No se muestra resultado: "No pude guardar tu respuesta. Intenta otra vez." |
| Vuelve la red | Al volver a la lista de temas, si el navegador cree que hay red, se intenta en línea; si responde, sale del modo sin conexión |

### Seguridad
- Token del lote con **dominio propio** (`offline-token|`, versión 5): no sirve para responder en
  línea ni en el diagnóstico, y los de práctica no sirven como lote. Va ligado al perfil y no lleva
  la respuesta.
- La solución viaja como `SHA-256(sal | forma canónica)`: no se lee a simple vista, pero **no es
  una barrera** (las respuestas son números chicos). Lo que cuenta lo corrige el servidor desde el
  token al sincronizar; el "acertó" del dispositivo se ignora. Riesgo aceptado (ADR 0002).
- `POST /v1/students/{id}/offline-batch`: mismas comprobaciones que la práctica
  (`AuthorizedStudentDep`). No usa IA. Si no puede leer el progreso, no entrega lote (503).
- Guards sin red: solo las rutas con `data: { offline: true }` y solo si hay copia local de
  perfiles de un tutor conocido, de menos de 7 días; en `/practica/:id`, el perfil debe estar en la
  copia y no estar en pausa. El servidor sigue sin caché (ADR 0001) y vuelve a comprobar todo al
  sincronizar.
- `consentGuard` distingue "sin consentimiento" (borra lo guardado y va a /terminos) de "no se
  pudo consultar" (no borra nada; solo rutas de práctica con la copia local).
- El service worker guarda solo los archivos de la app (sin `dataGroups`): nunca respuestas de la
  API ni de Supabase.

### Datos en el dispositivo
IndexedDB `numimath-offline`, sin cifrar: `profiles` (apodo, curso, en pausa), `batches` (lote) y
`queue` (intentos con la respuesta escrita del niño). Escritura con `durability: 'strict'`; el
resultado se muestra recién cuando la transacción terminó. Se borra todo al cerrar sesión o revocar
el consentimiento (también si se revocó en otro equipo y el dispositivo lo detecta con red), si
Supabase avisa que la sesión terminó (`SIGNED_OUT`) o si entra otro tutor; lo de un perfil, al
borrarlo, si el servidor responde 403 o si al recargar la lista ya no está o está en pausa. La
copia de perfiles vence a los 7 días. Lo vencido se purga al iniciar la app y cada vez que vuelve a
primer plano (`visibilitychange`), sin depender de la red: deja de usarse a los 7 días y se borra la
próxima vez que se abre la app. `navigator.storage.persist()` se pide solo en la web y desde
el panel del tutor. Ver `docs/privacy/inventario-datos.md`.

### Decisiones confirmadas (2026-11-12)
- Incorrecto sin conexión: **solo "Casi."**; la solución no se guarda de forma reversible.
- Racha sin conexión: **oculta**.
- Tareas y "Mi progreso" sin conexión: **"Esto necesita internet"** al tocarlos.
- Límite de descargas: **solo por perfil**.
- Lote viejo sin sincronizar: **aceptado hasta CU-A13** (ver pendiente 7).

### Pendientes (no implementados; revisar)
1. **Revocación sin red (decisión 8 del ADR):** un dispositivo sin red sigue practicando con su lote
   hasta conectarse (máx. 7 días). **Revisión pendiente de Adolfo y `privacy-cl-auditor`.**
2. *(Resuelto: solo "Casi.")*
3. *(Resuelto: racha oculta.)*
4. *(Resuelto: "Esto necesita internet".)*
5. **Manifiesto PWA:** no se agrega por ahora; se necesitan íconos de 192 y 512 px (recurso gráfico
   nuevo, con su crédito en `docs/creditos-recursos.md`). Sin él no se puede "instalar" la app y
   Safari/iOS puede borrar los datos de un sitio tras 7 días sin uso.
6. **Tope por tutor:** la duda queda comentada en la migración para Adolfo.
7. **Antes de CU-A13 (aceptado):** renovar el lote con intentos en cola muestra el nivel del servidor
   (sin esos intentos). Cerrar sesión con intentos sin enviar los pierde (el aviso es parte de CU-A13).
7b. **Escritura por respuesta:** cada respuesta reescribe el lote completo (~190 kB) para marcar un
    ejercicio usado; escribir solo el intento queda pendiente (`scalability-reviewer`). Tampoco hay
    gzip en la API ni regla de bloques compartida (tres lenguajes).
7d. **Solo para que lo sepa el dueño:** al subir a `privacidad-prov-2`, el primer acceso con red pide
    de nuevo el consentimiento (`missing`) y **borra lote y cola en todos los equipos**, incluidos
    intentos sin enviar (CU-A13 aún no existe). La purga y el borrado por dueño o pausa se prueban
    solo con `MemoryOfflineStore`: probar IndexedDB real requeriría una dependencia de desarrollo
    nueva (p. ej. `fake-indexeddb`), que no se agregó.
7c. **Política de privacidad:** el párrafo sobre el guardado local va en un cambio aparte, que sube
    la versión de la política y obliga a pedir de nuevo el consentimiento.
8. **Copia de perfiles cuando la base no responde:** si `list()` falla por cualquier motivo (no solo
   red) y hay copia local, se muestra la copia con el aviso de sin conexión.
9. **Presupuestos de estilos:** `practice.page.scss` (7,95 de 8 kB) y `profiles.page.scss` siguen
   sobre el aviso de 4 kB (ya lo estaban). Los estilos nuevos van en `app-offline-notice` y en las
   baldosas.
10. **Revisores antes del PR:** se corrieron los cinco el 2026-11-12; sus hallazgos se corrigieron
    (ADR 0002, "Revisión antes del PR"). Lo que quedó abierto está en los puntos 1, 5, 6 y 7b.

### Requisitos para CU-A13 (de la revisión de seguridad; implementados, ver sección CU-A13)
- El margen de 14 días para sincronizar debe ser un parámetro de `verify` que exista **solo** con
  `offline=True`: nunca alargar la caducidad de los tokens de práctica ni de diagnóstico.
- El servidor toma el perfil de la ruta (`AuthorizedStudentDep`), el nivel y el tema **solo del
  token**, e ignora `correct`, `level` y `topic` que mande el cliente. Se mantiene la regla de
  `record_attempt`: un intento con nivel distinto al del progreso no cuenta para el bloque.
- `answered_at` y `local_date` se acotan a `[emisión, min(caducidad, ahora)]`.
- Cada intento va por su propio perfil (sin endpoints de lote que mezclen perfiles).
- Al renovar el lote con intentos en cola, el progreso que se ve no debe retroceder.
- Al entrar CU-A13, actualizar las declaraciones de Data safety (Google) y Privacy Nutrition Label
  (Apple) por la sincronización de la cola.

### Pruebas
- Servidor: `api/tests/test_offline_batch.py` (contenido, 10 por nivel, vigencia, hash = solución
  regenerada, filtro RNF-10 en los 4 cursos, dominio propio, manipulación del token, acceso, límite
  diario, logs sin datos) y `test_supabase_gateway.py` (`consume_offline_batch`).
- Base: `supabase/tests/database/offline_batch_limit.test.sql` (permisos, límite, perfil ajeno, RLS).
- App: `offline-grading.spec.ts` (hash igual al de Python, fracciones, regla de bloques con los casos
  de `test_levels.py`), `offline-practice.service.spec.ts` (lote agotado, guardado antes de mostrar,
  fallo al guardar, manipulación del lote local, renovación, 403, purga), `http-offline-batch.service.spec.ts`,
  `practice.page.spec.ts` y `profiles.page.spec.ts` (modo sin conexión simulado; tareas y "Mi progreso"
  avisan "Esto necesita internet"), y guards.
- Manual (2026-11-12, Chromium con Playwright, compilación con service worker): sin red la app abre,
  muestra el aviso y las habilidades del lote; tras responder y **cerrar la pestaña a la fuerza**, el
  intento sigue en la cola de IndexedDB (RNF-06).

## Sincronizar progreso al recuperar la conexión (CU-A13)

RF-19, RF-25. Envía al servidor los intentos que CU-A12 dejó en la cola del dispositivo. El
servidor es la fuente de verdad: vuelve a corregir y recalcula nivel, bloque y racha.

### Reglas
| Tema | Regla |
|---|---|
| Endpoint | `POST /v1/students/{id}/offline-sync`, **uno por perfil** (no se mezclan perfiles). `AuthorizedStudentDep`: JWT del tutor, perfil suyo, no bloqueado y con consentimiento. Un perfil bloqueado o borrado responde 403 y los demás se sincronizan igual |
| Tamaño del lote | **15 intentos por petición** (422 si vienen más). Motivo: el cuerpo de toda petición tiene un tope de 8 KB (`max_body_bytes`, no se tocó) y un intento pesa hasta ~410 bytes. La base tiene un tope de defensa de 100 |
| Qué se usa del cliente | Solo `id` (del dispositivo, para informar el estado), `token`, `answer`, `answer_den`, `answered_at`, `local_date` y `duration_s`. `correct`, `level` y `topic` se ignoran: tema y nivel salen del token y la respuesta se corrige otra vez |
| Tokens | Solo del lote (dominio `offline-token|`, v5), ligados a ese perfil. Margen de **14 días** tras la caducidad, que existe solo con `offline=True` (un token de práctica o de diagnóstico nunca lo recibe) |
| Hora y fecha | `answered_at` se acota a `[emisión, min(caducidad, ahora)]`; la fecha local, a la vida del token ±1 día, y debe calzar con la hora del intento. Tiempo sobre 600 s: sin tiempo |
| Orden | El servidor aplica los intentos **en orden cronológico** sobre el progreso actual (una sola llamada a la base, `record_offline_attempts`, que pasa cada intento por `record_attempt`: la misma regla del bloque de 10) |
| Duplicados | El `jti` del token es único por perfil (`student_attempts_once`). Reenviar el mismo lote, o enviarlo dos veces a la vez, no cambia nada (`duplicate`). Un token ya respondido en línea no entra como sin conexión (otro dominio de firma) |
| Racha | Por día local; solo días posteriores al último registrado (no se rellenan días hacia atrás, igual que en línea) |
| Resultado por intento | `accepted`, `duplicate` o `rejected` (token inválido, vencido tras el margen o de otro perfil). Los tres son definitivos: la app los quita de la cola. Cada rechazo deja un evento `offline_sync.rejected` con solo un código (contador sin datos del niño) |

**Nivel que ya no coincide.** Si otro equipo practicó en línea mientras tanto y el nivel de la
habilidad cambió, un intento sin conexión cuyo nivel (firmado en el token) ya no coincide con el del
servidor **se guarda pero no cuenta para el bloque** (regla actual de `record_attempt`). Duda inline
en la migración para Adolfo: ¿se acepta así o se quiere rehacer el historial completo?

### App
- **Cuándo sincroniza:** al volver la red (evento `online`), al abrir la app, al volver a primer
  plano y antes de renovar el lote. En la práctica con red, **antes de leer** nivel y racha, así lo
  que se ve ya incluye lo hecho sin conexión.
- **Lotes secuenciales:** por perfil, del intento más antiguo al más nuevo, de a 15, **uno tras
  otro** (nunca en paralelo), esperando la respuesta de cada uno y con una pausa corta (300 ms)
  entre lotes. Candado de una sola sincronización por perfil.
- **Fallas:** sin red, 5xx, 429, sesión o respuesta rara → se detiene ese perfil sin saltarse lotes;
  lo no confirmado queda en la cola y se reintenta **desde el lote que falló** con espera creciente
  (2 s, 4 s, 8 s… hasta 5 min) mientras la app esté abierta. 403/404 (perfil bloqueado o borrado)
  → definitivo: se borra lo de ese perfil del dispositivo.
- **Aviso:** si con red no se pudo enviar, "Tus ejercicios sin internet se enviarán más tarde.
  Puedes seguir practicando." El niño sigue practicando en línea.
- **El progreso visible no retrocede:** con intentos sin enviar **no se renueva el lote** (el nuevo
  traería el nivel del servidor sin esos intentos). Se renueva cuando la cola queda vacía.
- **Con red, sincronizar antes de purgar:** al iniciar la app y al volver a primer plano, si hay red
  primero se envía la cola y después se purga lo vencido. Sin red, la purga sigue la política
  (`privacidad-prov-2`) sin cambios.

### Revisión antes del PR (2026-11-13)
Revisores: `code-reviewer`, `security-reviewer`, `scalability-reviewer` y `privacy-cl-auditor`
sobre `13834dd..604b2f2`. Corregido (decisiones del dueño en **negrita**):
- **Un intento fuera de rango ya no hace fallar el lote (422):** el endpoint acepta los mismos
  topes que el teclado de la app (respuesta de 7 dígitos, denominador de 4) y decide por intento
  (denominador 0 → `rejected` solo ese). La app sigue tratando todo 4xx como temporal.
- **La práctica espera la sincronización como máximo 3 s:** si no alcanza, muestra los temas con el
  aviso "se enviarán más tarde" y el envío sigue en segundo plano (`syncWithin`).
- Tiempo máximo de 15 s por petición de sincronización (vence = sin red, se reintenta).
- La purga espera la sincronización previa como máximo 20 s: con la red colgada, lo vencido se
  borra igual (lo que dice la política).
- Reintentos repartidos al azar entre la mitad y el total de la espera (sigue 2 s…5 min) y 0–2 s
  al azar al volver la red, para que muchos equipos no lleguen juntos.
- `record_attempt` recibe la hora del intento (una sola escritura, sin UPDATE posterior) y la
  sincronización bloquea primero la racha y luego la habilidad, como en línea (sin deadlock).
- Inventario (tiempos y hora del dispositivo, historial) y EIPD 0.4.

### Pendientes (no implementados; revisar)
1. **(5) Aviso al cerrar sesión con intentos sin enviar:** hoy "Cerrar sesión" con red borra la cola
   sin avisar (sin red ni se ofrece). La ficha no lo pide.
2. **(6) Límite de frecuencia del endpoint:** fuera del tamaño del lote (15) y el JWT, no hay tope
   diario de sincronizaciones por perfil o tutor.
3. **Nivel que ya no coincide:** decidir con Adolfo si basta la regla actual (ver arriba).
4. **Cambio de versión de la política:** al volver a pedir el consentimiento (`missing`) se borra la
   cola, incluidos intentos sin enviar. Podría sincronizarse antes de borrar, pero sin
   consentimiento vigente el servidor los rechaza (403). Decidir con Legal (pendientes-legales, 29.4).
5. **Mismo `jti` dos veces en una petición:** ambos se informan como `duplicate` aunque uno se haya
   registrado (ambos salen de la cola; sin efecto en el progreso).
6. **Data safety y Privacy Nutrition Label:** actualizar las declaraciones de las tiendas, ahora que
   la cola se envía al servidor.
7. **Reintentos solo con la app abierta:** sin plugin de tareas en segundo plano (no se agregaron
   dependencias); se retoma al abrir la app o al volver a primer plano.
8. **Hallazgos bajos de la revisión (no implementados):**
   - Un log por intento rechazado (hasta 15 por petición): podría pasar a un solo evento por
     petición con un contador (hoy `ALLOWED_FIELDS` no tiene un campo numérico).
   - `touch_student_activity` es una llamada más a la base por petición; podría ir dentro de
     `record_offline_attempts`.
   - `queuedStudents()` (IndexedDB) lee los intentos completos para sacar los perfiles; podría
     recorrer solo el índice (`openKeyCursor`). La variable se llama `keys` aunque son filas.
   - Los reintentos no respetan `Retry-After` (importará con el pendiente 2).
   - La función de la base no vuelve a comprobar bloqueo y consentimiento en la misma
     transacción (lo hace FastAPI justo antes, igual que la práctica en línea).
   - **Requiere decisión del dueño / Legal:** si el tutor pausa un perfil y lo reactiva antes de
     que un equipo sin red se conecte, los intentos hechos durante la pausa se guardan al
     sincronizar (pendientes-legales, 29). Lo mismo si algún día se permite reactivar tras revocar.
   - La política `privacidad-prov-2` no dice qué guarda el servidor al recibir la cola (tema, si
     acertó, hora y tiempo; la respuesta no): agregarlo en la próxima versión, sin versión solo por
     esto.
   - Mismo token dos veces en una petición (punto 5) y la duda para Adolfo solo en la migración
     (punto 3 la repite aquí).

### Pruebas
- Servidor: `api/tests/test_offline_sync.py` (corrección en el servidor, valores manipulados, hora y
  fecha acotadas, orden cronológico, racha, duplicados, envíos simultáneos, token de práctica,
  lote parcial, margen de 14 días, perfil ajeno, bloqueado y borrado, tamaño, falla de la base, una
  llamada por lote, logs) y `test_supabase_gateway.py` (`record_offline_attempts`).
- Base: `supabase/tests/database/offline_sync.test.sql` (permisos, orden, hora, duplicados, token ya
  respondido, racha, perfil ajeno, tamaño, RLS) y `supabase/tests/concurrency/run.sh`, escenario D
  (dos conexiones reales con el mismo lote: cada intento una vez, el bloque cuenta 5 y no 10).
- App: `offline-sync.service.spec.ts` (éxito, cola vacía, definitivos, más de 15 intentos en varios
  lotes en orden y con pausa, nunca dos lotes a la vez, falla a mitad y reanuda desde ahí, sin red,
  espera creciente, tope de 5 min, 403, candado, todos los perfiles, evento `online`),
  `http-offline-sync.service.spec.ts`, `offline-purge.spec.ts` (sincronizar antes de purgar),
  `offline-practice.service.spec.ts` (no renueva con cola) y `practice.page.spec.ts` (envía antes de
  leer el progreso; aviso sin culpa).

## Recibir notificación de racha (CU-A9)

RF-10, ADR 0003. Recordatorio **local**, **opcional** y **apagado por defecto**, que solo el tutor
activa por perfil en el panel (con PIN vigente). No hay servidor de notificaciones ni push.

### Reglas
| Tema | Regla |
|---|---|
| Activar | Panel del tutor → "Recordatorio de racha" por perfil **y por equipo**. Al activarlo se pide el permiso del sistema ahí mismo; si el adulto lo niega, no se guarda y se le explica. El equipo guarda "activado aquí" (ligado al tutor de la copia local); sin eso no programa avisos aunque el servidor diga sí. Si está activo en otro equipo, el panel lo dice. Un perfil en pausa no se puede cambiar |
| Guardar | `PUT /v1/students/{id}/streak-reminder` con el token del PIN (`ParentalStudentDep`) → `set_streak_reminder` (solo `service_role`). El cliente no puede escribir `students.streak_reminder`. La copia local de perfiles guarda el sí o no para reprogramar sin internet |
| Aviso | **Uno por dispositivo y por día**, a las **18:00** (hora fija). Texto: "Numi tiene ejercicios listos para practicar un ratito." (título "NumiMath"). Sin apodo, sin decir quién no practicó, sin culpa, sin emoji. Textos en `core/reminders/streak-reminder.messages.ts` |
| Cuándo | 18:00 de hoy si aún no pasa; si ya pasó, o si se sabe que todos los perfiles con recordatorio ya practicaron hoy, 18:00 de mañana. Se programa **solo el próximo aviso** (nunca una serie) |
| Reprogramar | Al abrir la app, al volver a primer plano, al cargar "¿Quién practica?" (con la racha del servidor), tras cada respuesta (con o sin red) y cuando cambia lo guardado sin conexión |
| Cancelar | Si se desactiva en todos los perfiles (desactivar lo apaga en el servidor y en cada equipo al recargar), al cerrar sesión, si entra otro tutor, al revocar el consentimiento, si el perfil se borra o se pausa, o si la purga elimina la copia local (vencida a los 7 días) |
| Al tocarlo | Abre "¿Quién practica?" |
| Web/PWA | No se ofrece: "Disponible en la app del teléfono o tablet" |
| Sistema | Respeta "no molestar". Android: canal de importancia normal, alarma inexacta (`isExactNotification: false`), permiso `POST_NOTIFICATIONS` (13+); quitar `SCHEDULE_EXACT_ALARM` del manifiesto al crear el proyecto Android. iOS: autorización del sistema (alerta, sonido y número sobre el ícono) |

### Limitaciones conocidas
- En Android el aviso puede llegar **tarde** (alarma inexacta; en reposo profundo, más que unos
  minutos).
- Al **reiniciar el teléfono** el plugin restaura el aviso y, si su hora ya pasó, lo muestra de
  inmediato (podría verse tarde, incluso de noche). Comprobar en un equipo real.
- Con varios perfiles, el aviso es uno para el equipo: si un niño practicó y otro no, igual llega.
- La activación es por equipo: en otro equipo del tutor hay que activarlo también desde su panel.

### Pendientes (no implementados; revisar)
1. Elegir la hora del aviso en el panel (hoy 18:00 fija).
2. Crear los proyectos nativos (`npx cap add android` / `ios`) y probar en dispositivo real
   permisos, "no molestar", reinicio y el toque del aviso.
3. Un perfil en pausa no se puede desactivar desde la API (exige perfil usable); igual no recibe
   avisos. Duda inline en la migración para Adolfo.
4. **Política `privacidad-prov-3` (no se sube ahora; decisión del dueño):** se revisó
   `privacidad-prov-2` y la EIPD y no hay contradicción con el recordatorio. La próxima versión debe
   incluir en una sola vez: (1) el párrafo del recordatorio local (opcional, activado por el tutor
   por equipo, sin envío de datos del niño, texto genérico, preferencia sí/no guardada en el servidor
   por perfil) y (2) lo que el servidor guarda al recibir la cola de CU-A13. Pregunta a Adolfo y
   Legal: ¿es un cambio sustancial que exige nuevo consentimiento? (pendientes-legales, 30).
5. **Decisiones pendientes del dueño:** usar `allowWhileIdle` o descartar avisos vencidos (aviso
   tardío tras reposo o reinicio); cambiar el nombre visible a "Recordatorio para practicar" (la
   revisión de privacidad y de seguridad infantil lo sugiere por ser "racha" una mecánica de
   enganche).
6. **Bajos de la revisión (no implementados):** apagar `streak_reminder` al bloquear o revocar (hoy,
   al desbloquear, vuelve solo); ver y desactivar desde la web; que `set_streak_reminder` compruebe
   también en SQL que el perfil no esté en pausa; el arreglo de oyentes de `onChange` no permite
   darse de baja; la migración no anota cómo revertirse.
7. **Bajos de la segunda revisión (no implementados):** el mensaje de permiso negado dice
   "teléfono" (debería decir "equipo"); `aria-busy` está en el `<input>` (mejor en el contenedor);
   al tocar el aviso con la sesión del PIN abierta no se cierra (ya ocurría antes); "¿Quién
   practica?" reprograma como información nueva aunque falle la lectura de algún perfil; al
   activar se reprograma tres veces seguidas (en fila, sin efecto visible); `cancel()` se llama
   aunque nadie lo haya activado; `schedule` cancela antes de reemplazar; cada interruptor lee la
   lista local por su cuenta; comprobar en equipo real si la navegación desde el aviso corre fuera
   de NgZone.
8. **Antes de publicar (fuera de CU-A9):** `capacitor.config.ts` tiene el `appId` y `appName` de la
   plantilla; ícono de silueta para el aviso en Android (ADR 0003).

### Pruebas
- Servidor: `api/tests/test_streak_reminder.py` (con y sin PIN, perfil ajeno, en pausa, sin
  consentimiento, cuerpo inválido, falla de la base, log sin datos, RPC).
- Base: `supabase/tests/database/streak_reminder.test.sql` (columna apagada por defecto, el cliente
  no la escribe, función solo `service_role`, perfil ajeno, RLS de otro tutor).
- App: `streak-reminder.service.spec.ts` (hora, un aviso, texto, quién practicó, pausa, web,
  cancelaciones, copia vencida, toque, activar con y sin permiso, PIN vencido) y
  `streak-reminder-toggle.component.spec.ts`.

## Jugar un juego de refuerzo (CU-A21), parte 1: base en el servidor

RF-41. Juegos para **1° y 2° básico**, generados por código determinista y corregidos en el
servidor como la práctica (la IA no participa). Esta parte es solo el servidor; la app es la parte 2
y las figuras SVG propias, la parte 3.

### Reglas
| Tema | Regla |
|---|---|
| Tipos | `choice` (de 2 a 4 opciones; el niño toca una) y `order` (tarjetas que el niño deja en el orden pedido) |
| Opciones | Identificadores de texto estables con su tipo: `n:7` (número), `e:manzana-3` (emoji), `s:mayor` (símbolo). La app muestra `label`; el servidor compara ids. En la parte 3 se agregan figuras SVG propias con otro prefijo sin cambiar el formato |
| Catálogo | Registro en código (`api/app/exercises/games.py`): id, nombre, eje, curso, tipo y habilidad del catálogo curricular (no se inventan códigos). Hoy 9 juegos: ejes "Números y operaciones" y "Patrones y álgebra" |
| Firma | Token con dominio y versión propios (`game-token|`, v6): no sirve para la práctica, el diagnóstico ni el lote sin conexión, y al revés. Firma juego, habilidad, tipo y opciones en el orden en que se muestran. **La solución nunca viaja antes de responder**: el servidor la regenera desde la semilla |
| Respuesta | `choice`: un id de las opciones. `order`: todas las tarjetas, cada una una vez. Otra forma: 422. Se responde una sola vez (`jti` único, 409). Firma alterada o vencido: 422 |
| Mensajes | Sin culpa: "¡Muy bien!", "Casi. Esta era la respuesta.", "Casi. Así quedaba el orden." La respuesta correcta se devuelve **solo después** de responder |
| Quién juega | Perfil del tutor, no pausado, con consentimiento (`AuthorizedStudentDep`) y de **1° o 2°** (curso leído de la base; si no, 403 `game_grade_not_allowed`) |
| Registro | `student_attempts` con `activity = 'game'` y `game_kind` = id del juego |
| Racha y medallas | Suma a la racha diaria. Las medallas las cuenta la app (aciertos seguidos) |
| Bloque y nivel | **No**: los juegos no aplican la regla del bloque de 10 ni cambian el nivel (decisión del dueño: las opciones se aciertan al azar con facilidad e inflarían el progreso) |
| Progreso, informe, gráfico | No incluyen juegos (leen solo `activity = 'practice'`) |

### Endpoints
- `GET /v1/students/{id}/games`: juegos del curso, agrupados por eje.
- `POST /v1/students/{id}/games/{game_id}/exercise`: un ejercicio (sin la solución).
- `POST /v1/students/{id}/games/answer`: corrige y registra el intento.

### Base de datos
Migración `20261115100000_game_attempts` (idempotente): `student_attempts_activity_check` admite
`game`; columna `game_kind` (obligatoria en juegos, nula en lo demás, formato `^[a-z0-9-]{1,40}$`);
`record_attempt` recibe `p_activity` ('practice' por defecto) y `p_game_kind` (se borra y recrea por
el cambio de firma; solo `service_role`). La siguen usando igual la práctica en línea y
`record_offline_attempts` (CU-A13); el diagnóstico no la usa.

### Coordinación con Adolfo (pendiente)
1. **"Cierre del esquema" de Adolfo:** esta rama NO crea tablas de docentes ni de hojas de cálculo.
   Adolfo debe quitar esa parte de su cierre del esquema (son suyas y van en su rama), y considerar
   que `activity` ahora admite `game` y existe `game_kind`.
2. **Historial del tutor (CU-T5, rama de Adolfo):** debe mostrar los intentos de juego **rotulados
   como juego** (con el nombre del juego según `game_kind`). Hoy las lecturas filtran
   `activity = 'practice'`; coordinar con él cómo incluirlos sin que entren al progreso ni al informe.

### Revisión antes del PR
Revisores `code-reviewer`, `security-reviewer` y `scalability-reviewer` sobre `main..e98fb18`.
Corregido en `fix(cu-a21)`:
- (alta) Jugar ya no impide el diagnóstico inicial: `save_diagnostic` no cuenta los intentos de
  juego (migración `20261115110000_game_diagnostic_fix`, con pgTAP).
- (media) La migración toma menos bloqueo: `lock_timeout` de 5 s y CHECK `not valid`, validados en
  la migración siguiente.
- (media) Índices parciales `where activity = 'practice'` para las lecturas frecuentes de práctica.
- (media) La respuesta verifica el token antes de leer el curso (un token inválido no va a la base).
- (media) Pruebas: invariantes de los 9 juegos con 500 semillas, cada juego en una habilidad del
  catálogo con su curso y eje, lo sincronizado sin conexión queda `practice`, otro tutor no puede
  insertar intentos.

### Decisiones del dueño (de la revisión, 2026-11-12)
1. **Volumen de intentos de juego:** plazo propio de **90 días** para `activity = 'game'` en la
   purga programada (`purge_old_game_attempts`, pg_cron `privacy-purge-games`, migración
   `20261115120000_game_attempts_retention`). No toca práctica ni diagnóstico. **Sin tope diario**
   (pendiente). ADR 0004.
2. **Leer el curso al responder:** se deja como está.
3. **Varios ejercicios por petición:** no se agrega.
4. **ADR 0004:** plazo de 90 días, estabilidad de generadores (un juego publicado no se edita: id o
   versión nueva) y orden de despliegue. `api/tests/test_games_golden.py` guarda las salidas de los
   9 juegos y detecta si un generador cambia.

### Pendientes
1. App de los juegos (parte 2) y figuras SVG propias (parte 3, con su crédito en
   `docs/creditos-recursos.md`).
2. Los juegos no tienen nivel propio: todos usan rangos fijos por curso.
3. **Tope diario de intentos de juego por perfil** (no implementado; hoy rige solo el plazo de 90
   días).
4. **Optimizaciones no adoptadas:** no leer el curso al responder (el token ya fija el juego);
   pedir varios ejercicios por petición (p. ej. 5 tokens) en la parte 2.
5. **Bajos de la revisión (no implementados):** validación y corrección de la respuesta en
   `games.py` (probables sin HTTP); constante para el nivel 1 de los juegos; `GAME_GRADES`, eje y
   curso derivados del catálogo curricular; tipos `Literal` duplicados entre `games.py` y la ruta;
   `_sign` con tres banderas excluyentes (mejor pasar el dominio); límites `token ≤ 1000` y
   `answer ≤ 6` a revisar en la parte 3; el upsert de la racha y `touch_student_activity` escriben
   en cada respuesta; sin interruptor para apagar juegos ni métrica de volumen; `GET /games` sin
   `Cache-Control`.
6. **Para CU-T5 (Adolfo):** en los juegos de opción, `exercise` guarda el enunciado genérico sin las
   opciones; el nombre del juego vive en Python (si el historial lee por RLS, tendría que duplicar
   la tabla id → nombre). Si su cierre del esquema recrea `student_attempts_activity_check` sin
   `'game'`, rompe los juegos (lo detecta `game_attempts.test.sql`).

### Pruebas
- Servidor: `api/tests/test_games.py` (catálogo por eje y curso, curso no permitido, perfil en
  pausa, sin solución en el ejercicio ni en el token, por tipo: correcta, incorrecta, repetida,
  vencida, firma alterada y opciones cambiadas; token de práctica y de juego no intercambiables;
  forma inválida; registro como `game` con su juego; suma a la racha sin tocar bloque ni nivel;
  falla de la base; el gateway solo agrega los parámetros nuevos en juegos).
- Base: `supabase/tests/database/game_attempts.test.sql` (restricciones, juego sin `game_kind`,
  `record_attempt` solo practice/game, racha sí y bloque/nivel no, práctica igual, CU-A13 sigue
  funcionando y queda `practice`, jugar no impide el diagnóstico, índices parciales, permisos, RLS
  de lectura y escritura). Concurrencia (`run.sh`) sin cambios, en verde.

## Jugar un juego de refuerzo (CU-A21), parte 2: componentes de la app

Pantalla `juegos/:id` y dos componentes reutilizables, para 1° y 2° básico, pensados para 360 px.
Usa los endpoints de la parte 1 sin cambiar el servidor.

### Flujo
1. En la práctica, la tarjeta **"Jugar"** aparece solo si el curso del perfil (deducido de sus
   habilidades propias, sin otra llamada) es 1° o 2° y hay conexión. Si no se puede deducir, no
   aparece. Si el servidor igual responde 403 de curso: "Estos juegos son para 1° y 2° básico.
   ¡Puedes seguir practicando!".
2. Elegir eje → elegir juego → instrucción corta de Numi (sin voz; CU-A20 no está construido).
3. **5 rondas**: opciones (un toque responde) u orden (tarjetas + "Listo"). Corrige el servidor; el
   mensaje es el suyo (sin culpa) y la respuesta correcta se muestra solo después.
4. Resumen: "Jugar de nuevo", "Otro juego" o "Volver a practicar".

### Reglas
- Sin nivel ni progreso. Suman a la racha (en el servidor; la pantalla no la muestra) y a las
  medallas (en la app: 5 aciertos seguidos, `core/practice/medals.ts`, como la práctica).
- Sin internet no funcionan y no entran al modo sin conexión (ruta sin `offline: true`): "Para jugar
  hace falta internet. Pide ayuda a un adulto." con "Intentar otra vez" (reenvía la misma respuesta
  si se perdió la red al responder). Si el niño sale a medias, lo respondido ya quedó registrado.
- Sin cronómetros. Textos en `core/games/games.messages.ts`.
- **Opciones táctiles** (`app-choice-options`): botones de 88 px de alto en 2 columnas, con
  `aria-pressed` y etiqueta resumida ("3 manzanas", "mayor que"); tras corregir, cada estado lleva
  ícono y texto ("✓ Esta era", "• Tu elección"), no solo color.
- **Ordenar con tarjetas** (`app-order-cards`): tocar pone la tarjeta en el primer lugar libre y
  tocarla otra vez la saca (forma principal); **arrastre propio con Pointer Events** como
  alternativa (dedo y mouse, sin librerías); teclado: Enter/Espacio pone o saca, flechas la mueven
  de lugar; aviso cortés para el lector de pantalla ("Pusiste 7 en el lugar 2"). Admite lugares ya
  ocupados y fijos (para completar).
- Emoji repetidos del enunciado: `aria-hidden` y un resumen accesible ("7 manzanas").
- Animaciones suaves que respetan "reducir movimiento".

### Revisión antes del PR
`code-reviewer` y `child-safety-ai-reviewer` sobre `main..e195711`. Sin altos ni bloqueantes de
tiendas. Medios corregidos en `fix(cu-a21)`:
- Tras un arrastre sin "click" del navegador, el próximo toque ya no se pierde.
- Una respuesta con forma rara del servidor ya no se muestra como "sin internet".
- El aviso de "ya respondido" no queda pegado en el resumen.
- El grupo de opciones se nombra con el enunciado resumido (sin leer cada emoji).
- Resultado y medalla en una región viva siempre presente.
- El foco va a "Siguiente" tras responder y al título en el resumen; en las tarjetas, el foco sigue
  a la tarjeta al ponerla o sacarla (`afterNextRender`).
- El resumen no dice "0 de 5" ("¡Terminaste! Jugando se aprende.").
- Durante las rondas Numi se achica y sin burbuja: a 360 px "Siguiente" queda a la vista (y se
  desplaza hasta él con el ajuste de "reducir movimiento").

### Pendientes
1. **Completar** una secuencia con hueco: el componente ya lo admite, pero necesita un juego nuevo
   en el servidor. El tema 1 de 1° ("completa el camino") lo necesitará en la parte 3.
2. Figuras SVG propias (parte 3).
3. Voz de Numi (CU-A20, no construido).
4. **Decisiones del dueño (child-safety, 2026-11-12):** en el resumen, "Jugar de nuevo", "Otro
   juego" y "Volver a practicar" tienen el mismo peso visual; el ícono de "Jugar" es 🧩 (🎲 evocaba
   el azar). **Pendiente a decidir con Adolfo:** sugerir una pausa tras N partidas o un límite
   diario de juego (hoy las medallas se acumulan sin límite).
5. **Bajos de la revisión (no implementados):** tras perder la red al responder se puede tocar otra
   opción con el mismo token; `session`, `forbidden` y `not_found` ofrecen un reintento que no
   sirve (mejor "pide ayuda a un adulto" sin reintento); un ejercicio vencido se reemplaza sin
   aviso; `aria-pressed` en opciones que no son de alternancia; la etiqueta de una tarjeta ya
   corregida sigue diciendo "toca para sacarla" y no dice si quedó bien; la flecha "‹" se lee en voz
   alta; textos del componente de tarjetas y "Jugar" de la práctica fuera de `games.messages.ts`; un
   número de 3 cifras (100) podría no caber en un lugar con 4 lugares; respaldo genérico para un
   emoji nuevo del servidor; `touch-action: none` en las tarjetas impide desplazar la página si el
   dedo empieza sobre ellas; comentario huérfano en `practice.page.ts`; el re-export de
   `MEDAL_EVERY` en la práctica.

### Pruebas
- `core/games/http-games.service.spec.ts` (endpoints, errores, textos accesibles),
  `core/games/game-components.spec.ts` (selección, orden con toque, teclado y arrastre, estados,
  accesibilidad, completar), `games/games.page.spec.ts` (ejes, instrucción, ronda de opciones y de
  orden, 5 rondas con resumen y medalla, sin nivel, sin red y reintento, curso no permitido,
  ejercicio vencido, emoji resumidos) y `practice.page.spec.ts` ("Jugar" solo en 1° y 2°, con red).
- Manual (2026-11-12, Chromium a **360 px**, API de la rama): ronda de opciones y ronda de orden de
  punta a punta (una tarjeta arrastrada al lugar 3, el resto tocando); sin desplazamiento
  horizontal; en la base quedaron como `game` con `mayor-1` y `ordena-1`, la racha en 1 y sin
  progreso de la habilidad. La prueba encontró que el arrastre no detectaba el lugar (la tarjeta
  arrastrada tapaba el punto); corregido con `elementsFromPoint`.


## Jugar un juego de refuerzo (CU-A21), parte 3: juegos de 1° básico

Al menos un juego por cada uno de los 10 temas de 1°. Generadores deterministas en
`api/app/exercises/games.py` (la IA no genera nada), con su prueba de salidas guardadas por
semilla (`api/tests/test_games_golden.py`). Los juegos publicados no se editan (ADR 0004): todos
los de esta parte tienen ids nuevos.

### Temas y juegos
| Tema | Juego | Habilidad |
|---|---|---|
| 1. Conteo hasta 100, completar secuencias | `completa-camino-1` "Completa el camino" (tipo `fill`) | 1-01 |
| 2. Números de 0 a 20 | `cuantos-1` (ya existía, hasta 10) | — |
| 3. Comparar y ordenar de 0 a 20 | `mayor-1` y `ordena-1` (ya existían) | — |
| 4. Componer y descomponer | `descompone-1` "¿Cuántos faltan?" ("5 = 3 + ?" con objetos) | 1-04 |
| 5. Sumas y restas hasta 20 | `junta-1` "Junta y cuenta" (dos grupos de objetos) | 1-08 |
| 6. Patrones simples | `figura-sigue-1` "¿Qué figura sigue?" (AB, ABC, AAB, ABB) | 1-14 |
| 7. Figuras 2D y 3D | `toca-figura-1` "Toca la figura" (4 figuras de formas distintas) | 1-17 |
| 8. Orientación espacial | `donde-esta-1` "Arriba, abajo, izquierda y derecha" (escena en cruz) | 1-16 |
| 9. Longitud con unidades no estandarizadas | `mide-clips-1` "Mide con clips y pasos" | 1-19 |
| 10. Tablas de conteo y pictogramas | `pictograma-1` "Lee el pictograma" (2 o 3 filas) | 1-22 |

La selección sigue siendo eje → juego; en 1° hay 5 ejes (Números, Patrones, Geometría, Medición y
Datos) y el nombre de cada juego dice el tema. Los temas 6 a 10 usan habilidades de fase B: un
juego no cambia el nivel ni el bloque, así que no hace falta que la habilidad sea practicable.

### Tipo `fill` (completar)
- El ejercicio trae `slots`: la secuencia con las tarjetas fijas en su lugar y `null` en los
  huecos. No revela nada: las fijas se ven igual en la pantalla.
- Camino de 6 números contando de 1, 2, 5 o 10 (0 a 100), 2 huecos (nunca en los dos primeros,
  para descubrir de cuánto en cuánto se cuenta) y 2 tarjetas que no van (cercanas al camino).
- El servidor rechaza (422) si una tarjeta fija se mueve o falta, si se repite una tarjeta o si
  se pone una que no es de las opciones. Mensaje al fallar: "Casi. Así quedaba el camino."
- En la app usa `app-order-cards` con lugares fijos; con 5 o más lugares las tarjetas se achican
  para caber en 360 px.
- En "Junta y cuenta" el resumen accesible dice cada grupo ("3 manzanas y 5 manzanas"), no el
  total, que sería la respuesta.

### Lo que se dibuja (temas 6 a 10)
El ejercicio trae a lo más uno de estos campos. Es parte de la pregunta (se ve en la pantalla),
igual que los emoji del enunciado; la solución sigue sin viajar.
- **Figuras** (`f:<forma>-<color>`, `kind: 'figure'`): SVG propios (`core/games/figure.component.ts`).
  Todas con borde oscuro grueso: se distinguen por la forma, nunca solo por el color (en un
  ejercicio, dos figuras nunca tienen la misma forma). La etiqueta accesible dice nombre y color
  ("triángulo rojo"); el nombre no se ve en el botón.
- **`pattern`**: la fila de figuras antes del "?". Se muestran al menos dos vueltas completas, así
  la respuesta es una sola. Para el lector de pantalla: "En la fila: círculo rojo, cuadrado azul,
  … ¿Qué sigue?". (Campo agregado en la implementación: el patrón necesitaba dónde viajar.)
- **`scene`**: la caja al centro y un objeto arriba, a la izquierda, a la derecha y abajo; cada
  objeto es un botón ("pelota, arriba"). Izquierda y derecha "desde donde miras tú".
- **`picto`**: tabla con una fila por categoría; los emoji se ocultan al lector de pantalla y se
  dice la cantidad. Los distractores son las cantidades de las otras filas.
- **`measure`**: un lápiz, una cinta o una alfombra dibujados del mismo largo que la fila de clips
  (📎) o pasos (👣) de debajo (34 px por unidad, hasta 8: cabe en 360 px). Cada unidad es un
  elemento de lista, para contarla con lector de pantalla. (Campo agregado en la implementación.)

Con lector de pantalla, "Toca la figura" y la escena se responden oyendo el nombre o la posición:
es la única forma accesible de describirlas y se acepta.

### Pendientes
1. `cuantos-20-1`: contar de 11 a 20, con dos filas de 10 para que quepa en 360 px (hoy el tema 2
   queda cubierto por `cuantos-1`, hasta 10).
2. Variedad: "delante" y "detrás" en la escena; "¿de cuál hay más?" en el pictograma; restas en
   "Junta y cuenta"; relacionar 3D con 2D.
3. **Bajos de la revisión (no implementados):** en `fill` las tarjetas fijas son botones
   desactivados con el mismo estilo (el lector dice "atenuado") y al corregir también llevan ✓;
   tarjetas de 47 × 52 px con 6 lugares (sobre el mínimo de 44, bajo los 64 del proyecto); ícono
   👆 en vez de 🔢 para `fill` en la lista; comentario viejo en `order-cards` ("solo ordenar");
   `max_length=6` de la respuesta es justo el largo del camino; la prueba de "dibujo distinto"
   compara el SVG como texto, no lo que se ve.

### Decisiones posteriores a la revisión (dueño, 2026-11-12)
- **Textos:** "5 = 3 + ?" se dice completo al lector de pantalla ("5 es igual a 3 más ¿cuántas
  manzanas?", `spokenEquation`), concordando con el objeto. "Junta y cuenta" y el pictograma
  concuerdan con el objeto ("las"/"los", "¿Cuántas…?"/"¿Cuántos…?"; hoy todos son femeninos, así
  que sus salidas no cambian). La instrucción de "¿Cuántos faltan?" queda sin género ("Mira el
  grupo y toca el número que falta.").
- **Habilidad de medir con clips: queda `1-19`.** 2B-OA19 es `2-22` "Longitud en cm y m", de 2°
  y con unidades estandarizadas; la única habilidad de longitud de 1° es `1-19` (1B-OA18,
  "Comparar longitudes"). Ese vínculo es el que usará "Aprender jugando" en cada tema.

### Prueba manual (2026-11-12, Chromium a 360 px, base y API locales de la rama)
Selección con los 5 ejes de 1°. Un juego por tema jugado de punta a punta (5 rondas y resumen):
`completa-camino-1`, `cuantos-1`, `ordena-1`, `descompone-1`, `junta-1`, `figura-sigue-1`,
`toca-figura-1`, `donde-esta-1`, `mide-clips-1` y `pictograma-1`. Sin desplazamiento horizontal
(todo dentro de 344 px). Figuras distinguibles por la forma; la escena arma la cruz con botones de
88 px y etiquetas "flor, arriba"; el pictograma de 8 pasa a dos líneas en grupos de 5 y 3 sin
cortarse; el patrón y su "?" caben en una línea; lo medido mide lo mismo que la fila de clips. La
base quedó restaurada con la semilla (`supabase db reset`).

### Revisión antes del PR
`code-reviewer` y `child-safety-ai-reviewer` sobre `03bb270..6b44d4f`. Sin bloqueantes de
tiendas. Corregidos en `fix(cu-a21)`:
- **Alto:** el pictograma con 7 u 8 emoji no cabía en 360 px y se cortaban íconos. Ahora van en
  grupos de 5 que pasan enteros a la línea siguiente.
- **Medio:** "Toca la figura" podía tener dos respuestas (un cuadrado también es rectángulo) o
  parejas que se confunden (círculo y esfera, cuadrado y cubo). Ahora van 3 figuras de familias
  distintas, y la pedida sale pareja entre las 7 formas. El juego no estaba publicado: se cambió
  su generador y su salida guardada.
- **Medio:** en "Junta y cuenta" los dos grupos se mezclaban al pasar de línea. Ahora cada grupo
  va en su recuadro.
- **Medio:** un patrón de 7 figuras dejaba el "?" solo en otra línea. Ahora las figuras miden
  36 px y caben en una línea.
- Prueba nueva: completar rechaza una tarjeta fija puesta también en un hueco.
