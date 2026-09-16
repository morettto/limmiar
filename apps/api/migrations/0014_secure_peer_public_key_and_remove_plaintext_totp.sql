-- S11-17: peer reads are restricted to the public key projection.
CREATE OR REPLACE FUNCTION linked_peer_public_keys()
RETURNS TABLE (account_id uuid, public_key bytea)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT kp.account_id, kp.public_key
    FROM account_key_pairs kp
    WHERE EXISTS (
        SELECT 1 FROM patient_links l
        WHERE (l.professional_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
               AND l.patient_account_id = kp.account_id)
           OR (l.patient_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
               AND l.professional_account_id = kp.account_id)
    )
$$;

CREATE OR REPLACE VIEW account_key_pairs_public AS
SELECT account_id, public_key FROM linked_peer_public_keys();

GRANT SELECT ON TABLE account_key_pairs_public TO app_role;

-- S11-14: plaintext TOTP storage is obsolete; only the encrypted column remains.
ALTER TABLE accounts DROP COLUMN IF EXISTS totp_secret;

COMMENT ON VIEW account_key_pairs_public IS
    'Only the public key is exposed to link read models; private envelope fields remain owner-only.';
