# ADR 0005: Apodos únicos por tutor y curso

**Estado:** aceptado (2026-11-18) · **Alcance:** perfiles de alumnos (`public.students`)

## Contexto

Un tutor podía crear dos perfiles con el mismo apodo en el mismo curso (dos "Juanito" en 1°), y
en "¿Quién practica?" no había forma de distinguirlos. Solo existían `students_id_tutor_uk` y
`students_id_tutor_unique`. Los perfiles se crean desde la app directo en Supabase (PostgREST, con
RLS); FastAPI no tiene rutas para crearlos ni editarlos.

## Decisión

1. **Regla:** un tutor no puede tener dos alumnos con el mismo apodo en el mismo curso. Otro tutor
   sí puede usar ese apodo.
2. **Comparación:** `public.student_nickname_key(nickname)` quita los espacios del inicio y del
   final, deja uno solo entre palabras, pasa a minúsculas y quita las tildes de á é í ó ú ü (también
   en mayúscula, por si `lower()` no las baja según el locale). **La "ñ" se distingue de la "n"**
   (Toño ≠ Tono). Es `IMMUTABLE`, con `search_path` fijo y sin extensiones (no usa `unaccent`).
3. **Dónde:** índice único `students_tutor_grade_nickname_uk` sobre
   `(tutor_id, grade, student_nickname_key(nickname))`. Vale para altas, para renombrar y para
   cambiar de curso, venga de donde venga, y resiste dos altas simultáneas. Como incluye
   `tutor_id`, el error nunca revela apodos de otro tutor.
4. **Error:** PostgREST responde **409** con el código `23505` y el nombre del índice; la app lo
   traduce a: "Ya tienes un perfil con ese apodo en N° básico. Elige otro, por ejemplo agrégale un
   número." No se movió el alta a FastAPI.
5. **Duplicados ya existentes:** la migración (`20261118100000_unique_student_nickname.sql`) revisa
   antes de crear el índice. Si los hay, **se detiene** con la cantidad de grupos (sin apodos ni
   ids) y **no borra ni renombra nada**. La app **no tiene pantalla para renombrar**, así que el
   procedimiento es:
   1. Quien despliega encuentra los grupos con la consulta de abajo (solo lectura, con
      `service_role`).
   2. Contacta a cada tutor afectado **por el canal de soporte** y le explica que tiene dos perfiles
      con el mismo apodo en el mismo curso.
   3. **Deja constancia de su acuerdo** (fecha, canal y qué aceptó: qué perfil cambia y a qué
      apodo, o cuál borra él mismo desde el panel) en el registro de soporte, sin copiar los apodos
      fuera de la base.
   4. Resuelve con **una instrucción administrativa** sobre ese perfil (`update` del apodo por su
      id, en una transacción), solo con el acuerdo registrado.
   5. Vuelve a aplicar la migración.

   **Los apodos no se copian fuera de la base**: ni en tickets, ni en correos, ni en planillas ni en
   registros. Para hablar con el tutor basta el curso y el id del perfil.

   Consulta de solo lectura para encontrarlos:

   ```sql
   select s.tutor_id, s.grade, count(*) as perfiles
   from public.students s
   group by s.tutor_id, s.grade, public.student_nickname_key(s.nickname)
   having count(*) > 1;
   ```

   En la base local, al decidirlo, no había duplicados.

## Consecuencias

- No hay datos nuevos: el índice se calcula del apodo que ya se guarda. El inventario lo registra
  como "sin datos nuevos" y aclara que un apodo repetido deja el apodo normalizado (del mismo tutor)
  en los registros de Postgres/Supabase, con la retención del plan.
- Hoy la app no tiene pantalla para renombrar ni cambiar de curso; si se agrega, el mismo error y el
  mismo mensaje sirven.
- Pruebas: `supabase/tests/database/unique_student_nickname.test.sql` (pgTAP) y las de la app
  (`supabase-profiles.service.spec.ts`, `profile-form.component.spec.ts`).
