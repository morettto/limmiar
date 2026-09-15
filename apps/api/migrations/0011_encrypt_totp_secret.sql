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

-- app_role continua com SELECT/INSERT sobre accounts (grants existentes da 0010) -- so a
-- permissao de ESCREVER na coluna antiga sai, a leitura fica para nunca quebrar uma consulta
-- `SELECT *` legada.
REVOKE UPDATE (totp_secret) ON accounts FROM app_role;
