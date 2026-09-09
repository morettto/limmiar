# ADR-S12-01: Dedupe de webhook AbacatePay sem RLS

## Contexto

Até S12-01, 7/7 tabelas em `public` têm `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL
SECURITY`: `health_check_probe` (0001), `patient_record_entries` (0002),
`scheduled_sessions` (0004), `note_signatures` (0005), `audit_entries` e `audit_anchors`
(0006), `consent_events` (0007). O critério de aceite 3 de S12-01 exige memória de
idempotência de webhooks: os mesmos bytes reentregues devolvem `duplicate:true`, nunca 409
(409 faria o fornecedor reentregar para sempre).

## Decisão

`abacatepay_webhook_events` (migração `0009_create_abacatepay_webhook_events.sql`) é a
primeira tabela sem RLS, por decisão estrutural, não por falta de disciplina:

1. 7/7 tabelas anteriores têm ENABLE+FORCE; esta é a primeira sem.
2. O tenant não existe no instante do dedupe. O dedupe precede qualquer resolução do
   evento a um tenant -- esse é o seu ponto, não repetir o trabalho -- e em S12-01 nem
   existe mapa `externalId → tenant`. Uma tabela com tenant exigiria o lookup antes do
   dedupe, e o lookup falhado deixaria o evento por deduplicar: exatamente o caso que uma
   reentrega em corrida produz. Não há `tenant_id` para uma política `USING`/`WITH CHECK`
   verificar, por isso `AbacatePayWebhookStore` liga por `OpenConnectionAsync`, nunca por
   `OpenTenantScopedTransactionAsync`.
3. A tabela só contém, para sempre, o identificador opaco do fornecedor (`event_id`, o `id`
   do envelope `log_...`, nunca `externalId` nem id de checkout), a string do tipo de evento
   e o instante de receção. A exceção é a "isolação de nada": não há dado de tenant para
   isolar entre tenants.
4. Essa garantia não é imposta por `CHECK (event_id LIKE 'log\_%')`: uma mudança de prefixo
   do lado do fornecedor transformaria um webhook numa violação de constraint no caminho do
   dinheiro, e o job de drift não cobre webhooks. É imposta por haver um único escritor
   (`AbacatePayWebhookStore.TryRecordAsync`, `INSERT ... ON CONFLICT DO NOTHING`) mais o par
   `GRANT SELECT, INSERT` / `REVOKE UPDATE, DELETE` em `app_role`.
5. Não se adia para S12-02: o critério 3 pertence a este ticket, e um `UNIQUE` na tabela de
   efeitos deduplica por efeito, não por evento -- a unidade de reentrega do fornecedor é o
   evento, e uma reentrega cujo efeito já é no-op não deixaria registo de que a vimos. Não
   são alternativas: S12-02 põe na mesma o seu `UNIQUE`.
6. A invariante passa a ler-se "toda a tabela com dados de tenant tem RLS", e quem a impõe é
   `apps/api/tests/Api.Tests/Rls/RowLevelSecurityCoverageTests.cs`: lê
   `pg_class.relrowsecurity` para todo `public` e exige que a única tabela sem RLS seja
   `abacatepay_webhook_events`. Uma tabela nova com dados de tenant que esqueça o RLS falha
   ali; esta exceção só sobrevive enquanto continuar a ser "nada para isolar".

## Consequências

- Sem poda por idade: a janela máxima de reentrega não está documentada (lacuna registada),
  e podar mais curto que ela quebra a idempotência.
- Se um dia a tabela ganhar uma coluna com dado de tenant, a afirmação 3 cai e este ADR
  deixa de valer: ou a coluna sai, ou a tabela ganha `tenant_id` + RLS. O teste da afirmação
  6 não apanha essa deriva sozinho -- apanha tabelas novas sem RLS, não colunas novas numa
  tabela já excecionada -- por isso a revisão é manual, neste ficheiro.
