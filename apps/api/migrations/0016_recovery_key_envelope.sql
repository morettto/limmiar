ALTER TABLE accounts ADD COLUMN IF NOT EXISTS recovery_key_envelope bytea
    CONSTRAINT accounts_recovery_envelope_check CHECK (
        recovery_key_envelope IS NULL OR
        (octet_length(recovery_key_envelope) = 120 AND recovery_verifier_sha256 IS NOT NULL)
    );

GRANT SELECT (recovery_key_envelope) ON accounts TO app_role;
GRANT UPDATE (recovery_key_envelope) ON accounts TO app_role;
