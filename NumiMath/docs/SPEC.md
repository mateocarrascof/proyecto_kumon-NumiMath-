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
- Nunca se dice que la racha "se perdió" ni se culpa al niño. Sin notificaciones push ni recordatorios.

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
| Editar | No existe: se borra y se crea otra |

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


## Perfil del profesor (BORRADOR, pendiente de aprobación)

Entrevista del 2026-10-27. Nada de esto está implementado. Cambia dos reglas de base:
1. Hoy "solo el tutor tiene cuenta". Pasa a ser: **solo adultos tienen cuenta** (tutor o profesor);
   el alumno sigue sin credenciales. Hay que actualizar CLAUDE.md.
2. Hoy el papel para calcular no se guarda nunca. Pasa a guardarse una imagen **solo si el alumno
   está en un curso**. Sin curso, todo sigue igual que hoy.

### Cuenta del profesor
- Registro con email en Supabase Auth, eligiendo "Soy profesor". Solo se aceptan emails de
  **dominios de colegios en una lista permitida** (tabla `teacher_email_domains`, la edita solo un
  administrador vía service_role). Email verificado obligatorio.
- Un rol por cuenta: `tutors` o `teachers`. Una persona que es tutor y profesor usa dos emails.
- Términos y privacidad propios del profesor, con el mismo registro de consentimiento (versión y
  fecha-hora UTC).

### Curso y vínculo
- El profesor crea un curso (nombre del curso, p. ej. "3°B", y nivel 1° a 4°). Recibe un código
  corto (6 caracteres, sin letras ambiguas), que puede regenerar.
- El tutor, **detrás de la puerta parental**, ingresa el código en el perfil del niño, ve el nombre
  del curso y del profesor, y acepta compartir. Se guarda ese consentimiento (tutor, alumno, curso,
  versión del texto, fecha-hora UTC).
- **Un alumno, un curso.** Para cambiar: desvincular e ingresar otro código.
- El tutor puede desvincular cuando quiera. Al desvincular, el profesor deja de ver todo al
  instante y las hojas de ese alumno se borran.
- El profesor ve del alumno solo **apodo y curso** (lo mismo que ya existe). Puede sacar a un
  alumno de su curso.

### Qué ve el profesor
- **Por alumno:** ejercicios hechos, % de aciertos por tema, nivel por tema, tiempo típico por
  tema, racha, y la lista de intentos (fecha, tema, enunciado, respuesta, correcto, tiempo) con la
  **foto de la hoja** de cada uno.
- **Por curso:** no pedido en esta etapa.
- Solo datos desde que el alumno se vinculó al curso, no su historial anterior.

### Foto de la hoja
- Se envía en **todos los ejercicios** respondidos mientras el alumno está en un curso, **solo si
  dibujó algo** en el papel.
- La imagen se genera en el dispositivo desde los trazos (hoja blanca + cuadrícula, recortada a la
  zona dibujada, WebP o PNG, tope de tamaño). Sin metadatos.
- Se sube por FastAPI, que comprueba alumno ↔ tutor ↔ curso, y la guarda en un bucket privado de
  Supabase Storage. El profesor la ve con URL firmada de corta duración.
- **Retención: 30 días**, borrado automático (cron). Las estadísticas quedan sin la imagen.
- **No llega a la IA**, no se analiza ni se hace OCR.
- **Aviso al niño:** con curso, el papel muestra "👀 Tu profe verá esta hoja" en lenguaje simple.

### Quién ve las hojas
- Decisión: **solo el profesor** ve las hojas en la app.
- ⚠️ Pendiente legal: el tutor, como representante del niño, tiene derecho de acceso y supresión
  (Ley 21.719, ARCOP). Propuesta mínima: el tutor no las ve en el día a día, pero desde la zona de
  tutor puede "Descargar las hojas de mi hijo/a" y "Borrar todas las hojas". Confirmar.

### Tareas del profesor
- Igual que "Tareas de tu tutor" (enunciado + respuesta, filtrados por FastAPI), asignadas a todo
  el curso o a alumnos elegidos. El niño las ve como "Tareas de tu profe".

