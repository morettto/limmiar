# S12-01 — forma aprovada no portão (etapa 4)

Portão da forma do ticket S12-01, corrido em 2026-09-08. **Nenhuma linha de código de implementação foi escrita nesta etapa** — o que segue é o desenho que a etapa 5 executa.

---

# S12-01 · Forma do módulo `Billing`

## 1. Tipos — `apps/api/src/Api/Features/Billing/AbacatePayContracts.cs`

```csharp
namespace Api.Billing;

public sealed record CheckoutItem(string Id, int Quantity);

public sealed record CreateCheckoutRequest(
    IReadOnlyList<CheckoutItem> Items, IReadOnlyList<string> Methods,
    string? ExternalId, string? ReturnUrl, string? CompletionUrl);

public enum CheckoutStatus                              // enum fechado do contrato
{
    [JsonStringEnumMemberName("PENDING")]   Pending,
    [JsonStringEnumMemberName("EXPIRED")]   Expired,
    [JsonStringEnumMemberName("CANCELLED")] Cancelled,
    [JsonStringEnumMemberName("PAID")]      Paid,
    [JsonStringEnumMemberName("REFUNDED")]  Refunded,
}

public sealed record Checkout(
    string Id, string? ExternalId, string Url, int Amount, CheckoutStatus Status);

/// Envelope de TODAS as rotas. Não genérico: há um só payload neste ticket.
public sealed record CheckoutEnvelope(Checkout? Data, string? Error, bool Success);

/// Sem `Data`: a página por evento devolveu 404 (lacuna registada no contrato).
/// Fixar um `data` assumido violaria o critério 1. S12-02 modela o que ler.
public sealed record AbacatePayWebhookEvent(string Id, string Event, int ApiVersion, bool DevMode);
```

`[JsonStringEnumMemberName]` + `UseStringEnumConverter = true` no `[JsonSourceGenerationOptions]` resolve `"PENDING"` inteiramente por source-gen — sem `JsonSerializerOptions` em runtime, sem risco IL3050. Status desconhecido → `JsonException` → `MalformedResponse` (que é o sinal de drift).

## 2. Cliente — `AbacatePayClient.cs`

```csharp
public enum AbacatePayFailureReason
{
    Unavailable,        // 0 — rede/timeout/5xx. default(Result) lê como isto (molde Result.cs:11-45)
    Unauthorized,       // 401
    NotFound,           // 404
    RejectedByProvider, // restantes 4xx, ou 2xx com success:false / data null
    MalformedResponse,  // corpo não parseia no contrato fixado → drift
}

public sealed class AbacatePayClient
{
    // llms.txt anuncia /checkouts/one; a página do endpoint documenta /checkouts/get.
    // Manda a página. Primeiro caso de teste do job de drift.
    public const string BaseUrl = "https://api.abacatepay.com/v2/";

    public AbacatePayClient(HttpClient http, string apiKey);   // põe BaseAddress + Bearer

    public Task<Result<Checkout, AbacatePayFailureReason>> CreateCheckoutAsync(
        CreateCheckoutRequest request, CancellationToken cancellationToken);

    public Task<Result<Checkout, AbacatePayFailureReason>> GetCheckoutAsync(
        string checkoutId, CancellationToken cancellationToken);

    // O seam puro: derivação da falha, sem HTTP.
    internal static Result<Checkout, AbacatePayFailureReason> MapResponse(
        HttpStatusCode status, CheckoutEnvelope? envelope);
}
```

`BaseUrl` é `const`, não configuração — não muda, e não há URL de sandbox distinta (o `devMode` vem da chave). **Cai a chave `AbacatePay:BaseUrl` do briefing.** `AbacatePay:ApiKey` também cai deste ticket: em S12-01 o cliente não tem chamador de produção ("isolado antes de S12-02"), logo **não é registado em DI** — só testes e o job de drift o constroem. Regista-se em S12-02, junto do endpoint que o usa.

## 3. Seam da assinatura — `AbacatePayWebhookSignature.cs`

