-- Fixes 0001's tenant_isolation policy on health_check_probe: current_setting('app.tenant_id',
-- true) returns '' (empty string), not NULL, on a pooled backend that previously had the GUC
-- set locally by any transaction and later reused by one that never sets it -- so the bare
-- `::uuid` cast throws 22P02 instead of failing closed to "no rows". NULLIF('', '') -> NULL
-- keeps the no-context case a clean zero-row result under connection-pool reuse. Surfaced by
-- S03-01 adding a second RLS-policy table (patient_record_entries) to the same test
-- collection, which made pooled-connection reuse across test classes common enough to hit
-- deterministically -- not a hypothetical, reproduced locally before this fix.

DROP POLICY IF EXISTS tenant_isolation ON health_check_probe;

CREATE POLICY tenant_isolation ON health_check_probe
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
