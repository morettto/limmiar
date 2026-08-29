-- Log append-only de consentimento por (paciente, finalidade). O estado atual NAO e uma coluna:
-- e o fold do log (Api.Consent.ConsentState.Fold). Revogar e um INSERT; o GRANT/REVOKE abaixo e
-- o que torna "nao afeta acao passada" estrutural, e nao uma regra que a aplicacao se lembra.
CREATE TABLE IF NOT EXISTS consent_events (
    tenant_id   uuid NOT NULL,                 -- = conta do profissional, mesma convencao das outras
    patient_id  uuid NOT NULL,                 -- uuid nu, sem nome/nota (ADR-S04-02)
    purpose     smallint NOT NULL,             -- ordinal de Api.Consent.ConsentPurpose
    decision    smallint NOT NULL,             -- ordinal de Api.Consent.ConsentDecision
    recorded_at timestamptz NOT NULL DEFAULT now(),
    -- Identidade = "esta decisao, para esta finalidade, neste instante". O prefixo
    -- (tenant_id, patient_id) serve ListAsync, logo nenhum indice adicional.
    PRIMARY KEY (tenant_id, patient_id, purpose, recorded_at),
    CONSTRAINT consent_purpose_range  CHECK (purpose  BETWEEN 0 AND 1),
    CONSTRAINT consent_decision_range CHECK (decision BETWEEN 0 AND 1)
);
ALTER TABLE consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_events FORCE ROW LEVEL SECURITY;   -- sem FORCE o dono da tabela passa por cima
DROP POLICY IF EXISTS tenant_isolation ON consent_events;
CREATE POLICY tenant_isolation ON consent_events
    USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON consent_events TO app_role;
REVOKE UPDATE, DELETE ON consent_events FROM app_role;
-- ponytail: now() e o instante de inicio da transacao -- duas escritas concorrentes para o mesmo
-- (paciente, finalidade) podem ficar ordenadas pelo relogio e nao pela ordem de commit. Nao e
-- caminho concorrente real (mesmo profissional, mesmo paciente, acao manual). Teto/upgrade: uma
-- sequence por (tenant, patient, purpose), como audit_entries ja faz.
-- ponytail: sem device_id/actor_id -- nenhum criterio os le, e "de que dispositivo" e trabalho da
-- trilha de auditoria, nao deste log.
