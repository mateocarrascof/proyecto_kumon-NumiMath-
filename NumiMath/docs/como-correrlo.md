# Cómo correr la app completa en tu computador

Requisitos ya instalados: Docker Desktop (encendido), Supabase CLI, Node y Python (`api/.venv`).
Todos los comandos se ejecutan desde la raíz del proyecto.

## Una sola vez

1. **Base de datos local** (si Docker acaba de iniciar):
   ```bash
   supabase start
   ```
2. **Variables del servidor** (crea `api/.env`, nunca se sube a git). Te pedirá la clave de Gemini con
   entrada oculta; puedes dejarla en blanco (Enter) mientras solo pruebes ejercicios:
   ```bash
   powershell -ExecutionPolicy Bypass -File api/scripts/crear-env.ps1
   ```

## Cada vez que quieras usarla (dos terminales)

Terminal 1, la API:
```bash
api/.venv/Scripts/python -m uvicorn app.main:app --app-dir api --port 8000
```

Terminal 2, la app:
```bash
npm --prefix app start
```

Abre http://localhost:8100 en Chrome.

> Si cambias código de la API, reinicia la Terminal 1 (Ctrl+C y volver a ejecutar).
> La app se recarga sola, salvo que se agreguen archivos estáticos nuevos.

## Recorrido

1. **Crear cuenta** con cualquier correo y una contraseña de 8 o más caracteres.
2. **Aceptar** los términos y la política (textos provisionales, marcados "NO VÁLIDO LEGALMENTE").
3. **Perfiles de niños** → *Crear perfil*: apodo (no el nombre real), curso y declaración del adulto.
4. **Practicar** → elige un tema → responde con números. La mascota reacciona.
5. **Progreso**: aciertos por tema, racha y últimos intentos.

## Crear un administrador (solo la empresa, nunca desde la app)

Con Supabase local en marcha (`supabase start`) y la API configurada (`api/.env` con
`SUPABASE_SERVICE_ROLE_KEY`):
```bash
api/.venv/Scripts/python api/scripts/create_admin.py correo@empresa.cl
```
Pide la contraseña (mínimo 8) dos veces, sin mostrarla. Luego entra en http://localhost:8100/admin/login.
Desde ahí se crean las cuentas de docentes; la contraseña inicial se muestra una sola vez.

### Probar docentes a mano (sin escribir contraseñas en ningún chat)
1. Entra como administrador en http://localhost:8100/admin/login.
2. **Crear docente:** "Crear el primer docente" (o "Crear docente"), con nombre, correo y una contraseña
   inicial que elijas. Anota el correo, la contraseña y el código que muestra la pantalla (aparecen una sola vez).
3. **Editar:** en la lista, "Editar": cambia el nombre y/o el correo. El correo nuevo rige de inmediato.
4. **Docente:** en otra ventana privada, http://localhost:8100/docente/login con el correo (nuevo) y la
   contraseña inicial: verás el código con "Copiar". Con el correo viejo no entra.
5. **Eliminar:** "Eliminar" → lee la explicación → "Sí, eliminar la cuenta". El docente ya no puede entrar
   (si su pantalla seguía abierta, al recargar vuelve a la entrada).

## Pruebas

| Qué | Comando |
|---|---|
| Base (RLS, triggers) | `supabase test db` |
| API | `api/.venv/Scripts/python -m pytest -q api` y `api/.venv/Scripts/python -m ruff check api` |
| App | `npm --prefix app run lint`, `npm --prefix app run test:ci`, `npm --prefix app run build` |
