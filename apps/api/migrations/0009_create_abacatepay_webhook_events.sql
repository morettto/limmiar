CREATE TABLE IF NOT EXISTS abacatepay_webhook_events (
    event_id    text PRIMARY KEY,              -- id do envelope (log_...), nunca externalId nem o id do checkout
    event       text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);
-- Sem RLS: ver docs/adr/ADR-S12-01-dedupe-de-webhook-sem-rls.md
GRANT SELECT, INSERT ON abacatepay_webhook_events TO app_role;
REVOKE UPDATE, DELETE ON abacatepay_webhook_events FROM app_role;
