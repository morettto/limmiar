-- Vinculos, convites, envelopes partilhados e preferencias de compartilhamento (S11-03, fatia 7):
-- deixam de viver em memoria com as contas (S11-03 fatia 6 ja moveu accounts/account_key_pairs).
-- RLS por chave de procura, mesmo molde de 0010_create_accounts.sql -- cada metodo do store ja
-- sabe a chave que vai usar (id da conta ou o codigo do convite), por isso um SELECT sem essa
-- chave na sessao devolve sempre 0 linhas.
--
-- Nesta fatia (7-9 do .harness/S11-03-forma.md), o store em C# so passa a falar Postgres para
-- convites/vinculos (fatia 9) e preferencias (fatia 8). shared_items entra aqui so para a
-- migracao ficar coerente com o esquema final -- o store dos envelopes continua em memoria ate a
-- fatia 10 (lote 3), que tambem traz GET /accounts/{id}/received-shares.

CREATE TABLE IF NOT EXISTS patient_link_invites (
    code                        text PRIMARY KEY CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
    professional_account_id    uuid NOT NULL REFERENCES accounts (id),
    patient_id                 uuid NOT NULL,
    expires_at                 timestamptz NOT NULL,
    created_at                 timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE patient_link_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_link_invites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invite_visible_to_issuer_or_code ON patient_link_invites;

-- app.invite_code (o (d) da abordagem): quem resgata nunca teve uma sessao desta conta antes de
-- redimir, so tem o codigo em maos -- o mesmo problema de app.account_email em accounts.
CREATE POLICY invite_visible_to_issuer_or_code ON patient_link_invites
    FOR SELECT
    USING (
        professional_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        OR code = NULLIF(current_setting('app.invite_code', true), '')
    );

DROP POLICY IF EXISTS invite_delete_by_issuer_or_code ON patient_link_invites;

CREATE POLICY invite_delete_by_issuer_or_code ON patient_link_invites
    FOR DELETE
    USING (
        professional_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        OR code = NULLIF(current_setting('app.invite_code', true), '')
    );

DROP POLICY IF EXISTS invite_insert_by_issuer ON patient_link_invites;

CREATE POLICY invite_insert_by_issuer ON patient_link_invites
    FOR INSERT
    WITH CHECK (professional_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON patient_link_invites TO app_role;

CREATE TABLE IF NOT EXISTS patient_links (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    professional_account_id    uuid NOT NULL REFERENCES accounts (id),
    patient_account_id         uuid NOT NULL REFERENCES accounts (id),
    patient_id                 uuid NOT NULL,
    linked_at                   timestamptz NOT NULL,
    unlinked_at                 timestamptz,
    CONSTRAINT patient_links_distinct_accounts CHECK (professional_account_id <> patient_account_id),
    CONSTRAINT patient_links_unlinked_after_linked CHECK (unlinked_at IS NULL OR unlinked_at >= linked_at)
);

-- Vinculo ativo e unico por par de conta e por (profissional, patientId) -- desvincular
-- (unlinked_at soft, abordagem (c)) libera o par para um vinculo novo sem apagar o historico.
CREATE UNIQUE INDEX IF NOT EXISTS patient_links_active_account_pair_uq
    ON patient_links (professional_account_id, patient_account_id) WHERE unlinked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS patient_links_active_patient_id_uq
    ON patient_links (professional_account_id, patient_id) WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS patient_links_patient_account_id_idx ON patient_links (patient_account_id);

ALTER TABLE patient_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_links FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_link_party ON patient_links;

CREATE POLICY patient_link_party ON patient_links
    FOR SELECT
    USING (
        professional_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        OR patient_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    );

DROP POLICY IF EXISTS patient_link_update_by_party ON patient_links;

CREATE POLICY patient_link_update_by_party ON patient_links
    FOR UPDATE
    USING (
        professional_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        OR patient_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
    WITH CHECK (
        professional_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        OR patient_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    );

DROP POLICY IF EXISTS patient_link_insert_by_patient ON patient_links;

-- So a paciente cria a linha (ela e quem resgata o convite); a profissional nunca insere
-- diretamente -- so via convite.
CREATE POLICY patient_link_insert_by_patient ON patient_links
    FOR INSERT
    WITH CHECK (patient_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON patient_links TO app_role;
-- Todo o resto da linha e imutavel por privilegio; so o soft-unlink pode escrever.
GRANT UPDATE (unlinked_at) ON patient_links TO app_role;
REVOKE DELETE ON patient_links FROM app_role;

-- account_key_pairs ja tinha a politica key_pair_owner (0010_create_accounts.sql), que so deixa
-- a propria conta ler a propria linha. GET links devolve a chave publica do OUTRO lado do
-- vinculo (abordagem (d) do S11-04) -- por isso precisa de uma segunda politica, permissiva,
-- restrita a quem algum dia esteve vinculado ao dono da chave (vinculo ativo OU ja desfeito: a
-- pagina publicada nao desaparece so porque a paciente desvinculou).
DROP POLICY IF EXISTS key_pair_ever_linked_read ON account_key_pairs;

CREATE POLICY key_pair_ever_linked_read ON account_key_pairs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM patient_links l
            WHERE (l.professional_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND l.patient_account_id = account_key_pairs.account_id)
               OR (l.patient_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND l.professional_account_id = account_key_pairs.account_id)
        )
    );

CREATE TABLE IF NOT EXISTS shared_items (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_account_id         uuid NOT NULL REFERENCES accounts (id),
    professional_account_id    uuid NOT NULL REFERENCES accounts (id),
    shared_at                   timestamptz NOT NULL,
    ciphertext                   bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 28 AND 65536)
);

-- Sem FK a patient_links de proposito: um envelope sobrevive ao desvinculo (abordagem (c),
-- decisao do humano 2026-09-15). O store dos envelopes so chega na fatia 10 (lote 3).
CREATE INDEX IF NOT EXISTS shared_items_pair_idx ON shared_items (professional_account_id, patient_account_id, id);

ALTER TABLE shared_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shared_item_read_by_professional ON shared_items;

CREATE POLICY shared_item_read_by_professional ON shared_items
    FOR SELECT
    USING (professional_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS shared_item_insert_by_patient ON shared_items;

CREATE POLICY shared_item_insert_by_patient ON shared_items
    FOR INSERT
    WITH CHECK (patient_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON shared_items TO app_role;
REVOKE UPDATE, DELETE ON shared_items FROM app_role;

CREATE TABLE IF NOT EXISTS sharing_preferences (
    account_id      uuid PRIMARY KEY REFERENCES accounts (id),
    version         bigint NOT NULL CHECK (version >= 1),
    wrapped_dek     bytea NOT NULL CHECK (octet_length(wrapped_dek) BETWEEN 28 AND 65536),
    ciphertext      bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 28 AND 65536),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sharing_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sharing_preferences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sharing_preferences_owner ON sharing_preferences;

CREATE POLICY sharing_preferences_owner ON sharing_preferences
    FOR ALL
    USING      (account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON sharing_preferences TO app_role;
GRANT UPDATE (version, wrapped_dek, ciphertext, updated_at) ON sharing_preferences TO app_role;
REVOKE DELETE ON sharing_preferences FROM app_role;
