# NumiMath | IA Matemática para Triskeledu

Aplicación móvil de matemáticas adaptativas para niños de 6 a 12 años, inspirada en el método Kumon y apoyada en inteligencia artificial acotada, desarrollada para el cliente **Triskeledu** en el marco de la asignatura Capstone (PTY4614) de Duoc UC (Sede Padre Alonso de Ovalle).

---
<a id="informacion-del-proyecto" name="informacion-del-proyecto"></a>
## 📋 Información del Proyecto

- **Proyecto:** Proyecto 7: IA Matemática (aplicación NumiMath: práctica adaptativa de matemáticas de 1° a 4° básico, con corrección instantánea, panel para tutores y módulos para docentes y administración)
- **Cliente / Organización:** Triskeledu
- **Institución:** Duoc UC — Escuela de Informática y Telecomunicaciones
- **Carrera:** Ingeniería en Informática

---
<a id="integrantes-del-equipo" name="integrantes-del-equipo"></a>
## 👥 Integrantes del Equipo

| Nombre Integrante | Correo Institucional | Rol en el Proyecto |
| :--- | :--- | :--- |
| **Adolfo Cartes** | `ad.cartes@duocuc.cl` | Jefe de Proyecto y Desarrollador |
| **Mateo Carrasco** | `ma.carrascof@duocuc.cl` | Analista de Requerimientos y QA |

---

