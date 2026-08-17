-- Scheduled sessions (agenda): server-visible slot metadata only. `starts_at` and
-- `duration_minutes` are stored in clear (not ciphertext) -- unlike patient_record_entries,
-- this table's whole purpose is letting the DB itself detect a real concurrent double-booking
-- (two transactions racing for the same tenant+starts_at), which needs a comparable value the
-- server can index and constrain. `patient_id` stays a bare uuid, the same AAD-bound reference
-- pattern as patient_record_entries -- no name, note, or other clear-text field about the
-- person is ever a column here. See docs/adr/ADR-S04-02-horario-em-claro-servidor-zero-knowledge.md.

CREATE TABLE IF NOT EXISTS scheduled_sessions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        uuid NOT NULL,
    patient_id       uuid NOT NULL,
    starts_at        timestamptz NOT NULL,
    duration_minutes integer NOT NULL,
    recording_active boolean NOT NULL DEFAULT false,
    cancelled_at     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT duration_positive CHECK (duration_minutes BETWEEN 1 AND 1440)
);

-- Partial unique index, live rows only (cancelled_at IS NULL): this is what makes "two
-- concurrent transactions for the exact same slot produce exactly one winner" a DB-enforced
-- guarantee rather than an application race. It only catches an EXACT starts_at match --
-- ponytail: a 60-minute session at 10:00 and another at 10:30 do NOT collide under this index
-- even though they overlap; the acceptance criterion for this ticket is literally "mesmo
-- horário" (exact same instant), not partial overlap. Upgrade path if/when partial overlap
-- becomes a written requirement: replace this index with
-- `EXCLUDE USING gist (tenant_id WITH =, tsrange(starts_at, starts_at + make_interval(mins => duration_minutes)) WITH &&) WHERE (cancelled_at IS NULL)`,
-- which needs the btree_gist extension -- neither EXCLUDE/gist nor btree_gist are introduced here.
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_sessions_live_slot_uq
    ON scheduled_sessions (tenant_id, starts_at) WHERE cancelled_at IS NULL;

ALTER TABLE scheduled_sessions ENABLE ROW LEVEL SECURITY;

-- FORCE is required, not just ENABLE: without it, the table owner (and any superuser)
-- bypasses the policy below entirely -- same reasoning as 0001_create_health_check_probe.
ALTER TABLE scheduled_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON scheduled_sessions;

-- NULLIF guards against a real Postgres GUC-reset quirk -- see 0002_create_patient_record_entries.sql.
CREATE POLICY tenant_isolation ON scheduled_sessions
    USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- app_role and its password are already created by 0002_create_patient_record_entries.sql --
-- only the grants for this new table are needed here.
GRANT SELECT, INSERT ON scheduled_sessions TO app_role;
GRANT UPDATE (starts_at, duration_minutes, cancelled_at) ON scheduled_sessions TO app_role;
REVOKE DELETE ON scheduled_sessions FROM app_role;

-- ponytail: recording_active has no writer nor GRANT in this ticket. Only
-- ScheduledSessionStore's Move/CancelAsync read it (under SELECT ... FOR UPDATE) to reject
-- moving/cancelling a session mid-recording. The future S05/S06 migration that introduces the
-- endpoint which starts/stops a recording must also add `GRANT UPDATE (recording_active) ON
-- scheduled_sessions TO app_role` at that point -- least-privilege means no grant until there
-- is a writer, not just no writer. That endpoint's UPDATE then queues behind the same
-- row-level lock, so no second table or second lock needs inventing when it lands.
