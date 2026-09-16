-- S11-18: versioned AES-GCM blobs include one version byte before nonce.
ALTER TABLE accounts
    DROP CONSTRAINT IF EXISTS accounts_totp_secret_encrypted_check;

ALTER TABLE accounts
    ADD CONSTRAINT accounts_totp_secret_encrypted_check
    CHECK (octet_length(totp_secret_encrypted) >= 29);

COMMENT ON COLUMN accounts.totp_secret_encrypted IS
    'Versioned AES-256-GCM blob: version(1) || nonce(12) || ciphertext || tag(16), bound to account id as AAD.';