```csharp
public static class AbacatePayWebhookSignature
{
    /// Constante pública que a documentação publica — NÃO é segredo, logo não é configuração.
    public const string PublicKey = "…384 chars…";

    /// Pura. Verifica os dois: HMAC-SHA256/base64 sobre os bytes crus (header
    /// X-Webhook-Signature) e o segredo de registo (query ?webhookSecret=).
    /// Ambas as comparações por CryptographicOperations.FixedTimeEquals.
    public static bool IsAuthentic(
        ReadOnlySpan<byte> rawBody, string? signatureHeader,
        string? webhookSecretFromQuery, string expectedSecret);
}
```

## 4. Seam do `HttpClient`

Construtor. `AbacatePayClient(HttpClient, string)` — sem interface, sem fábrica, sem wrapper. Os testes fazem `new AbacatePayClient(new HttpClient(new CannedResponseHandler(…)), "k")`; a substituição é um `HttpMessageHandler` de ~15 linhas **no projeto de testes**, e o handler captura o pedido para se afirmar `Authorization: Bearer` e a URL absoluta (senão o stub passa e a produção 401). Zero DI nos testes unitários. A questão `AddHttpClient<T>` sob AOT fica para S12-02, que é quem precisa de o registar — uma linha, e o job `api-aot-publish` é o portão dela.

## 5. Fixtures

`apps/api/tests/Api.Tests/Billing/fixtures/{checkout-create-200,checkout-get-200,error-401,webhook-checkout-completed}.json`, lidas por `AbacatePayFixtures.ReadBytes(name)` — subida a partir de `AppContext.BaseDirectory` até encontrar `Billing/fixtures/`, molde exato de `ProblemDetailsProviderPactTests.ResolvePactFilePath` (`:70-88`). Sem item de csproj. O `error-401.json` serve também o ramo 404 (o corpo é o mesmo envelope; o que muda é o status). A fixture do webhook é lida em **bytes crus** — é sobre eles que o HMAC é calculado.

## 6. Job de drift — **workflow próprio**, `.github/workflows/abacatepay-drift.yml`

Não é um job dentro de `mutation-nightly.yml`: esse workflow chama-se "Mutation testing (nightly)", é pnpm/node, não usa segredos, e o seu vermelho significa "score de mutação caiu". O vermelho do drift significa "o fornecedor mudou a documentação, vai ler". Misturá-los faz o nome do workflow mentir e junta dois domínios de falha. Herda do molde: `schedule` + `workflow_dispatch` juntos, cron fora da hora cheia (`'41 4 * * *'`, afastado das 03:17), `permissions: contents: read`, `ref: main` fixado no checkout com o mesmo comentário.

```yaml
      - name: Check sandbox credentials          # segredo ausente → salta, não falha
        id: creds
        env:
          ABACATEPAY_SANDBOX_API_KEY: ${{ secrets.ABACATEPAY_SANDBOX_API_KEY }}
        run: |                                   # escreve a razão em $GITHUB_STEP_SUMMARY
          ...                                    # e have_key=false em $GITHUB_OUTPUT
      - name: Probe live sandbox
        if: steps.creds.outputs.have_key == 'true'
        run: dotnet test apps/api/Api.sln -c Release --filter "Category=Drift" -p:CollectCoverage=false
```

Não bloqueia PR **por construção**: não tem gatilho `pull_request`. Compara: que `/checkouts/get` continua a rotear (a divergência do `llms.txt`), e que toda a resposta viva parseia em `Checkout` com `CheckoutStatus` definido — i.e. que `MalformedResponse` nunca acontece. `-p:CollectCoverage=false` é obrigatório: uma corrida filtrada rebentaria o piso de 100% do `Api.Tests.csproj`.

---

## Decisão resolvida — a memória de idempotência

**Confirmado: tabela própria, `abacatepay_webhook_events`, na `0009`, sem RLS, com ADR.**

A alternativa tenant-scoped não é inconveniente, é **impossível**: a decisão de dedupe tem de preceder qualquer resolução do evento a um tenant (é esse o ponto — não repetir o trabalho), e em S12-01 não existe sequer mapa `externalId → tenant`. Uma tabela com tenant exigiria que o lookup tivesse êxito antes do dedupe, e o lookup falhado deixaria o evento por deduplicar — exatamente o caso que uma reentrega em corrida produz.

**Adiar para S12-02 rejeitado**, por duas razões: deixa o critério de aceite 3 por cumprir neste ticket, e um `UNIQUE` na tabela de efeitos deduplica por *efeito*, não por *evento* — a unidade de reentrega do fornecedor é o evento, e uma reentrega cujo efeito já é no-op não deixaria registo de que o vimos. Não são alternativas: S12-02 deve na mesma pôr o seu `UNIQUE`.

