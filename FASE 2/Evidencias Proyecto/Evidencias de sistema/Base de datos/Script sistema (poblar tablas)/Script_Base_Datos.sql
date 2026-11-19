-- =============================================================================
-- NumiMath (Proyecto 7: IA Matemática) · Base de datos del sistema
-- Script del sistema: creación de las tablas
-- Motor: PostgreSQL 17 (el mismo que usa Supabase local). Versión del MVP: 18-nov-2026
-- =============================================================================
-- Uso en una base vacía de PostgreSQL:
--     createdb numimath
--     psql -d numimath -v ON_ERROR_STOP=1 -f Script_Base_Datos.sql
--
-- Qué contiene:
--   Las 23 tablas del esquema «public» con sus claves primarias, claves foráneas,
--   restricciones CHECK e índices. Es la misma estructura que crean las 42 migraciones
--   de supabase/migrations.
--
-- Qué no contiene (viene en las migraciones del repositorio):
--   Seguridad por filas (RLS), políticas y permisos por rol, las 87 funciones de la
--   lógica de negocio y los 26 triggers. Para el sistema completo se usa «supabase start».
--
-- Las cuentas de adultos (tutores, docentes y administrador) viven en la tabla auth.users
-- que entrega Supabase. Aquí se crea una versión mínima solo si no existe, para poder
-- correr el script en PostgreSQL común.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. CUENTAS (esquema auth) Y FUNCIÓN DE APODOS
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
    id    uuid PRIMARY KEY,
    email text UNIQUE
);

-- Usada por el índice único de apodos (no distingue mayúsculas ni tildes).
CREATE OR REPLACE FUNCTION public.student_nickname_key(p_nickname text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
  select pg_catalog.translate(
    pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(p_nickname), '\s+', ' ', 'g')),
    'áéíóúüÁÉÍÓÚÜÑ',
    'aeiouuaeiouuñ'
  )
$function$;

-- -----------------------------------------------------------------------------
-- 1. CREACIÓN DE TABLAS
-- -----------------------------------------------------------------------------