<a id="tabla-de-contenidos" name="tabla-de-contenidos"></a>
## 📋 Tabla de Contenidos
- [Información del Proyecto](#informacion-del-proyecto)
- [Integrantes del Equipo](#integrantes-del-equipo)
- [Tabla de Contenidos](#tabla-de-contenidos)
- [Enlaces Oficiales](#enlaces-oficiales)
- [Descripción y Alcance de la Solución](#descripcion-y-alcance)
- [Innovación y Propuesta de Valor](#innovacion)
- [Stack Tecnológico](#stack-tecnologico)
- [Arquitectura del Sistema](#arquitectura)
- [Estado Actual del Desarrollo](#estado-actual)
- [Puesta en Marcha](#puesta-en-marcha)
- [Gestión de Usuarios](#usuarios)
- [Estructura del Proyecto](#estructura)
- [Metodología de Trabajo](#metodologia)
- [Documentación del Proyecto](#documentacion)
---
<a id="enlaces-oficiales" name="enlaces-oficiales"></a>
## 🔗 Enlaces Oficiales

- **Repositorio GitHub (Público):** [https://github.com/mateocarrascof/proyecto_kumon-NumiMath-.git](https://github.com/mateocarrascof/proyecto_kumon-NumiMath-.git)
- **Evidencias de la Fase 1:** carpeta [`FINAL FASE 1`](FINAL%20FASE%201) de este repositorio.
- **Evidencias de la Fase 2:** carpeta [`FASE 2`](FASE%202) de este repositorio (ver [Documentación del Proyecto](#documentacion)).
- **Carpeta Compartida Google Drive:** *https://drive.google.com/drive/folders/1QN-TKWRHs6uAoAOnti-yZrDHZnuX4E15?usp=drive_link*

---
<a id="descripcion-y-alcance" name="descripcion-y-alcance"></a>
## 🎯 Descripción y Alcance de la Solución

El proyecto aborda un problema de aprendizaje: en Chile, el **59 % de los estudiantes de 15 años no alcanza el nivel básico en matemática** (PISA 2025: 403 puntos frente a 463 de la OCDE) y el Simce 2024 muestra que el avance de 4° básico no se sostiene en 6° básico. NumiMath ataca tres mecanismos de esa brecha: el *feedback* tardío, el ritmo fijo de grupo y el avance estancado. Cada niño practica a su propio nivel, recibe corrección inmediata y un adulto ve su progreso. El alcance definido con el cliente es el siguiente (lo ya implementado se detalla en [Estado Actual del Desarrollo](#estado-actual)):

1. **Motor de dominio y práctica adaptativa:** catálogo de **101 habilidades** de 1° a 4° básico con tres niveles por perfil. El nivel se decide por bloques de 10 ejercicios: sube con 8 o más aciertos y baja con 4 o menos. Un diagnóstico inicial opcional estima el nivel de entrada.
2. **Generador de ejercicios y corrección instantánea:** los ejercicios los genera código determinista y validado matemáticamente (54 habilidades con generador propio, más 32 juegos de refuerzo para 1° y 2° básico). El servidor corrige, registra el intento y responde con un mensaje amable de la mascota **Numi**.
3. **Asistente de IA acotado:** la IA **no genera ejercicios**: solo explica el enunciado del sistema, paso a paso, detrás de filtros de entrada y de salida.
4. **Engagement sin presión:** racha diaria, estrellas y medallas por nivel, celebraciones, tiempo por ejercicio sin presión y un recordatorio local de racha, opcional y activado solo por el tutor.
5. **Panel del tutor:** acceso con PIN de 4 dígitos, perfiles de los hijos, informe semanal y por tema, **tareas con ejercicios propios**, exportación del historial en CSV, vínculo con docentes y hojas guardadas.
6. **Módulos de docente y administrador:** el docente ve el progreso y el historial de los alumnos que el tutor vincula; el administrador crea y gestiona las cuentas de docentes, con auditoría.
7. **Uso sin conexión:** el niño practica con un lote de ejercicios firmados y la app sincroniza al recuperar la conexión; el servidor vuelve a corregir cada respuesta.
8. **Protección de datos de menores (Leyes N° 19.628 y N° 21.719):** el niño no tiene cuenta (solo apodo y curso), consentimiento del tutor versionado y auditable, y derechos de revocación y eliminación.

---
<a id="innovacion" name="innovacion"></a>
## 💡 Innovación y Propuesta de Valor

**Qué problema resuelve.** Un niño que practica matemática en grupo o con guías fijas recibe la corrección tarde, avanza al ritmo del curso y, si se estanca, nadie lo advierte a tiempo. Los tutores y docentes, por su parte, no tienen una forma simple de saber en qué habilidad exacta necesita apoyo.

**Qué lo hace diferente.**
* **El adulto interviene el contenido, no solo lo observa:** el tutor puede crear los ejercicios que su hijo resolverá («Tareas de tu tutor»), algo que las aplicaciones comparables no ofrecen.
* **Nivel por habilidad, no por curso:** el motor modela el dominio de cada habilidad y ajusta la dificultad con una regla simple y explicable (bloques de 10 ejercicios).
* **La IA explica, no resuelve:** los ejercicios los crea código validado; la IA solo explica el enunciado, con filtros de entrada y salida, un camino de apoyo si el niño parece angustiado y límites de uso. El proveedor de IA está detrás de una interfaz reemplazable.
* **Privacidad desde el diseño:** el niño no tiene cuenta, solo apodo y curso; el aislamiento entre tutores lo garantiza la propia base de datos (seguridad por fila) y el consentimiento queda registrado con la versión y la huella SHA-256 de cada texto legal.
* **El servidor decide el progreso:** cada ejercicio viaja firmado, caduca a los 10 minutos y se responde una sola vez; esto sigue siendo así incluso sin conexión.

**Qué valor agrega.**
* El niño practica a su nivel, con corrección inmediata y sin presión.
* El tutor y el docente ven el avance por tema, la racha y el historial, y pueden asignar tareas propias.
* La solución nace preparada para la normativa de datos personales de menores, con 32 pendientes legales documentados para la revisión de un abogado.
* Cada requerimiento queda trazado hasta su caso de uso y su prueba: 43 requerimientos funcionales, 14 no funcionales y 62 casos de uso.

---
<a id="stack-tecnologico" name="stack-tecnologico"></a>
## 🛠️ Stack Tecnológico

- **App (frontend):** Ionic 9 + Angular 22 + Capacitor 8, con TypeScript (una sola base de código para web, Android e iOS)
- **API (backend):** Python 3.12 / FastAPI, con ejercicios firmados (HMAC) y PIN parental con argon2id
- **Base de Datos y Autenticación:** Supabase (PostgreSQL, Auth y seguridad por fila), ejecutado en local sobre Docker con Supabase CLI
- **Inteligencia Artificial:** Gemini API, solo para explicar ejercicios y detrás de filtros de seguridad (por defecto la API usa un proveedor simulado)
- **Pruebas y Calidad:** pytest y Ruff (API), pgTAP (base de datos), Vitest y ESLint (app)
- **Contenedores:** Docker Desktop (requerido por Supabase local)
- **Herramientas:** Git / GitHub, VS Code

> ℹ️ **Cambio respecto al diseño inicial:** la Fase 1 contemplaba Flutter y SQLite. Se cambió a Ionic, Angular y Capacitor para tener una sola base de código para web, Android e iOS, y a Supabase (PostgreSQL) para sostener la seguridad por tutor en la propia base de datos.

---
<a id="arquitectura" name="arquitectura"></a>
## 📐 Arquitectura del Sistema

**Estilo Arquitectónico: aplicación cliente–servidor por capas, con la base de datos como frontera principal de seguridad.**
La app muestra, pero el servidor decide: la API valida la sesión, controla que cada alumno pertenezca a su tutor, genera y firma los ejercicios, corrige y actualiza el nivel. El flujo de trabajo se estructura en 4 capas principales:

#### 1. Usuarios
Diseñado para la interacción de los adultos responsables y de la administración:
* **Alumno:** niño de 6 a 12 años; no tiene cuenta propia, practica desde el perfil que crea su tutor.
* **Tutor:** madre, padre o apoderado; administra los perfiles, el PIN, las tareas y el panel.
* **Docente:** ve el progreso de los alumnos que el tutor vincula con un código.
* **Administrador:** crea y gestiona las cuentas de docentes y su auditoría.

#### 2. Insumos
* **Catálogo curricular:** 101 habilidades de 1° a 4° básico (`docs/habilidades_1a4_basico.csv`).
* **Tareas del tutor:** ejercicios propios que el tutor escribe para su hijo.
* **Textos legales versionados:** términos y política de privacidad, con huella SHA-256.

#### 3. Plataforma NumiMath (Core)
Módulo central encargado de la lógica de negocio y la presentación:
* **App Ionic/Angular:** registro, perfiles, práctica, juegos de refuerzo, progreso, panel del tutor y vistas de docente y administrador.
* **API FastAPI:** generación y corrección de ejercicios, nivel por habilidad, rachas, tareas, sincronización sin conexión, exportación y filtros de la IA.
* **Asistente de IA:** explicación del enunciado con filtros de entrada y salida, detrás de una interfaz reemplazable.

#### 4. Base de Datos e Infraestructura
* **Capa de Persistencia:** PostgreSQL en Supabase con **23 tablas** y **42 migraciones** versionadas, seguridad por fila y pruebas pgTAP.
* **Entorno:** Supabase local sobre Docker y API en local; los pasos están en [Puesta en Marcha](#puesta-en-marcha).
---
<a id="estado-actual" name="estado-actual"></a>
## 🚦 Estado Actual del Desarrollo

La versión vigente es el **MVP entregado a Triskeledu el 18 de noviembre de 2026**, con los **62 casos de uso completos**: Alumno 23 de 23, Tutor 27 de 27, Docente 7 de 7 y Administrador 5 de 5. El código se encuentra en la carpeta `NumiMath/`, en la raíz del repositorio. Los casos de la voz de Numi (CU-A20 y CU-T23) se entregan con la versión del cliente y no forman parte de este repositorio.

#### Módulos Disponibles
* **Cuentas y consentimiento:** registro e inicio de sesión del tutor, recuperación de contraseña, aceptación de términos y política con versión y huella SHA-256, revocación del consentimiento y eliminación de la cuenta.
* **Perfiles de alumno:** solo apodo y curso; el apodo es único por tutor y curso.
* **Práctica adaptativa:** 101 habilidades, corrección instantánea, diagnóstico inicial opcional y explicación de la IA con «Explícame».
* **Juegos de refuerzo:** 32 juegos para 1° y 2° básico, uno por tema.
* **Engagement:** racha diaria, estrellas y medallas, mascota Numi y recordatorio local de racha opcional.
* **Panel del tutor:** PIN de 4 dígitos, pestañas por perfil, informe con gráfico semanal y aciertos por tema, tareas propias con edición, exportación a CSV, vínculo con docentes y hojas guardadas.
* **Docente y administrador:** el administrador crea, edita y elimina docentes con auditoría; el docente consulta el progreso y el historial desde el vínculo.
* **Uso sin conexión:** lote de ejercicios firmados, corrección provisional en el dispositivo y sincronización al recuperar la red.
* **Seguridad y privacidad:** aislamiento por tutor en la base de datos, filtros de la IA, límites de uso y registro de eventos sin datos personales.

#### Calidad
* **API:** 1.497 pruebas con pytest (más 26 de integración con la base local) y Ruff sin observaciones.
* **Base de datos:** más de 1.000 pruebas pgTAP de seguridad y aislamiento entre tutores.
* **App:** 74 archivos de prueba, con ESLint y compilación sin errores.
* **Verificación manual** en el navegador al cierre de cada etapa.

#### Fuera del alcance y trabajo futuro
* Pruebas de usabilidad con niños.
* Exportación de informes en PDF (se exporta en CSV).
* Notificaciones *push* (solo hay un recordatorio local opcional).
* Validación legal definitiva de los textos y de la IA con menores. Los textos están marcados «NO VÁLIDO LEGALMENTE».

#### Tecnologías Utilizadas
* **App:** Ionic 9, Angular 22, Capacitor 8 y TypeScript
* **API:** Python 3.12, FastAPI, Pydantic y PyJWT
* **Base de Datos:** PostgreSQL con Supabase (Auth y seguridad por fila)
* **Inteligencia Artificial:** Gemini API, con proveedor simulado por defecto
* **Créditos de recursos:** ver [`NumiMath/docs/creditos-recursos.md`](NumiMath/docs/creditos-recursos.md)

---
<a id="puesta-en-marcha" name="puesta-en-marcha"></a>
## 🚀 Puesta en Marcha

#### Requisitos
* **Docker Desktop** (encendido)
* **Supabase CLI**
* **Node.js 24**
* **Python 3.12**
* **Git**

#### Instalación en Windows
Abrir una terminal (PowerShell) en la raíz del proyecto, la carpeta `NumiMath`, y ejecutar:

```
docker info
supabase start
python -m venv api/.venv
api/.venv/Scripts/python -m pip install -r api/requirements.txt
powershell -ExecutionPolicy Bypass -File api/scripts/crear-env.ps1
npm --prefix app ci
```

`crear-env.ps1` genera `api/.env` (nunca se sube a Git) y pide la clave de Gemini con entrada oculta; se puede dejar en blanco para probar solo los ejercicios.

Después, cada vez que se quiera usar la aplicación, en **dos terminales**:

```
api/.venv/Scripts/python -m uvicorn app.main:app --app-dir api --port 8000
```
```
npm --prefix app start
```

Luego abrir **http://localhost:8100** en Chrome y crear una cuenta de tutor con cualquier correo y una contraseña de 8 o más caracteres.

> 🧭 **Guía completa:** los pasos detallados, el recorrido de prueba y cómo probar docentes están en [`NumiMath/docs/como-correrlo.md`](NumiMath/docs/como-correrlo.md).

> ✅ **Pruebas automáticas:** `supabase test db` (base de datos), `api/.venv/Scripts/python -m pytest -q api` y `api/.venv/Scripts/python -m ruff check api` (API), y `npm --prefix app run lint`, `npm --prefix app run test:ci` y `npm --prefix app run build` (app).

> 🔒 **Datos:** el repositorio no contiene datos reales ni claves. Los textos legales son provisionales y el proveedor de IA es simulado salvo que se configure una clave de Gemini en `api/.env`.

#### Crear un administrador
Con `supabase start` en marcha y `api/.env` configurado:

```
api/.venv/Scripts/python api/scripts/create_admin.py correo@empresa.cl
```

El script pide la contraseña (mínimo 8 caracteres) dos veces, sin mostrarla. Luego se ingresa en **http://localhost:8100/admin/login**.

---
<a id="usuarios" name="usuarios"></a>
## 👤 Gestión de Usuarios

* **Cuentas solo de adultos:** el niño nunca tiene cuenta; practica desde un perfil que crea su tutor (apodo y curso).
* **Inicio de sesión por correo:** tutor en `/login`, docente en `/docente/login` y administrador en `/admin/login`.
* **Perfiles:**

  | Acción | Tutor | Docente | Administrador |
  |---|:---:|:---:|:---:|
  | Crear perfiles de alumno y practicar | ✓ | – | – |
  | Panel con PIN: informe, tareas propias y exportación a CSV | ✓ | – | – |
  | Vincular o quitar docentes de un perfil | ✓ | – | – |
  | Ver progreso e historial de alumnos vinculados | – | ✓ | – |
  | Crear, editar y eliminar cuentas de docentes | – | – | ✓ |
  | Revocar el consentimiento y eliminar la cuenta | ✓ | – | – |

* **Creación de cuentas:** el tutor se registra desde la app. Los docentes los crea el administrador, con nombre, correo y una contraseña inicial; la pantalla muestra una sola vez la contraseña y el código de 8 caracteres del docente. El administrador lo crea la empresa con el script `create_admin.py`, nunca desde la app.
* **Vínculo docente–alumno:** el tutor lo autoriza con su PIN y el código del docente; si se escribe un código inexistente varias veces seguidas, el acceso se bloquea 15 minutos. El docente solo ve lo posterior al vínculo.

---
<a id="estructura" name="estructura"></a>
## 📁 Estructura del Proyecto

```
proyecto_kumon-NumiMath-/
├── NumiMath/                  aplicación (detalle abajo)
├── FINAL FASE 1/              evidencias individuales y grupales de la Fase 1
├── FASE 2/                    evidencias de la Fase 2 (ver Documentación del Proyecto)
└── README.md

NumiMath/
├── app/                       app Ionic + Angular + Capacitor
│   └── src/app/               admin, core, games, home, kid-tasks, login, pin, practice,
│                              profiles, progress, recover, teacher, terms y tutor-panel
├── api/                       servidor FastAPI
│   ├── app/                   rutas, ejercicios, currículo, IA, filtros de seguridad,
│   │                          acceso, sesión, rachas y uso
│   ├── scripts/               crear-env.ps1 y create_admin.py
│   └── tests/                 pruebas con pytest
├── supabase/
│   ├── migrations/            42 migraciones de la base de datos
│   ├── tests/                 pruebas pgTAP (seguridad y aislamiento)
│   ├── seed.sql               datos iniciales (versiones de los textos legales)
│   └── config.toml            configuración de Supabase local
├── docs/
│   ├── SPEC.md                especificación del producto
│   ├── adr/                   decisiones de arquitectura (0001 a 0005)
│   ├── privacy/               EIPD, inventario de datos y pendientes legales
│   ├── legal-provisional/     términos y política de privacidad provisionales
│   ├── como-correrlo.md       cómo correr la app completa
│   └── habilidades_1a4_basico.csv   catálogo de 101 habilidades
└── .github/workflows/         revisión de secretos y dependencias
```

---
<a id="metodologia" name="metodologia"></a>
## 🔄 Metodología de Trabajo

Para la ejecución del proyecto se utiliza una **metodología ágil adaptada de Scrum**, organizada en ciclos cortos de entrega (lotes y etapas), con pruebas automáticas y verificación manual al cierre de cada ciclo, revisión de seguridad y privacidad, y registro de las decisiones importantes en ADR. Este marco permite entregas incrementales y verificables junto al cliente, y adaptarse a los cambios de alcance que fueron apareciendo (stack, temas de 1° y 2° básico, módulos de docente y administrador, modo sin conexión).


###  Fases del Proyecto

####  Fase 1: Definición y Análisis
* **Objetivo:** Definir el problema, el alcance y los requerimientos del proyecto.
* **Actividades:**
  * Recepción y selección del caso (Proyecto 7) y reuniones con el cliente Triskeledu.
  * Requerimientos funcionales y no funcionales, y casos de uso.
  * Mockups de interfaz, matriz RACI, carta Gantt y plan de riesgos.
* **Entrega:** 12 de septiembre de 2026.

####  Fase 2: Diseño y Arquitectura
* **Objetivo:** Definición de la estructura de datos, los componentes de software y la experiencia de usuario.
* **Actividades:**
  * Diagrama de arquitectura, modelo lógico y relacional de datos y diccionario de datos.
  * Diseño de la seguridad por tutor en la base de datos y del contrato de la API.
  * Diseño de la interfaz infantil y del panel del tutor.

####  Fase 3: Desarrollo Incremental
* **Objetivo:** Implementación iterativa de los componentes centrales de la plataforma (12 de octubre al 16 de noviembre).
* **Actividades:**
  * **Base de datos y API:** migraciones, seguridad por fila, ejercicios firmados y corrección en el servidor.
  * **App:** registro, perfiles, práctica, rachas, medallas, panel del tutor y juegos de refuerzo.
  * **Ampliación:** modo sin conexión, diagnóstico inicial, recordatorio de racha, módulos de docente y administrador, exportación a CSV y hojas guardadas.

####  Fase 4: Pruebas y Control de Calidad (QA)
* **Objetivo:** Asegurar la consistencia, la seguridad y la integridad del progreso de cada alumno.
* **Actividades:**
  * Pruebas automáticas en tres capas: base de datos (pgTAP), API (pytest) y app, con análisis de estilo (Ruff y ESLint).
  * Revisión al cierre de cada etapa y verificación manual en el navegador.
  * Plan de pruebas y validación y verificación final del MVP.

####  Fase 5: Entrega y Documentación
* **Objetivo:** Entrega formal de la solución.
* **Actividades:**
  * Congelamiento de la versión y entrega del MVP al cliente el 18 de noviembre de 2026.
  * Instructivo de instalación, manual de usuario y documentación técnica del repositorio.
  * Informe final, presentación y defensa de título (4 de diciembre de 2026).

---
<a id="documentacion" name="documentacion"></a>
## 📚 Documentación del Proyecto

Las evidencias de la Fase 2 están en la carpeta [`FASE 2`](FASE%202):

| Carpeta | Contenido |
| :--- | :--- |
| `Evidencias Individuales` | Pauta de reflexión de cada integrante. |
| `Evidencias Grupales` | Guía de desarrollo del proyecto (2.4). |
| `Evidencias Proyecto` | Resumen del estado de avance de los casos de uso. |

Las evidencias de la Fase 1 están en la carpeta [`FINAL FASE 1`](FINAL%20FASE%201).