```sql
-- 0009_create_abacatepay_webhook_events.sql
CREATE TABLE IF NOT EXISTS abacatepay_webhook_events (
    event_id    text PRIMARY KEY,              -- id do envelope (log_...), nunca externalId nem o id do checkout
    event       text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);
-- Sem RLS: ver docs/adr/ADR-S12-01-dedupe-de-webhook-sem-rls.md
GRANT SELECT, INSERT ON abacatepay_webhook_events TO app_role;
REVOKE UPDATE, DELETE ON abacatepay_webhook_events FROM app_role;
```

Sem `CHECK (event_id LIKE 'log\_%')`: uma mudança de prefixo do lado do fornecedor transformaria um webhook numa violação de constraint no caminho do dinheiro, e o job de drift não cobre webhooks. Sem poda por idade: a janela máxima de reentrega não está documentada (lacuna registada), e podar mais curto que ela quebra a idempotência.

**ADR-S12-01-dedupe-de-webhook-sem-rls.md** tem de afirmar: (1) que 7/7 tabelas têm ENABLE+FORCE e esta é a primeira sem; (2) que o tenant não existe *no instante do dedupe*, com o argumento estrutural acima; (3) que a tabela só pode conter, para sempre, o identificador opaco do fornecedor, a string do tipo de evento e o instante — logo a exceção é a "isolação de nada"; (4) que essa garantia não é imposta por CHECK, e porquê (disponibilidade no caminho do dinheiro), sendo imposta por haver um só escritor e pelo par GRANT/REVOKE; (5) porque não se adia para S12-02; (6) que a invariante passa a ler-se "toda a tabela com dados de tenant tem RLS", e que é `RowLevelSecurityCoverageTests` que a passa a impor.

---

## Call tree

```
POST /webhooks/abacatepay?webhookSecret=…            (X-Webhook-Signature)
└─ BillingEndpoints.HandleWebhookAsync(HttpRequest, AbacatePayWebhookSecret, AbacatePayWebhookStore, ct)
   ├─ ContentLength > 64 KiB                                        → 400
   ├─ lê o corpo cru para byte[]
   ├─ AbacatePayWebhookSignature.IsAuthentic(raw, header, query, secret)   [puro]
   │    ├─ HMACSHA256.HashData(PublicKey, raw) → Base64
   │    └─ CryptographicOperations.FixedTimeEquals ×2                → false: 401 sem corpo
   ├─ JsonSerializer.Deserialize(raw, AbacatePayJsonContext.Default.AbacatePayWebhookEvent)
   │                                                                 → null/JsonException: 400
   └─ AbacatePayWebhookStore.TryRecordAsync(evt.Id, evt.Event, ct)
      └─ NpgsqlDataSource.OpenConnectionAsync            ← NÃO OpenTenantScopedTransactionAsync (ADR)
         └─ INSERT … ON CONFLICT (event_id) DO NOTHING
            ├─ 1 linha → 200 { received: true, duplicate: false }
            └─ 0 linhas → 200 { received: true, duplicate: true }    ← nunca 409: 409 faz reentregar para sempre

AbacatePayClient.{Create,Get}CheckoutAsync            [sem chamador de produção em S12-01]
└─ HttpClient.SendAsync   ── HttpRequestException/TaskCanceledException → Unavailable
   └─ ReadFromJsonAsync(…Default.CheckoutEnvelope) ── JsonException → MalformedResponse
      └─ MapResponse(status, envelope)               [puro]  → Result<Checkout, AbacatePayFailureReason>
```

## Ficheiros

