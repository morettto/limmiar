-- S11-03, endurecimento (depois da fatia 6): totp_secret nunca mais em claro em repouso.
-- Expand puro: soma a coluna cifrada, nao apaga a antiga. accounts.totp_secret (texto, claro)
-- fica congelada -- nenhum leitor/escritor novo a toca, so serve de historico de quem migrou
-- antes desta migracao correr (nenhuma conta real ainda, este ticket esta em desenvolvimento).
--
-- Layout do blob: nonce (12 bytes) || ciphertext (mesmo tamanho do segredo Base32) ||
-- tag (16 bytes) -- ver Api.Accounts.TotpSecretCipher. Piso de 28 bytes = 12 + 0 + 16, o
-- segredo mais curto possivel (string vazia nunca acontece na pratica, mas o CHECK cobre o
-- caso puramente estrutural).

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS totp_secret_encrypted bytea
    CHECK (octet_length(totp_secret_encrypted) >= 28);

GRANT UPDATE (totp_secret_encrypted) ON accounts TO app_role;

-- app_role continua com INSERT sobre accounts (grant existente da 0010) -- so a permissao de
-- ESCREVER na coluna antiga sai por UPDATE.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'totp_secret'
    ) THEN
        REVOKE UPDATE (totp_secret) ON accounts FROM app_role;
    END IF;
END $$;

-- Ronda 1 de review (achado importante): um REVOKE de coluna nunca anula um GRANT de tabela
-- inteira no Postgres -- o `GRANT SELECT ON accounts TO app_role` da 0010 continuava a deixar
-- ler totp_secret em claro apesar do REVOKE UPDATE acima. PostgresAccountStore nunca faz
-- `SELECT *` (ver SelectColumns), so colunas nomeadas sem totp_secret, por isso fechar a leitura
-- aqui nao quebra nenhum leitor real. Expand puro e idempotente: repetir este REVOKE/GRANT e um
-- no-op. Prova: AccountsRlsTests.SelectingTotpSecretColumn_IsDeniedByColumnPrivilege.
REVOKE SELECT ON accounts FROM app_role;
GRANT SELECT (
    id, email, role, password_verifier_sha256, google_subject_id, verification_status,
    rejection_reason, verification_submitted_at, totp_enabled_at, totp_backup_code_hashes,
    webauthn_credential_id, webauthn_cose_public_key, webauthn_sign_count, webauthn_aaguid,
    recovery_verifier_sha256, voice_wrapped_dek, voice_sealed_embedding, created_at,
    totp_secret_encrypted
) ON accounts TO app_role;
