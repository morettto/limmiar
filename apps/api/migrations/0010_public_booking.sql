-- Links públicos de reserva + efeitos de pagamento (S12-02). Idempotente: o
-- MigrationRunner reexecuta todo *.sql no arranque, sem tabela de tracking.
CREATE TABLE IF NOT EXISTS public_booking_links (
    token_hash text PRIMARY KEY, -- hex(SHA256(token opaco de 256 bits)); só o hash é guardado
    tenant_id  uuid NOT NULL,
    expires_at timestamptz NULL, -- NULL = sem expiração; passado => LinkInvalidOrExpired
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_payments (
    external_id  text PRIMARY KEY, -- chave de idempotência; o UNIQUE do efeito (ADR-S12-01 §5)
    tenant_id    uuid NOT NULL, -- o externalId→tenant vive aqui, sem tabela-mapa extra
    session_id   uuid NULL, -- NULL quando a tentativa perdeu a corrida de slot
    checkout_id  text NOT NULL, -- id bill_... do fornecedor; o webhook correlaciona por aqui
    checkout_url text NOT NULL,
    status       int NOT NULL, -- PaymentStatus como int: valor fora cai em comparação falsa
    amount       int NOT NULL, -- cêntimos, como Checkout.Amount
    name         text NOT NULL,
    contact      text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public_booking_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_booking_links FORCE ROW LEVEL SECURITY;
ALTER TABLE booking_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public_booking_links;
CREATE POLICY tenant_isolation ON public_booking_links
    USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON booking_payments;
CREATE POLICY tenant_isolation ON booking_payments
    USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Resolução sem tenant: o endpoint público ainda não conhece o tenant. A política só abre
-- as linhas do hash apresentado na transação (GUC local posta pelo store); sem ela, nada
-- é visível. Sem função SECURITY DEFINER: FORCE RLS aplica-se ao dono das tabelas.
DROP POLICY IF EXISTS link_resolve ON public_booking_links;
CREATE POLICY link_resolve ON public_booking_links
    FOR SELECT USING (token_hash = NULLIF(current_setting('app.resolve_hash', true), ''));

-- Confirmação de webhook sem tenant: o passo 1 resolve o tenant pelo checkout_id; o passo
-- 2 escreve já sob OpenTenantScopedTransactionAsync (o primitivo da casa).
DROP POLICY IF EXISTS payment_lookup ON booking_payments;
CREATE POLICY payment_lookup ON booking_payments
    FOR SELECT USING (checkout_id = NULLIF(current_setting('app.payment_checkout', true), ''));

-- Links sem escritor de produção neste ticket (a emissão fica fora): só leitura via política.
GRANT SELECT ON public_booking_links TO app_role;
REVOKE INSERT, UPDATE, DELETE ON public_booking_links FROM app_role;
GRANT SELECT, INSERT ON booking_payments TO app_role;
GRANT UPDATE (session_id, checkout_id, checkout_url, status, amount) ON booking_payments TO app_role;
REVOKE DELETE ON booking_payments FROM app_role;

-- O webhook e a política payment_lookup leem por checkout_id (a PK é external_id): sem
-- índice próprio isso é seq scan a cada webhook.
CREATE INDEX IF NOT EXISTS booking_payments_checkout_id_idx ON booking_payments (checkout_id);

-- Marca de falta (S12-02 fatia 5): idempotente, sem reescrever 0004. O GRANT novo vive aqui.
ALTER TABLE scheduled_sessions ADD COLUMN IF NOT EXISTS no_show boolean NOT NULL DEFAULT false;
GRANT UPDATE (no_show) ON scheduled_sessions TO app_role;
