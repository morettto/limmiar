-- Append-only, encrypted patient record: one row per prontuário entry, sequence 1
-- carries the wrapped DEK for the patient (created at patient-creation time). Every
-- clinical field lives inside `ciphertext`, opaque to this database -- there is no
-- `patients` table and no `aad` column (AAD is derived client-side from patientId/
-- sequence, never stored server-side).

CREATE TABLE IF NOT EXISTS patient_record_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL,          -- = owning professional's account id (Accounts.Account.Id)
    patient_id  uuid NOT NULL,          -- client-generated uuid, AAD-bound
    sequence    integer NOT NULL,       -- 1-based per patient; 1 == creation entry, carries wrapped_dek
    wrapped_dek bytea,                  -- NOT NULL iff sequence = 1
    ciphertext  bytea NOT NULL,         -- iv||ct||tag, opaque to the server
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT wrapped_dek_only_on_sequence_1 CHECK (
        (sequence = 1 AND wrapped_dek IS NOT NULL) OR (sequence <> 1 AND wrapped_dek IS NULL)
    ),
    -- Belt-and-suspenders under PatientService's strict "sequence must be lastSequence + 1"
    -- application check: fails closed at the DB layer too if that check is ever bypassed or
    -- a future write path forgets it.
    CONSTRAINT sequence_positive CHECK (sequence >= 1),
    UNIQUE (tenant_id, patient_id, sequence)
);

ALTER TABLE patient_record_entries ENABLE ROW LEVEL SECURITY;

-- FORCE is required, not just ENABLE: without it, the table owner (and any superuser)
-- bypasses the policy below entirely -- same reasoning as 0001_create_health_check_probe.
ALTER TABLE patient_record_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON patient_record_entries;

-- NULLIF guards against a real Postgres GUC-reset quirk, not a hypothetical: once any
-- transaction on a pooled backend has called set_config('app.tenant_id', ..., true), a
-- later transaction on that same reused physical connection that never sets it again sees
-- current_setting(..., true) return '' (empty string), not NULL -- so a bare `::uuid` cast
-- throws 22P02 instead of failing closed to "no rows". NULLIF('', '') -> NULL keeps the
-- no-context case a clean zero-row result under connection-pool reuse.
CREATE POLICY tenant_isolation ON patient_record_entries
    USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- {{APP_ROLE_PASSWORD}} is substituted by MigrationRunner -- see 0001_create_health_check_probe.sql.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_role') THEN
        CREATE ROLE app_role LOGIN PASSWORD '{{APP_ROLE_PASSWORD}}';
    ELSE
        ALTER ROLE app_role PASSWORD '{{APP_ROLE_PASSWORD}}';
    END IF;
END
$$;

-- SELECT + INSERT only: this table is append-only by contract (acceptance criterion
-- "nenhuma operação consegue sobrescrever entrada de prontuário, nem por API direta").
-- Revoking UPDATE/DELETE from app_role -- the only role the running API ever connects
-- as -- closes that path at the DB layer regardless of what the API code does.
GRANT SELECT, INSERT ON patient_record_entries TO app_role;
REVOKE UPDATE, DELETE ON patient_record_entries FROM app_role;

-- ponytail: no BEFORE UPDATE OR DELETE immutability trigger. The GRANT/REVOKE pair above
-- already closes every write path app_role has, and app_role is the only role the API
-- ever connects as (see NpgsqlDataSourceFactory / Program.cs) -- a trigger would be a
-- second enforcement layer for a threat model (a second, non-app_role writer role) that
-- does not exist yet. Add a BEFORE UPDATE OR DELETE RAISE EXCEPTION trigger if/when a
-- second writer role is introduced.
