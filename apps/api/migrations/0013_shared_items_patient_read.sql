-- S11-03, fatia 10 (lote 3): a paciente passa a poder ler os proprios envelopes em
-- shared_items -- ate aqui so a policy shared_item_read_by_professional (0012) dava SELECT, so
-- a profissional. Postgres agrega policies permissivas com OR: esta soma-se a ela, nao a
-- substitui. Sem GUC (app.tenant_id vazio) continua 0 linhas para qualquer um.
DROP POLICY IF EXISTS shared_item_read_by_patient ON shared_items;

CREATE POLICY shared_item_read_by_patient ON shared_items
    FOR SELECT
    USING (patient_account_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