### Comentarios del profesor
- Nota corta (máx. 200 caracteres) sobre un intento/hoja. Filtrada por FastAPI igual que las tareas
  (datos personales, groserías, fuera de matemáticas). El niño la ve en "Mis tareas". Sin
  respuestas del niño (no es un chat).

### Seguridad y datos
- Tablas nuevas (`teachers`, `teacher_email_domains`, `courses`, `course_enrollments`,
  `enrollment_consents`, `sheet_snapshots`, `teacher_assignments`, `teacher_comments`) con RLS:
  el profesor solo ve alumnos con vínculo activo en sus cursos; el tutor solo lo suyo. Tests pgTAP
  de que otro profesor y otro tutor no leen ni escriben.
- Políticas de Storage por curso/alumno, y tests de que otro profesor no obtiene la imagen.
- Actualizar `docs/privacy/inventario-datos.md` (imagen de la hoja = dato nuevo del niño, datos del
  profesor), la EIPD y los textos legales del tutor y del profesor.
- Revisores antes del PR: `privacy-cl-auditor`, `child-safety-ai-reviewer`, `security-reviewer`,
  `code-reviewer`, `scalability-reviewer`.

### Lotes propuestos
1. Cuenta del profesor + dominios permitidos + consentimiento del profesor.
2. Cursos, código y vínculo con consentimiento del tutor; desvincular.
3. Estadísticas por alumno para el profesor (reusa progreso, niveles y tiempos).
4. Foto de la hoja: generación, subida, Storage, aviso al niño, retención 30 días.
5. Tareas del profesor.
6. Comentarios del profesor.

### Preguntas abiertas
- Acceso del tutor a las hojas (ver arriba).
- ¿Quién llena la lista de dominios de colegios al inicio?
- ¿El profesor puede ver o descargar datos de alumnos que salieron del curso? (Propuesta: no.)
- Los colegios podrían querer actuar como responsables del tratamiento: puede requerir un acuerdo
  con cada colegio. Revisar con asesoría legal.

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
- **Intentos:** cuentan los de práctica y las tareas del tutor. **El diagnóstico inicial no cuenta**, porque `list_attempts` solo lee `activity = 'practice'`. La fecha de cada intento es la UTC.

### Cómo está hecho
- `GET /v1/students/{id}/progress` (solo lectura, `AuthorizedStudentDep`, sin PIN porque es la vista del niño) agrega `weeks: [{start, total, correct}]`.
- La agrupación es `weekly()`, la misma del informe del tutor. Se movió a `api/app/weekly.py` para que la usen las dos rutas sin un import circular.
- La vista `student_daily_progress` que proponía el encargo **no existía**. Se decidió reutilizar `weekly()` en vez de crearla.
- La app reutiliza el gráfico SVG propio del panel del tutor (`core/charts/weekly-chart.component.ts`), sin librerías. Ya trae:
  - `role="img"` con un resumen;
  - la leyenda;
  - el % escrito sobre cada barra, para no depender solo del color;
  - una tabla oculta para el lector de pantalla.

### Pendientes
1. **Textos del gráfico:** el componente que se reutiliza está pensado para adultos ("Ejercicios respondidos" y la fecha en formato 2026-10-20 en la tabla). Para usar textos de niño habría que modificar el componente compartido.
2. **Ventana de 500 intentos** (la misma del informe): un niño con más de 500 intentos en 8 semanas vería incompletas las semanas más antiguas.
3. **Revisión de CU-A2:** las correcciones que propusieron los revisores siguen sin aplicar.

### Pruebas
- `api/tests/test_progress.py`: agrupación en 3 semanas, semanas vacías, límites de la ventana, fecha no creíble y aislamiento.
- `api/tests/test_integration_progress_evolution.py`: cuenta real con diagnóstico y 2 prácticas; la evolución cuenta solo las 2.
- `progress.page.spec.ts`: barras, tabla y ánimo; mensaje con 2 ejercicios; umbral de 5; sin comparaciones.
- `http-progress.service.spec.ts`.
