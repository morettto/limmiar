-- Accounts (S11-03, fatia 6): a conta deixa de viver so em memoria. Toda coluna sensivel guarda
-- ciphertext, hash ou um envelope opaco -- nunca segredo em claro, exceto totp_secret (ver
-- ponytail no fim deste ficheiro, endurecido nesta mesma fatia por Totp/TotpSecretCipher).
--
-- RLS por chave de procura (abordagem (b), .harness/abordagem/S11-03.md): a politica so formaliza
-- o que Api.Accounts.IAccountStore ja faz -- cada metodo ja sabe a chave que vai procurar (id,
-- email ou "sou staff a rever"), por isso um SELECT sem nenhuma dessas chaves na sessao devolve
-- sempre 0 linhas, em vez de a app ter de se lembrar de filtrar.

CREATE TABLE IF NOT EXISTS accounts (
    id                          uuid PRIMARY KEY,
    email                       text NOT NULL UNIQUE,
    role                        text NOT NULL CHECK (role IN ('Professional', 'Patient')),
    password_verifier_sha256    bytea CHECK (octet_length(password_verifier_sha256) = 32),
    google_subject_id           text,
    verification_status         text NOT NULL CHECK (verification_status IN ('Pending', 'InReview', 'Active', 'Rejected')),
    rejection_reason            text,
    verification_submitted_at   timestamptz,
    totp_secret                 text,
    totp_enabled_at             timestamptz,
    totp_backup_code_hashes     text[],
    webauthn_credential_id      bytea,
    webauthn_cose_public_key    bytea,
    webauthn_sign_count         bigint,
    webauthn_aaguid             uuid,
    recovery_verifier_sha256    bytea CHECK (octet_length(recovery_verifier_sha256) = 32),
    voice_wrapped_dek           bytea,
    voice_sealed_embedding      bytea,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    -- Os dois campos do envelope de voz chegam e saem juntos -- nunca um DEK selado sem o embedding
    -- selado que ele destranca, nem o inverso.
    CONSTRAINT accounts_voice_envelope_pairs CHECK ((voice_wrapped_dek IS NULL) = (voice_sealed_embedding IS NULL))
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_lookup_by_key ON accounts;

-- As 3 chaves de procura que IAccountStore ja usa hoje, cada uma o seu GUC:
--   id = me            -> FindByIdAsync, InsertAsync, UpdateAsync (OpenTenantScopedTransactionAsync)
--   email = ...        -> FindByEmailAsync (login/registo/Google/magic-link/recuperacao correm
--                          antes de existir sessao, por isso nao ha app.tenant_id ainda)
--   app.staff_review   -> ListPendingDocumentReviewAsync (fila de revisao de staff, sem conta)
-- NULLIF em vazio porque um GUC nunca definido devolve '' (nao NULL) via current_setting(., true),
-- e '' NÃO É um uuid valido -- sem o NULLIF o ::uuid rebentaria em vez de simplesmente nao bater.
CREATE POLICY account_lookup_by_key ON accounts
    FOR SELECT
    USING (
        id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        OR email = NULLIF(current_setting('app.account_email', true), '')
        OR (current_setting('app.staff_review', true) = 'on' AND role = 'Professional' AND verification_status = 'InReview')
    );

DROP POLICY IF EXISTS account_insert_self ON accounts;

CREATE POLICY account_insert_self ON accounts
    FOR INSERT
    WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS account_update_self ON accounts;

CREATE POLICY account_update_self ON accounts
    FOR UPDATE
    USING      (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON accounts TO app_role;
-- email e created_at sao imutaveis por privilegio (nunca ha UPDATE ... SET email nem SET created_at
-- no codigo, mas o GRANT em si e o que torna isso estrutural); id nunca aparece num GRANT UPDATE.
GRANT UPDATE (
    role, password_verifier_sha256, google_subject_id, verification_status, rejection_reason,
    verification_submitted_at, totp_secret, totp_enabled_at, totp_backup_code_hashes,
    webauthn_credential_id, webauthn_cose_public_key, webauthn_sign_count, webauthn_aaguid,
    recovery_verifier_sha256, voice_wrapped_dek, voice_sealed_embedding
) ON accounts TO app_role;
REVOKE DELETE ON accounts FROM app_role;

-- O par de chaves X25519 (ADR-S11-06) mora em tabela propria, nao em colunas de accounts:
-- UpdateAsync substitui o registo de accounts inteiro (last-write-wins), e a pagina precisa da
-- publica imutavel mesmo sob um PUT de voz/TOTP concorrente sobre a MESMA conta -- ver abordagem
-- (b). account_key_pairs nunca e tocada por Account.UpdateAsync.
CREATE TABLE IF NOT EXISTS account_key_pairs (
    account_id          uuid PRIMARY KEY REFERENCES accounts (id),
    public_key          bytea NOT NULL CHECK (octet_length(public_key) = 32),
    wrapped_dek         bytea NOT NULL CHECK (octet_length(wrapped_dek) >= 28),
    sealed_private_key  bytea NOT NULL CHECK (octet_length(sealed_private_key) >= 28),
    published_at        timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE account_key_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_key_pairs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS key_pair_owner ON account_key_pairs;

CREATE POLICY key_pair_owner ON account_key_pairs
    FOR ALL
    USING      (account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON account_key_pairs TO app_role;
-- public_key e imutavel por privilegio (republicar a MESMA publica so troca wrapped_dek/
-- sealed_private_key/updated_at, PublishAsync nunca faz UPDATE ... SET public_key); account_id e
-- a PK. published_at fica congelado no INSERT.
GRANT UPDATE (wrapped_dek, sealed_private_key, updated_at) ON account_key_pairs TO app_role;
REVOKE DELETE ON account_key_pairs FROM app_role;

-- ponytail: totp_secret continua sem FK/indice proprio, e por esta fatia passa a viajar cifrado
-- (AES-GCM, chave da app via Totp:EncryptionKey) em vez de claro -- ver Api.Accounts.TwoFactor e
-- apps/api/README.md "Secrets". A politica de RLS acima cobre a LINHA; a cifra cobre o CAMPO
-- (um dump de accounts.totp_secret sozinho nao abre o segredo do TOTP).
