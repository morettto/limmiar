ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL;

UPDATE accounts SET email = NULL, password_verifier_sha256 = NULL, google_subject_id = NULL
WHERE role = 'Patient';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'accounts'::regclass AND conname = 'accounts_role_identity') THEN
        ALTER TABLE accounts ADD CONSTRAINT accounts_role_identity CHECK (
            (role = 'Professional' AND email IS NOT NULL AND length(btrim(email)) > 0)
            OR (role = 'Patient' AND email IS NULL AND password_verifier_sha256 IS NULL AND google_subject_id IS NULL)
        );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_webauthn_credential_uq ON accounts (webauthn_credential_id)
WHERE webauthn_credential_id IS NOT NULL;

DROP POLICY IF EXISTS account_invitation_issuer_read ON accounts;
CREATE POLICY account_invitation_issuer_read ON accounts FOR SELECT USING (
    role = 'Professional' AND EXISTS (
        SELECT 1 FROM patient_link_invites i
        WHERE i.code = NULLIF(current_setting('app.invite_code', true), '')
          AND i.professional_account_id = accounts.id
    )
);

DROP POLICY IF EXISTS patient_link_invitation_read ON patient_links;
CREATE POLICY patient_link_invitation_read ON patient_links FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM patient_link_invites i
        WHERE i.code = NULLIF(current_setting('app.invite_code', true), '')
          AND i.professional_account_id = patient_links.professional_account_id
          AND i.patient_id = patient_links.patient_id
    )
);
