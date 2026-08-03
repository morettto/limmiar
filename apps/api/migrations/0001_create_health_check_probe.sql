-- Health check probe table used to prove Row Level Security (RLS) tenant
-- isolation works end-to-end against a real Postgres instance.

CREATE TABLE IF NOT EXISTS health_check_probe (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    probe_value text NOT NULL
);

ALTER TABLE health_check_probe ENABLE ROW LEVEL SECURITY;

-- FORCE is required, not just ENABLE: without it, the table owner (and any
-- superuser) bypasses the policy below entirely, which would let the RLS
-- tests "pass" without RLS actually being exercised.
ALTER TABLE health_check_probe FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON health_check_probe;

CREATE POLICY tenant_isolation ON health_check_probe
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- {{APP_ROLE_PASSWORD}} is substituted by MigrationRunner with the password already
-- configured for the app's own database connection (see Program.cs) -- never a literal
-- checked into source control. If the role already exists, its password is refreshed to
-- match, so rotating the AppDb secret and redeploying also rotates this role's password.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_role') THEN
        CREATE ROLE app_role LOGIN PASSWORD '{{APP_ROLE_PASSWORD}}';
    ELSE
        ALTER ROLE app_role PASSWORD '{{APP_ROLE_PASSWORD}}';
    END IF;
END
$$;

GRANT SELECT, INSERT ON health_check_probe TO app_role;
