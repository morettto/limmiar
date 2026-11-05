CREATE TABLE IF NOT EXISTS professional_material_usage (
    tenant_id uuid NOT NULL,
    session_id uuid NOT NULL,
    material_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, session_id, material_id),
    FOREIGN KEY (tenant_id, material_id) REFERENCES professional_materials(tenant_id, material_id)
);
CREATE INDEX IF NOT EXISTS professional_material_usage_material ON professional_material_usage(tenant_id, material_id);
ALTER TABLE professional_material_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_material_usage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON professional_material_usage;
CREATE POLICY tenant_isolation ON professional_material_usage
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON professional_material_usage TO app_role;
