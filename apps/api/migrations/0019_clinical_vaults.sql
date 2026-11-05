CREATE TABLE IF NOT EXISTS clinical_vaults (
    account_id uuid PRIMARY KEY REFERENCES accounts(id),
    revision uuid NOT NULL,
    key_envelope bytea NOT NULL CHECK (octet_length(key_envelope) = 60),
    recovery_slots jsonb NOT NULL CHECK (jsonb_array_length(recovery_slots) = 3)
);
ALTER TABLE clinical_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_vaults FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON clinical_vaults;
CREATE POLICY tenant_isolation ON clinical_vaults
    USING (account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON clinical_vaults TO app_role;
