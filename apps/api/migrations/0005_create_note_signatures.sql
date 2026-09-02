-- Server-visible signature for one note: the server sees the note's existence, its revisão,
-- and the instant it was signed, plus a 60-byte sealed blob it cannot open. In exchange, the
-- one-signature-per-note lock is enforced by Postgres, not merely remembered client-side.
-- See docs/adr/ADR-S08-01-assinatura-visivel-ao-servidor.md for what this trades away
-- against the zero-knowledge default that `patient_record_entries` set.

CREATE TABLE IF NOT EXISTS note_signatures (
    tenant_id  uuid NOT NULL,        -- = owning professional's account id, same convention as patient_record_entries
    note_id    uuid NOT NULL,        -- = the sessionId, client-generated (scheduled_sessions.id)
    revisao    integer NOT NULL,     -- entra na AAD do blob selado -- impede replicar a assinatura para outra revisão
    signature  bytea NOT NULL,       -- iv(12) || AES-GCM(digest SHA-256 da nota)(32) || tag(16), opaco ao servidor
    signed_at  timestamptz NOT NULL DEFAULT now(),
    -- The PRIMARY KEY is what guarantees "uma assinatura por nota, para sempre" -- there is no
    -- second, softer enforcement layer for this rule, see the ponytail note below.
    PRIMARY KEY (tenant_id, note_id),
    -- Belt-and-suspenders under the endpoint's own `revisao >= 0` validation -- same spirit as
    -- patient_record_entries' sequence_positive check.
    CONSTRAINT revisao_not_negative CHECK (revisao >= 0)
);

ALTER TABLE note_signatures ENABLE ROW LEVEL SECURITY;

-- FORCE is required, not just ENABLE: without it, the table owner (and any superuser)
-- bypasses the policy below entirely -- same reasoning as 0001_create_health_check_probe.
ALTER TABLE note_signatures FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON note_signatures;

-- NULLIF guards against a real Postgres GUC-reset quirk -- see 0002_create_patient_record_entries.sql.
CREATE POLICY tenant_isolation ON note_signatures
    USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- app_role and its password are already created by 0002_create_patient_record_entries.sql --
-- only the grants for this new table are needed here.
GRANT SELECT, INSERT ON note_signatures TO app_role;
REVOKE UPDATE, DELETE ON note_signatures FROM app_role;

-- ponytail: no BEFORE UPDATE OR DELETE immutability trigger, same call as
-- patient_record_entries. Three alternatives were considered and rejected for enforcing
-- "uma assinatura por nota, para sempre" beyond what the PK already guarantees:
--   - A CHECK constraint: Postgres CHECK expressions see only the row being written, never
--     another row or another table -- there is no way to express "no earlier row for this
--     (tenant_id, note_id) already exists" as a CHECK.
--   - A unique partial index: PRIMARY KEY (tenant_id, note_id) already IS a unique index over
--     exactly those columns -- a second one would just repeat the guarantee the PK gives for
--     free, at the cost of a second index to maintain.
--   - A composite foreign key to scheduled_sessions with a generated column: this would force
--     the server to know which note_signatures rows belong to which scheduled_sessions row
--     ahead of the signature ever being written -- metadata linkage this table is not supposed
--     to carry (see the "sem patient_id" note below) -- and a foreign key does not even
--     deduplicate, so it would not address the "one signature" rule anyway.
-- The GRANT/REVOKE pair above already closes every write path app_role has, and app_role is
-- the only role the running API ever connects as -- a trigger would be a second enforcement
-- layer for a threat model (a second, non-app_role writer role) that does not exist yet.

-- ponytail: sem `patient_id`. Não tem leitor neste ticket -- nenhuma rota deste ticket devolve
-- ou filtra assinaturas por paciente -- e a aresta nota->paciente já é visível ao servidor por
-- `scheduled_sessions(id, patient_id)` com `id = note_id`, então duplicá-la aqui seria só mais
-- um caminho de leitura para o mesmo dado, não um dado novo.

-- Sem `id` sintético: a chave primária composta (tenant_id, note_id) já identifica a linha de
-- forma única -- um uuid `id` adicional não teria leitor, só mais uma coluna a manter.

-- Sem `signed_by`: neste modelo tenant_id já É o profissional que assina (mesma convenção de
-- patient_record_entries, onde tenant_id = Accounts.Account.Id) -- uma coluna `signed_by`
-- seria idêntica a `tenant_id` linha a linha, sem informação nova.