| Ficheiro | Responsabilidade |
|---|---|
| **novo** `src/Api/Features/Billing/AbacatePayContracts.cs` | os registos de fio e o enum fechado de status |
| **novo** `src/Api/Features/Billing/AbacatePayClient.cs` | as duas chamadas, o enum de falha, `MapResponse` |
| **novo** `src/Api/Features/Billing/AbacatePayWebhookSignature.cs` | verificação pura (HMAC + segredo), a constante pública |
| **novo** `src/Api/Features/Billing/AbacatePayWebhookStore.cs` | `TryRecordAsync` — o `ON CONFLICT DO NOTHING` |
| **novo** `src/Api/Features/Billing/BillingEndpoints.cs` | `POST /webhooks/abacatepay` |
| **novo** `src/Api/Features/Billing/BillingComposition.cs` | `AddBilling`/`MapBilling`, `AbacatePayJsonContext`, `AbacatePayWebhookSecret` (molde `ConsentComposition.cs:9-38`) |
| **novo** `migrations/0009_create_abacatepay_webhook_events.sql` | a tabela de dedupe; idempotente por `IF NOT EXISTS` |
| **novo** `docs/adr/ADR-S12-01-dedupe-de-webhook-sem-rls.md` | a exceção à invariante de RLS |
| **novo** `.github/workflows/abacatepay-drift.yml` | cron nocturno, não-bloqueante, salta sem segredo |
| **novo** `tests/Api.Tests/Billing/` (4 fixtures + 6 .cs) | fixtures, `CannedResponseHandler`, `AbacatePayFixtures`, 4 classes de teste |
| **novo** `tests/Api.Tests/Rls/RowLevelSecurityCoverageTests.cs` | `pg_class.relrowsecurity`: a única tabela sem RLS é esta |
| toca `src/Api/Program.Composition.cs` | `AddBilling(builder.Configuration)` + `MapBilling()` |
| toca `.github/workflows/quality-gates.yml` (~402-420) | `--filter "Category!=Drift"` no passo `api-tests` |
| toca `tests/Api.Tests/Startup/MissingConfigurationTests.cs` | um caso para `AbacatePay:WebhookSecret` |
| toca **15** ficheiros de teste que constroem a app | uma linha `UseSetting("AbacatePay:WebhookSecret", …)` cada |

Essas 15 linhas são o custo real do critério 3 (uma chave nova obrigatória, falha rápida, sem default — um segredo com default no caminho do dinheiro não passa). Não extrair uma fábrica de testes partilhada agora; extrair quando entrar a 16.ª chave.

## Seams, por ordem de fatia vermelho→verde

1. `AbacatePayClient.MapResponse` — puro; 7 casos (200 ok · 401 · 404 · 5xx · 4xx com `success:false` · 200 com `data` null · envelope null).
2. `AbacatePayJsonContext` sobre as 3 fixtures HTTP — `PENDING`/`PAID` mapeiam, `error-401` dá `Success=false`. É o critério 1.
3. `AbacatePayClient` sobre `CannedResponseHandler` — URL absoluta, `Authorization: Bearer`, corpo serializado; `HttpRequestException`/`TaskCanceledException` → `Unavailable`; corpo truncado → `MalformedResponse`.
4. `AbacatePayWebhookSignature.IsAuthentic` — puro, sobre os bytes crus da fixture; par válido, header ausente, header errado, segredo errado, um byte do corpo alterado.
5. `0009` + `AbacatePayWebhookStore.TryRecordAsync` — Testcontainers; 1.ª → true, mesmo id → false, id diferente → true, `app_role` sem UPDATE/DELETE.
6. `RowLevelSecurityCoverageTests` — a exceção da ADR passa a invariante imposta (e cobre as 7 existentes de borla).
7. `POST /webhooks/abacatepay` ponta a ponta — **os mesmos bytes postados duas vezes**: 200 `duplicate:false` → 200 `duplicate:true`, uma linha só. É o critério 3.
8. `MissingConfigurationTests` — chave em falta → `InvalidOperationException`.
9. `AbacatePayDriftTests` `[Trait("Category","Drift")]` — `/checkouts/get` roteia, status vivo é sempre um membro definido. É o critério 2.

---

Saltei: enum dos 16 tipos de evento (nada ramifica neles — a string vai para a coluna, e é o job de drift que vigia a lista); `data` do webhook; `customerId`/`metadata` no pedido; registo do cliente em DI. Adicionar em S12-02, quando houver quem os leia.

---

## Por fazer — portão `doc-sync-gate` (etapa 8)

Falta ainda, e não está feito nesta etapa:

- o `README.md` colocado de `src/Api/Features/Billing/` (documentação viva do módulo);
- a entrada correspondente em `apps/api/README.md`;
- a entrada correspondente em `ARCHITECTURE.md` (o índice).

Nenhum destes três é opcional no fecho do ticket.