CREATE TABLE public.admin_audit (
    seq bigint NOT NULL,
    admin_id uuid NOT NULL,
    action text NOT NULL,
    target_id uuid NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_audit_action_check CHECK ((action = ANY (ARRAY['teacher_created'::text, 'teacher_updated'::text, 'teacher_deleted'::text])))
);

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    CONSTRAINT app_settings_values_valid CHECK (
CASE key
    WHEN 'consent_evidence_retention_days'::text THEN ((value = 'null'::jsonb) OR ((jsonb_typeof(value) = 'number'::text) AND
    CASE
        WHEN ((value #>> '{}'::text[]) ~ '^[0-9]{1,5}$'::text) THEN ((((value #>> '{}'::text[]))::integer >= 1) AND (((value #>> '{}'::text[]))::integer <= 36500))
        ELSE false
    END))
    WHEN 'blocked_profile_retention_days'::text THEN ((jsonb_typeof(value) = 'number'::text) AND
    CASE
        WHEN ((value #>> '{}'::text[]) ~ '^[0-9]{1,5}$'::text) THEN ((((value #>> '{}'::text[]))::integer >= 1) AND (((value #>> '{}'::text[]))::integer <= 36500))
        ELSE false
    END)
    WHEN 'inactive_profile_retention_days'::text THEN ((jsonb_typeof(value) = 'number'::text) AND
    CASE
        WHEN ((value #>> '{}'::text[]) ~ '^[0-9]{1,5}$'::text) THEN ((((value #>> '{}'::text[]))::integer >= 1) AND (((value #>> '{}'::text[]))::integer <= 36500))
        ELSE false
    END)
    WHEN 'sheet_retention_days'::text THEN ((jsonb_typeof(value) = 'number'::text) AND
    CASE
        WHEN ((value #>> '{}'::text[]) ~ '^[0-9]{1,5}$'::text) THEN ((((value #>> '{}'::text[]))::integer >= 1) AND (((value #>> '{}'::text[]))::integer <= 36500))
        ELSE false
    END)
    WHEN 'sheet_saves_per_minute'::text THEN ((jsonb_typeof(value) = 'number'::text) AND
    CASE
        WHEN ((value #>> '{}'::text[]) ~ '^[0-9]{1,4}$'::text) THEN ((((value #>> '{}'::text[]))::integer >= 1) AND (((value #>> '{}'::text[]))::integer <= 1000))
        ELSE false
    END)
    WHEN 'sheet_saves_per_day'::text THEN ((jsonb_typeof(value) = 'number'::text) AND
    CASE
        WHEN ((value #>> '{}'::text[]) ~ '^[0-9]{1,5}$'::text) THEN ((((value #>> '{}'::text[]))::integer >= 1) AND (((value #>> '{}'::text[]))::integer <= 100000))
        ELSE false
    END)
    WHEN 'blocked_profile_retention_confirmed'::text THEN (jsonb_typeof(value) = 'boolean'::text)
    WHEN 'inactive_profile_retention_confirmed'::text THEN (jsonb_typeof(value) = 'boolean'::text)
    WHEN 'consent_evidence_retention_confirmed'::text THEN (jsonb_typeof(value) = 'boolean'::text)
    WHEN 'sheet_retention_confirmed'::text THEN (jsonb_typeof(value) = 'boolean'::text)
    WHEN 'student_creations_per_day'::text THEN ((jsonb_typeof(value) = 'number'::text) AND
    CASE
        WHEN ((value #>> '{}'::text[]) ~ '^[0-9]{1,4}$'::text) THEN ((((value #>> '{}'::text[]))::integer >= 1) AND (((value #>> '{}'::text[]))::integer <= 1000))
        ELSE false
    END)
    ELSE true
END)
);

CREATE TABLE public.assigned_exercises (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    tutor_id uuid NOT NULL,
    text text NOT NULL,
    answer integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    correct boolean,
    CONSTRAINT assigned_exercises_answer_check CHECK (((answer >= 0) AND (answer <= 1000000))),
    CONSTRAINT assigned_exercises_answered_consistent CHECK (((answered_at IS NULL) = (correct IS NULL))),
    CONSTRAINT assigned_exercises_text_check CHECK (((char_length(text) >= 1) AND (char_length(text) <= 200)))
);

CREATE TABLE public.consent_evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_ref text NOT NULL,
    hmac_key_version smallint NOT NULL,
    event_type text NOT NULL,
    terms_version text NOT NULL,
    privacy_version text NOT NULL,
    channel text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    source_seq bigint NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL,
    terms_sha256 text NOT NULL,
    privacy_sha256 text NOT NULL,
    CONSTRAINT consent_evidence_channel_check CHECK ((channel = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text]))),
    CONSTRAINT consent_evidence_event_type_check CHECK ((event_type = ANY (ARRAY['grant'::text, 'revoke'::text]))),
    CONSTRAINT consent_evidence_hmac_key_version_check CHECK ((hmac_key_version > 0)),
    CONSTRAINT consent_evidence_privacy_sha_check CHECK ((privacy_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT consent_evidence_terms_sha_check CHECK ((terms_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT consent_evidence_tutor_ref_check CHECK ((tutor_ref ~ '^[0-9a-f]{64}$'::text))
);

CREATE TABLE public.consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_id uuid NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    seq bigint NOT NULL,
    event_type text DEFAULT 'grant'::text NOT NULL,
    terms_version_id uuid NOT NULL,
    privacy_version_id uuid NOT NULL,
    channel text DEFAULT 'web'::text NOT NULL,
    CONSTRAINT consents_channel_check CHECK ((channel = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text]))),
    CONSTRAINT consents_event_type_check CHECK ((event_type = ANY (ARRAY['grant'::text, 'revoke'::text])))
);

CREATE TABLE public.declaration_evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consent_seq bigint NOT NULL,
    declaration_version text NOT NULL,
    declaration_sha256 text NOT NULL,
    declared_at timestamp with time zone NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT declaration_evidence_declaration_sha256_check CHECK ((declaration_sha256 ~ '^[0-9a-f]{64}$'::text))
);

CREATE TABLE public.diagnostic_declines (
    student_id uuid NOT NULL,
    tutor_id uuid NOT NULL,
    skill_code text NOT NULL,
    declined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT diagnostic_declines_skill_code_check CHECK ((skill_code ~ '^[1-4]-[0-9]{2}$'::text))
);

CREATE TABLE public.legal_document_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    version text NOT NULL,
    content_sha256 text NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    is_current boolean DEFAULT false NOT NULL,
    covers_sheets boolean DEFAULT false NOT NULL,
    CONSTRAINT legal_document_versions_content_sha256_check CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT legal_document_versions_kind_check CHECK ((kind = ANY (ARRAY['terms'::text, 'privacy'::text, 'adult_declaration'::text, 'teacher_authorization'::text]))),
    CONSTRAINT legal_document_versions_version_check CHECK (((char_length(version) >= 1) AND (char_length(version) <= 40)))
);

CREATE TABLE public.link_code_attempts (
    tutor_id uuid NOT NULL,
    failed smallint DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sheet_save_counters (
    tutor_id uuid NOT NULL,
    day date NOT NULL,
    n_day integer DEFAULT 0 NOT NULL,
    minute_start timestamp with time zone DEFAULT now() NOT NULL,
    n_minute integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.student_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    tutor_id uuid NOT NULL,
    exercise_id uuid NOT NULL,
    topic text NOT NULL,
    exercise text NOT NULL,
    correct boolean NOT NULL,
    answered_at timestamp with time zone DEFAULT now() NOT NULL,
    level smallint DEFAULT 1 NOT NULL,
    duration_s smallint,
    activity text DEFAULT 'practice'::text NOT NULL,
    game_kind text,
    CONSTRAINT student_attempts_activity_check CHECK ((activity = ANY (ARRAY['practice'::text, 'diagnostic'::text, 'game'::text]))),
    CONSTRAINT student_attempts_duration_range CHECK (((duration_s >= 0) AND (duration_s <= 600))),
    CONSTRAINT student_attempts_exercise_check CHECK (((char_length(exercise) >= 1) AND (char_length(exercise) <= 200))),
    CONSTRAINT student_attempts_game_kind_check CHECK ((((activity = 'game'::text) AND (game_kind IS NOT NULL) AND (game_kind ~ '^[a-z0-9-]{1,40}$'::text)) OR ((activity <> 'game'::text) AND (game_kind IS NULL)))),
    CONSTRAINT student_attempts_level_range CHECK (((level >= 1) AND (level <= 3))),
    CONSTRAINT student_attempts_topic_check CHECK (((char_length(topic) >= 1) AND (char_length(topic) <= 60)))
);

CREATE TABLE public.student_creation_log (
    id bigint NOT NULL,
    tutor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.student_daily_streaks (
    student_id uuid NOT NULL,
    tutor_id uuid NOT NULL,
    current_len integer NOT NULL,
    last_day date NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_daily_streaks_current_len_check CHECK ((current_len >= 1))
);

CREATE TABLE public.student_sheets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    tutor_id uuid NOT NULL,
    exercise_id uuid NOT NULL,
    topic text NOT NULL,
    correct boolean NOT NULL,
    content jsonb NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_sheets_content_shape CHECK (((jsonb_typeof(content) = 'object'::text) AND (jsonb_typeof((content -> 'strokes'::text)) = 'array'::text) AND (octet_length((content)::text) <= 300000))),
    CONSTRAINT student_sheets_topic_check CHECK (((char_length(topic) >= 1) AND (char_length(topic) <= 60)))
);

CREATE TABLE public.student_skill_progress (
    student_id uuid NOT NULL,
    tutor_id uuid NOT NULL,
    skill_code text NOT NULL,
    level smallint DEFAULT 1 NOT NULL,
    block_total smallint DEFAULT 0 NOT NULL,
    block_correct smallint DEFAULT 0 NOT NULL,
    mastered_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_skill_progress_block_total_check CHECK (((block_total >= 0) AND (block_total <= 9))),
    CONSTRAINT student_skill_progress_check CHECK (((block_correct >= 0) AND (block_correct <= block_total))),
    CONSTRAINT student_skill_progress_level_check CHECK (((level >= 1) AND (level <= 3))),
    CONSTRAINT student_skill_progress_skill_code_check CHECK ((skill_code ~ '^[1-4]-[0-9]{2}$'::text))
);

CREATE TABLE public.student_status_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    tutor_id uuid NOT NULL,
    event_type text NOT NULL,
    reason text NOT NULL,
    consent_seq bigint,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_status_events_event_type_check CHECK ((event_type = ANY (ARRAY['blocked'::text, 'unblocked'::text]))),
    CONSTRAINT student_status_events_reason_check CHECK ((reason = ANY (ARRAY['consent_revoked'::text, 'tutor_request'::text, 'arcop_claim'::text, 'manual_unblock'::text])))
);

CREATE TABLE public.students (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_id uuid NOT NULL,
    nickname text NOT NULL,
    grade smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    consent_id uuid NOT NULL,
    adult_declaration_accepted boolean DEFAULT false NOT NULL,
    adult_declaration_version_id uuid NOT NULL,
    adult_declared_at timestamp with time zone NOT NULL,
    blocked_at timestamp with time zone,
    consent_seq bigint NOT NULL,
    declaration_consent_seq bigint NOT NULL,
    blocked_reason text,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL,
    streak_reminder boolean DEFAULT false NOT NULL,
    CONSTRAINT students_adult_declaration_required CHECK (adult_declaration_accepted),
    CONSTRAINT students_blocked_reason_consistent CHECK (((blocked_at IS NULL) = (blocked_reason IS NULL))),
    CONSTRAINT students_blocked_reason_valid CHECK ((blocked_reason = ANY (ARRAY['consent_revoked'::text, 'tutor_request'::text, 'arcop_claim'::text]))),
    CONSTRAINT students_grade_range CHECK (((grade >= 1) AND (grade <= 4))),
    CONSTRAINT students_nickname_len CHECK (((nickname = btrim(nickname)) AND ((char_length(nickname) >= 1) AND (char_length(nickname) <= 30))))
);

CREATE TABLE public.teacher_links (
    teacher_id uuid NOT NULL,
    student_id uuid NOT NULL,
    tutor_id uuid NOT NULL,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    terms_version_id uuid NOT NULL,
    teacher_name text NOT NULL,
    CONSTRAINT teacher_links_teacher_name_len CHECK (((char_length(teacher_name) >= 1) AND (char_length(teacher_name) <= 60)))
);

CREATE TABLE public.teachers (
    id uuid NOT NULL,
    name text NOT NULL,
    link_code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teachers_link_code_format CHECK ((link_code ~ '^[A-Z2-9]{8}$'::text)),
    CONSTRAINT teachers_name_len CHECK (((name = btrim(name)) AND ((char_length(name) >= 1) AND (char_length(name) <= 60))))
);

CREATE TABLE public.tutor_pins (
    tutor_id uuid NOT NULL,
    pin_hash text NOT NULL,
    failed_attempts smallint DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_pins_failed_attempts_check CHECK ((failed_attempts >= 0)),
    CONSTRAINT tutor_pins_pin_hash_check CHECK (((char_length(pin_hash) >= 20) AND (char_length(pin_hash) <= 300)))
);

CREATE TABLE public.tutors (
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    max_students smallint DEFAULT 5 NOT NULL,
    CONSTRAINT tutors_max_students_range CHECK (((max_students >= 1) AND (max_students <= 20)))
);

CREATE TABLE public.usage_student_daily (
    tutor_id uuid NOT NULL,
    student_id uuid NOT NULL,
    day date NOT NULL,
    requests integer DEFAULT 0 NOT NULL,
    cost_units integer DEFAULT 0 NOT NULL,
    offline_batches integer DEFAULT 0 NOT NULL,
    CONSTRAINT usage_student_daily_cost_units_check CHECK ((cost_units >= 0)),
    CONSTRAINT usage_student_daily_offline_batches_check CHECK ((offline_batches >= 0)),
    CONSTRAINT usage_student_daily_requests_check CHECK ((requests >= 0))
);

CREATE TABLE public.usage_tutor_daily (
    tutor_id uuid NOT NULL,
    day date NOT NULL,
    requests integer DEFAULT 0 NOT NULL,
    cost_units integer DEFAULT 0 NOT NULL,
    CONSTRAINT usage_tutor_daily_cost_units_check CHECK ((cost_units >= 0)),
    CONSTRAINT usage_tutor_daily_requests_check CHECK ((requests >= 0))
);

-- Columnas de identidad (números autogenerados)
ALTER TABLE public.admin_audit ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.admin_audit_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
ALTER TABLE public.consents ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.consents_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
ALTER TABLE public.student_creation_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.student_creation_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- -----------------------------------------------------------------------------
-- 2. CLAVES PRIMARIAS Y RESTRICCIONES ÚNICAS
-- -----------------------------------------------------------------------------
ALTER TABLE ONLY public.admin_audit
    ADD CONSTRAINT admin_audit_pkey PRIMARY KEY (seq);
ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.assigned_exercises
    ADD CONSTRAINT assigned_exercises_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.consent_evidence
    ADD CONSTRAINT consent_evidence_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.consent_evidence
    ADD CONSTRAINT consent_evidence_source_seq_key UNIQUE (source_seq);
ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.declaration_evidence
    ADD CONSTRAINT declaration_evidence_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.diagnostic_declines
    ADD CONSTRAINT diagnostic_declines_pkey PRIMARY KEY (student_id, skill_code);
ALTER TABLE ONLY public.legal_document_versions
    ADD CONSTRAINT legal_document_versions_kind_version_key UNIQUE (kind, version);
ALTER TABLE ONLY public.legal_document_versions
    ADD CONSTRAINT legal_document_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.link_code_attempts
    ADD CONSTRAINT link_code_attempts_pkey PRIMARY KEY (tutor_id);
ALTER TABLE ONLY public.sheet_save_counters
    ADD CONSTRAINT sheet_save_counters_pkey PRIMARY KEY (tutor_id, day);
ALTER TABLE ONLY public.student_attempts
    ADD CONSTRAINT student_attempts_once UNIQUE (student_id, exercise_id);
ALTER TABLE ONLY public.student_attempts
    ADD CONSTRAINT student_attempts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.student_creation_log
    ADD CONSTRAINT student_creation_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.student_daily_streaks
    ADD CONSTRAINT student_daily_streaks_pkey PRIMARY KEY (student_id);
ALTER TABLE ONLY public.student_sheets
    ADD CONSTRAINT student_sheets_once UNIQUE (student_id, exercise_id);
ALTER TABLE ONLY public.student_sheets
    ADD CONSTRAINT student_sheets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.student_skill_progress
    ADD CONSTRAINT student_skill_progress_pkey PRIMARY KEY (student_id, skill_code);
ALTER TABLE ONLY public.student_status_events
    ADD CONSTRAINT student_status_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_id_tutor_uk UNIQUE (id, tutor_id);
ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_id_tutor_unique UNIQUE (id, tutor_id);
ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.teacher_links
    ADD CONSTRAINT teacher_links_pkey PRIMARY KEY (teacher_id, student_id);
ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_link_code_key UNIQUE (link_code);
ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tutor_pins
    ADD CONSTRAINT tutor_pins_pkey PRIMARY KEY (tutor_id);
ALTER TABLE ONLY public.tutors
    ADD CONSTRAINT tutors_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.usage_student_daily
    ADD CONSTRAINT usage_student_daily_pkey PRIMARY KEY (student_id, day);
ALTER TABLE ONLY public.usage_tutor_daily
    ADD CONSTRAINT usage_tutor_daily_pkey PRIMARY KEY (tutor_id, day);

-- -----------------------------------------------------------------------------
-- 3. ÍNDICES
-- -----------------------------------------------------------------------------
CREATE INDEX admin_audit_admin_idx ON public.admin_audit USING btree (admin_id, seq);
CREATE INDEX assigned_exercises_student_idx ON public.assigned_exercises USING btree (student_id, answered_at NULLS FIRST, created_at DESC);
CREATE INDEX assigned_exercises_tutor_idx ON public.assigned_exercises USING btree (tutor_id);
CREATE INDEX consent_evidence_archived_at_idx ON public.consent_evidence USING btree (archived_at);
CREATE INDEX consent_evidence_tutor_ref_idx ON public.consent_evidence USING btree (tutor_ref);
CREATE INDEX consents_tutor_seq_idx ON public.consents USING btree (tutor_id, seq DESC);
CREATE INDEX declaration_evidence_archived_at_idx ON public.declaration_evidence USING btree (archived_at);
CREATE INDEX declaration_evidence_consent_seq_idx ON public.declaration_evidence USING btree (consent_seq);
CREATE INDEX diagnostic_declines_tutor_idx ON public.diagnostic_declines USING btree (tutor_id);
CREATE UNIQUE INDEX legal_document_versions_one_current_idx ON public.legal_document_versions USING btree (kind) WHERE is_current;
CREATE INDEX student_attempts_game_time_idx ON public.student_attempts USING btree (answered_at) WHERE (activity = 'game'::text);
CREATE INDEX student_attempts_practice_time_idx ON public.student_attempts USING btree (student_id, answered_at DESC) WHERE (activity = 'practice'::text);
CREATE INDEX student_attempts_practice_topic_time_idx ON public.student_attempts USING btree (student_id, topic, answered_at DESC) WHERE (activity = 'practice'::text);
CREATE INDEX student_attempts_student_time_idx ON public.student_attempts USING btree (student_id, answered_at DESC);
CREATE INDEX student_attempts_student_topic_time_idx ON public.student_attempts USING btree (student_id, topic, answered_at DESC);
CREATE INDEX student_creation_log_tutor_idx ON public.student_creation_log USING btree (tutor_id, created_at);
CREATE INDEX student_daily_streaks_tutor_idx ON public.student_daily_streaks USING btree (tutor_id);
CREATE INDEX student_sheets_saved_at_idx ON public.student_sheets USING btree (saved_at);
CREATE INDEX student_sheets_student_time_idx ON public.student_sheets USING btree (student_id, saved_at DESC);
CREATE INDEX student_sheets_tutor_idx ON public.student_sheets USING btree (tutor_id);
CREATE INDEX student_skill_progress_tutor_idx ON public.student_skill_progress USING btree (tutor_id);
CREATE INDEX student_status_events_student_idx ON public.student_status_events USING btree (student_id, occurred_at DESC);
CREATE INDEX student_status_events_tutor_idx ON public.student_status_events USING btree (tutor_id);
CREATE INDEX students_blocked_at_idx ON public.students USING btree (blocked_at) WHERE (blocked_at IS NOT NULL);
CREATE INDEX students_consent_id_idx ON public.students USING btree (consent_id);
CREATE INDEX students_last_active_at_idx ON public.students USING btree (last_active_at);
CREATE UNIQUE INDEX students_tutor_grade_nickname_uk ON public.students USING btree (tutor_id, grade, public.student_nickname_key(nickname));
CREATE INDEX students_tutor_id_idx ON public.students USING btree (tutor_id);
CREATE INDEX teacher_links_student_idx ON public.teacher_links USING btree (student_id);
CREATE INDEX teacher_links_tutor_idx ON public.teacher_links USING btree (tutor_id);
CREATE INDEX usage_student_daily_tutor_idx ON public.usage_student_daily USING btree (tutor_id, day);
CREATE INDEX usage_tutor_daily_day_idx ON public.usage_tutor_daily USING btree (day);

-- -----------------------------------------------------------------------------
-- 4. CLAVES FORÁNEAS
-- -----------------------------------------------------------------------------
ALTER TABLE ONLY public.assigned_exercises
    ADD CONSTRAINT assigned_exercises_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.assigned_exercises
    ADD CONSTRAINT assigned_exercises_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_privacy_version_id_fkey FOREIGN KEY (privacy_version_id) REFERENCES public.legal_document_versions(id);
ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_terms_version_id_fkey FOREIGN KEY (terms_version_id) REFERENCES public.legal_document_versions(id);
ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.diagnostic_declines
    ADD CONSTRAINT diagnostic_declines_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.diagnostic_declines
    ADD CONSTRAINT diagnostic_declines_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.link_code_attempts
    ADD CONSTRAINT link_code_attempts_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sheet_save_counters
    ADD CONSTRAINT sheet_save_counters_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.student_attempts
    ADD CONSTRAINT student_attempts_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.student_attempts
    ADD CONSTRAINT student_attempts_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.student_creation_log
    ADD CONSTRAINT student_creation_log_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.student_daily_streaks
    ADD CONSTRAINT student_daily_streaks_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.student_daily_streaks
    ADD CONSTRAINT student_daily_streaks_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.student_sheets
    ADD CONSTRAINT student_sheets_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.student_sheets
    ADD CONSTRAINT student_sheets_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.student_skill_progress
    ADD CONSTRAINT student_skill_progress_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.student_skill_progress
    ADD CONSTRAINT student_skill_progress_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.student_status_events
    ADD CONSTRAINT student_status_events_student_id_tutor_id_fkey FOREIGN KEY (student_id, tutor_id) REFERENCES public.students(id, tutor_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_adult_declaration_version_id_fkey FOREIGN KEY (adult_declaration_version_id) REFERENCES public.legal_document_versions(id);
ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_consent_id_fkey FOREIGN KEY (consent_id) REFERENCES public.consents(id);
ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.teacher_links
    ADD CONSTRAINT teacher_links_student_id_tutor_id_fkey FOREIGN KEY (student_id, tutor_id) REFERENCES public.students(id, tutor_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.teacher_links
    ADD CONSTRAINT teacher_links_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.teacher_links
    ADD CONSTRAINT teacher_links_terms_version_id_fkey FOREIGN KEY (terms_version_id) REFERENCES public.legal_document_versions(id);
ALTER TABLE ONLY public.teacher_links
    ADD CONSTRAINT teacher_links_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tutor_pins
    ADD CONSTRAINT tutor_pins_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tutors
    ADD CONSTRAINT tutors_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.usage_student_daily
    ADD CONSTRAINT usage_student_daily_student_id_tutor_id_fkey FOREIGN KEY (student_id, tutor_id) REFERENCES public.students(id, tutor_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.usage_tutor_daily
    ADD CONSTRAINT usage_tutor_daily_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id) ON DELETE CASCADE;

COMMIT;
