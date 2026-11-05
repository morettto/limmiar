CREATE TABLE IF NOT EXISTS professional_material_captures (
    tenant_id uuid NOT NULL,
    session_id uuid NOT NULL,
    capture_id uuid NOT NULL,
    released boolean NOT NULL DEFAULT false,
    PRIMARY KEY (tenant_id, session_id, capture_id)
);
ALTER TABLE professional_material_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_material_captures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON professional_material_captures;
CREATE POLICY tenant_isolation ON professional_material_captures
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON professional_material_captures TO app_role;
CREATE TABLE IF NOT EXISTS professional_material_closed_sessions (
    tenant_id uuid NOT NULL,
    session_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, session_id)
);
ALTER TABLE professional_material_closed_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_material_closed_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON professional_material_closed_sessions;
CREATE POLICY tenant_isolation ON professional_material_closed_sessions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON professional_material_closed_sessions TO app_role;
