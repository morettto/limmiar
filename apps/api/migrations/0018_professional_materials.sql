CREATE TABLE IF NOT EXISTS professional_materials (
    tenant_id uuid NOT NULL,
    material_id uuid NOT NULL,
    wrapped_dek bytea NOT NULL CHECK (octet_length(wrapped_dek) = 60),
    metadata_ciphertext bytea NOT NULL CHECK (octet_length(metadata_ciphertext) BETWEEN 28 AND 16384),
    content_ciphertext bytea NOT NULL CHECK (octet_length(content_ciphertext) BETWEEN 29 AND 20971548),
    authorized boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, material_id)
);
ALTER TABLE professional_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_materials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON professional_materials;
CREATE POLICY tenant_isolation ON professional_materials
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON professional_materials TO app_role;
