# Api.Billing

## Responsabilidade

Cliente HTTP próprio para a AbacatePay (não existe SDK .NET oficial), a verificação da
assinatura dos seus webhooks, a memória de idempotência de webhooks recebidos
(`abacatepay_webhook_events`) e a superfície HTTP que os liga (`POST /webhooks/abacatepay`).
Este README cobre **fatias 1-9 do ticket S12-01**: o mapeamento puro de resposta HTTP, o
contrato JSON fixado contra fixtures gravadas (critério de aceite 1), o cliente sobre um
handler HTTP falso, a verificação pura da assinatura HMAC do webhook, a tabela de dedupe e o
seu store, a invariante de RLS que a exceção da tabela de dedupe respeita, o endpoint que os
liga (critério de aceite 3: reentrega devolve `duplicate:true`, nunca 409), o registo em DI
(`AddBilling`/`MapBilling`), a configuração obrigatória `AbacatePay:WebhookSecret` com falha
rápida, e a sonda viva de drift agendada (critério de aceite 2). Só o ADR de dedupe sem RLS
fica para o fecho -- ver `.harness/S12-01-forma.md` para o desenho completo já aprovado.

## Fluxo principal

- `AbacatePayContracts.cs` -- os registos de fio do contrato AbacatePay v2 (fonte:
  `docs.abacatepay.com/pages/payment/create`, fixado por fixture, não por adivinhação):
  - `CheckoutItem`, `CreateCheckoutRequest` -- o corpo de `POST /checkouts/create`.
  - `enum CheckoutStatus` -- fechado (`Pending|Expired|Cancelled|Paid|Refunded`), cada membro
    com `[JsonStringEnumMemberName]` para o valor de fio exato (`"PENDING"` etc.). Sem
    fallback: um valor desconhecido no fio falha a desserialização com `JsonException` -- é
    esse o sinal de drift que o job de drift vigia.
  - `Checkout`, `CheckoutEnvelope` -- o envelope de toda resposta HTTP
    (`{ data, error, success }`). Não genérico: há um só payload (`Checkout`) neste ticket.
  - `AbacatePayWebhookEvent(string Id, string Event, int ApiVersion, bool DevMode)` -- o
    envelope do webhook, **sem** `data` (a página por evento da documentação nunca foi
    alcançada -- fixar um `data` assumido violaria o critério de aceite 1). Único leitor:
    `BillingEndpoints.HandleWebhookAsync`.
- `AbacatePayClient.cs`:
  - `enum AbacatePayFailureReason` -- `Unavailable` (membro 0, rede/timeout/5xx),
    `Unauthorized` (401), `NotFound` (404), `RejectedByProvider` (restantes 4xx, ou 2xx com
    `success:false`/`data` nulo), `MalformedResponse` (corpo não parseia -- o sinal de drift).
  - `MapResponse(HttpStatusCode, CheckoutEnvelope?)` -- `internal static`, puro, zero I/O. O
    seam testado sem HTTP nenhum (`AbacatePayClientMapResponseTests`, 7 casos). Exposto ao
    projeto de testes via `<InternalsVisibleTo>` em `Api.csproj` (item nativo do SDK, sem
    `AssemblyInfo.cs` nem atributo à mão).
  - `AbacatePayClient(HttpClient, string apiKey)` -- o seam é o construtor: fixa
    `BaseAddress = BaseUrl` e `Authorization: Bearer <apiKey>`. Sem interface, sem fábrica.
  - `CreateCheckoutAsync`/`GetCheckoutAsync` -- `HttpRequestException` vira `Unavailable`;
    `OperationCanceledException` (onde `TaskCanceledException` de timeout se inclui) só vira
    `Unavailable` quando o token do chamador NÃO está cancelado -- cancelamento cooperativo
    propaga. A resposta é disposta no fim de `SendAsync` (`using`); o corpo é lido com
    `ReadFromJsonAsync` sobre o `JsonTypeInfo` source-gerado (AOT-safe); `JsonException`
    (corpo truncado/inválido) vira `MalformedResponse`; o resultado passa por `MapResponse`.
  - `BaseUrl = "https://api.abacatepay.com/v2/"` -- `const`, não configuração: não muda, e
    não há sandbox distinta (o `devMode` vem da chave). `/checkouts/get`, não `/checkouts/one`
    -- o índice (`llms.txt`) diverge da página do endpoint; a página manda, e é essa
    divergência que o job de drift existe para apanhar.
- `AbacatePayWebhookSignature.cs` -- `IsAuthentic(ReadOnlySpan<byte> rawBody, string?
  signatureHeader, string? webhookSecretFromQuery, string expectedSecret)`, pura, zero I/O.
  Verifica os dois, sempre os dois calculados (nunca um curto-circuito que pule o cálculo de
  um deles, para não vazar por tempo qual falhou primeiro):
  - HMAC-SHA256 sobre `rawBody` com a chave pública `PublicKey`, saída base64, comparada a
    `signatureHeader` (header `X-Webhook-Signature`);
  - `webhookSecretFromQuery` (query `?webhookSecret=`) comparado a `expectedSecret`.
  - Ambas as comparações via `CryptographicOperations.FixedTimeEquals`.
  - `PublicKey` é uma constante pública publicada pela AbacatePay (não é segredo, logo não é
    configuração) -- ver "Decisões relevantes" para a proveniência exata do valor.
- `AbacatePayWebhookStore.cs` -- `TryRecordAsync(string eventId, string eventType,
  CancellationToken)`: `INSERT INTO abacatepay_webhook_events ... ON CONFLICT (event_id) DO
  NOTHING`, devolve `true` na primeira vez que `eventId` é visto, `false` numa reentrega.
  Ligação simples via `NpgsqlDataSource.OpenConnectionAsync` (molde
  `HealthEndpoints.HandleGetHealthDbAsync`) -- **nunca**
  `OpenTenantScopedTransactionAsync`: não existe tenant no instante do dedupe (o `externalId`
  ainda não resolveu a nenhuma conta). Sem RLS na tabela; ver "Decisões relevantes".
- `migrations/0009_create_abacatepay_webhook_events.sql` -- `event_id text PRIMARY KEY`
  (o `id` do envelope, nunca `externalId` nem o id do checkout), `event text NOT NULL`,
  `received_at timestamptz DEFAULT now()`. `GRANT SELECT, INSERT` / `REVOKE UPDATE, DELETE` em
  `app_role` -- a memória nunca é reescrita nem podada pela aplicação em execução. Sem `CHECK`
  de prefixo (uma mudança de prefixo do lado do fornecedor não pode virar violação de
  constraint no caminho do dinheiro) e sem poda por idade (a janela de reentrega não está
  documentada).
- `BillingComposition.cs`:
  - `AddBilling(IServiceCollection, IConfiguration)` -- lê `AbacatePay:WebhookSecret` com
    falha rápida por `InvalidOperationException` (molde `Program.cs:36-37`, não
    `ConsentComposition.AddConsent`, que não tem chave obrigatória própria). Regista
    `AbacatePayWebhookSecret` (record, não `string` nua) e `AbacatePayWebhookStore`.
  - `MapBilling(WebApplication)` -- chama `BillingEndpoints.MapBillingEndpoints`.
  - `AbacatePayJsonContext` -- agora também `[JsonSerializable(AbacatePayWebhookEvent)]` e
    `[JsonSerializable(WebhookAckResponse)]`, além dos dois registados nas fatias 1-4.
- `BillingEndpoints.cs` -- `POST /webhooks/abacatepay`
  (`HandleWebhookAsync(HttpRequest, AbacatePayWebhookSecret, AbacatePayWebhookStore,
  CancellationToken)`), pela ordem da call tree:
  1. `ReadBoundedBodyAsync(request, ct)` -- lê o corpo até 64 KiB+1; `null` (teto
     excedido, com ou sem `Content-Length` -- chunked chega com `null`) → `400`.
  2. `AbacatePayWebhookSignature.IsAuthentic(rawBody, header, query, secret)` -- `false` →
     `401` sem corpo.
  3. `JsonSerializer.Deserialize(rawBody, AbacatePayJsonContext.Default.AbacatePayWebhookEvent)`
     -- `JsonException` ou resultado `null` (`"null"` é JSON válido) → `400`.
  4. `AbacatePayWebhookStore.TryRecordAsync(evt.Id, evt.Event, ct)` → `200
     { received: true, duplicate: !primeiraVez }`. **Nunca `409`**: o fornecedor reentrega em
     qualquer resposta que não seja 2xx, e `409` faria reentregar para sempre.

## Pontos de entrada

- `Api.Billing.AbacatePayClient.MapResponse(HttpStatusCode, CheckoutEnvelope?)` -- `internal`,
  puro, testável sem HTTP nem Docker.
- `Api.Billing.AbacatePayClient(HttpClient, string apiKey)` +
  `.CreateCheckoutAsync(CreateCheckoutRequest, CancellationToken)` /
  `.GetCheckoutAsync(string checkoutId, CancellationToken)` -- a fronteira HTTP real, sem
  chamador de produção ainda (S12-02 regista `AbacatePay:ApiKey` e liga este cliente).
- `Api.Billing.AbacatePayWebhookSignature.IsAuthentic(ReadOnlySpan<byte>, string?, string?,
  string)` -- puro, testável sem HTTP nem Docker. `BillingEndpoints.HandleWebhookAsync` chama-o
  sobre o corpo cru de cada pedido real.
- `Api.Billing.AbacatePayWebhookStore.TryRecordAsync(string eventId, string eventType,
  CancellationToken)` -- Postgres real (Testcontainers nos testes), sem RLS.
- `POST /webhooks/abacatepay` -- a fronteira HTTP do webhook. `AddBilling`/`MapBilling` são os
  pontos de registo em `Program.Composition.cs`. `BillingEndpoints.ReadBoundedBodyAsync` --
  `internal`, o leitor limitado que impõe o teto de 64 KiB.

## Testes

`apps/api/tests/Api.Tests/Billing/`:
- `AbacatePayClientMapResponseTests.cs` -- os 7 casos do seam puro.
- `AbacatePayJsonContextTests.cs` -- critério de aceite 1: as fixtures
  `checkout-create-200.json`/`checkout-get-200.json`/`error-401.json` desserializam pelo
  `AbacatePayJsonContext` gerado por source-gen.
- `AbacatePayClientTests.cs` -- sobre `CannedResponseHandler` (handler falso de ~15 linhas,
  sem rede real): URL absoluta, `Authorization: Bearer`, corpo serializado, `HttpRequestException`
  e timeout (`TaskCanceledException` sem cancel do chamador) viram `Unavailable`, cancelamento
  cooperativo com o pedido em voo propaga em vez de virar `Unavailable`, e o corpo truncado.
- `AbacatePayBodyLimitTests.cs` -- `ReadBoundedBodyAsync` sem servidor (ver "Decisões
  relevantes" para o porquê): sem `Content-Length` e acima de 64 KiB devolve `null`, dentro
  do teto devolve os bytes.
- `AbacatePayWebhookSignatureTests.cs` -- sobre os bytes crus de
  `fixtures/webhook-checkout-completed.json`: par válido, header ausente, header errado,
  segredo errado, segredo ausente, um byte do corpo alterado.
- `AbacatePayFixtures.ReadBytes(fileName)` -- molde exato de
  `ProblemDetailsProviderPactTests.ResolvePactFilePath`: sobe a partir de
  `AppContext.BaseDirectory` até encontrar `Billing/fixtures/<fileName>`. Sem item de csproj
  -- lido diretamente da árvore de fontes, a mesma técnica que já resolve `pacts/` na raiz do
  repositório.
- `CannedResponseHandler.cs` -- `HttpMessageHandler` de teste que captura o último pedido
  (`LastRequest`/`LastRequestBody`) e pode lançar em vez de responder, para simular falha de
  rede/timeout.
- `AbacatePayWebhookStoreTests.cs` -- Testcontainers, `[Collection("Database")]`, conecta como
  `app_role` (`PostgresContainerFixture.AppRoleConnectionString`, nunca superuser): primeira
  inserção de um `event_id` devolve `true`, a mesma reentrega devolve `false`, um `event_id`
  diferente devolve `true` de novo, e `UPDATE`/`DELETE` diretos por `app_role` lançam
  `PostgresException` com `SqlState = insufficient_privilege`.
- `apps/api/tests/Api.Tests/Rls/RowLevelSecurityCoverageTests.cs` -- lê
  `pg_class.relrowsecurity` para toda tabela em `public`: a única sem RLS tem de ser
  `abacatepay_webhook_events`. Cobre as 7 tabelas anteriores de borla -- uma tabela nova que
  esqueça `ENABLE ROW LEVEL SECURITY` falha aqui.
- `BillingEndpointsTests.cs` -- `POST /webhooks/abacatepay` ponta a ponta, contra o mesmo
  Postgres real: corpo acima de 64 KiB com `Content-Length` (`400`, via `ReadBoundedBodyAsync`), assinatura errada (`401` sem corpo),
  corpo válido mas não-JSON e `"null"` (`400` nos dois), e -- critério de aceite 3 -- os
  MESMOS bytes da fixture `webhook-checkout-completed.json` postados duas vezes:
  `duplicate:false` depois `duplicate:true`, com `SELECT COUNT(*) ... WHERE event_id = ...`
  a confirmar uma única linha.
- `Startup/MissingConfigurationTests.cs` -- `AbacatePay:WebhookSecret` em falta (com toda
  configuração anterior presente, para chegar especificamente a este guard, o último de
  `Program.Composition.cs`) lança `InvalidOperationException` com a chave no texto.
- `AbacatePayDriftTests.cs` (`[Trait("Category","Drift")]`, critério de aceite 2) -- a sonda
  viva: cria um checkout na sandbox e volta a lê-lo por `/checkouts/get`, afirmando que
  ambas as respostas parseiam num `CheckoutStatus` definido (`MalformedResponse` nunca).
  Sem `ABACATEPAY_SANDBOX_API_KEY` retorna sem afirmar nada (passa em vazio, nunca falha).
  Corre-se à parte (`--filter "Category=Drift" -p:CollectCoverage=false`); o passo
  `api-tests` do `quality-gates.yml` corre o resto (`--filter "Category!=Drift"`, com
  cobertura ligada) para o CI nunca correr a sonda sem segredo.
- `.github/workflows/abacatepay-drift.yml` -- workflow próprio (não job do
  `mutation-nightly.yml`), `schedule '41 4 * * *'` + `workflow_dispatch`, sem gatilho
  `pull_request` (vermelho de drift nunca bloqueia PR por construção). O passo `creds`
  escreve `have_key=false` e a razão em `$GITHUB_STEP_SUMMARY` quando o segredo falta; a
  sonda só corre com `have_key == 'true'`.

## Decisões relevantes

- **`AbacatePayWebhookSignature.PublicKey` -- valor real, não parâmetro.** A forma aprovada
  (`.harness/S12-01-forma.md`) instruía parar e pedir a chave por parâmetro caso o valor real
  não estivesse já no repositório/handoff. O valor não estava, mas foi obtido por leitura
  direta de `docs.abacatepay.com/pages/webhooks` (o exemplo Node
  `const ABACATEPAY_PUBLIC_KEY = "..."` da própria documentação publicada, a mesma fonte já
  citada no contrato fixado do handoff), não inventado. São **256 caracteres**, não os "~384"
  estimados na forma -- essa estimativa era um palpite de comprimento no texto da forma, não
  um valor fixado; o valor real é o que está na constante. Reportado como divergência da forma
  no relatório desta dispatch.
- **`AbacatePayWebhookEvent` nasceu só na fatia 7, não antes.** Nenhuma fatia 1-4 o
  desserializava -- declará-lo sem chamador deixaria o record com 0% de cobertura de linhas
  (confirmado por `dotnet test` com cobertura antes desse ajuste), e o piso de 100% deste
  repositório não abre exceção para tipos sem uso. O tipo é exatamente o que a forma já fixara.
- **Tabela de dedupe sem RLS, por decisão estrutural, não por falta de disciplina.** No
  instante em que `abacatepay_webhook_events` é escrita, não existe ainda mapa
  `externalId → tenant` (S12-02 é quem resolve isso) -- não há `tenant_id` para uma política
  `USING`/`WITH CHECK` verificar. `AbacatePayWebhookStore` liga por
  `OpenConnectionAsync` (molde `HealthEndpoints`), nunca por
  `OpenTenantScopedTransactionAsync`. A garantia de "só guarda o id opaco do fornecedor, o tipo
  de evento e o instante" não é imposta por `CHECK` (disponibilidade no caminho do dinheiro
  pesa mais), mas por haver um único escritor e pelo par `GRANT`/`REVOKE`.
  `RowLevelSecurityCoverageTests` é o teste que passa a impor "toda tabela com dados de tenant
  tem RLS" como invariante geral, com esta tabela como a única exceção nomeada. O ADR completo
   (`docs/adr/ADR-S12-01-dedupe-de-webhook-sem-rls.md`) fica para o fecho.
- **`AddBilling` recebe `IConfiguration`, ao contrário de `ConsentComposition.AddConsent`.**
  O molde do Consent não tem parâmetro porque não tem nenhuma chave obrigatória própria;
  `AbacatePay:WebhookSecret` obriga `AddBilling` a ler configuração, e o molde para essa
  leitura é `Program.cs:36-37` (falha rápida, sem Options pattern), não o Consent.
  `AddBilling` é chamado por último em `Program.Composition.cs` (depois de `AddConsent`), o
  que faz de `AbacatePay:WebhookSecret` o último guard de arranque da aplicação -- qualquer
  teste que construa o host inteiro e não defina essa chave falha com
  `InvalidOperationException`, e é por isso que 14 ficheiros de teste (a lista exata está no
  handoff da dispatch) ganharam uma linha `UseSetting("AbacatePay:WebhookSecret", ...)`.
- **A lista real dos "14 ficheiros" divergiu num item da lista prevista no handoff, confirmado
  por corrida completa da suíte após a fatia 7.** `MissingConfigurationTests.cs` não precisou
  da linha nova: os seus quatro testes existentes falham todos num guard anterior a
  `AbacatePay:WebhookSecret` (ordem: `ConnectionStrings:AppDb` → `WebAuthn:RelyingPartyId` →
  `WebAuthn:ExpectedOrigin` → `StaffAccess:ApiKey` → ... → `AbacatePay:WebhookSecret`), logo
  nunca chegam a `AddBilling`. Quem precisou, e não estava na lista, foi
  `Contracts/ProblemDetailsProviderPactTests.cs` -- constrói `Program.BuildApp` diretamente
  (não passa por `WebApplicationFactory`) para o ligar a um Kestrel real que o verificador Pact
  consegue atingir por socket, e por isso também constrói o host inteiro.
- **`ReadBoundedBodyAsync`: o teto manda sobre o que foi lido, não sobre o declarado.**
  O `(request.ContentLength ?? 0) > MaxBodyBytes` inicial é só o caminho rápido; com
  `Content-Length` nulo (chunked) ou mentiroso, o laço limitado a 64 KiB+1 é quem rejeita.
  `?? 0` em vez de `request.ContentLength is > MaxBodyBytes`: o padrão `is >` sobre `long?`
  compila em dois saltos e o ramo "ausente" ficava por exercer; `?? 0` reduz a uma comparação.
- **O caso `Content-Length` nulo prova-se sem servidor (`AbacatePayBodyLimitTests`).**
  O `TestHost.ClientHandler` do `WebApplicationFactory` fixa sempre `ContentLength` no
  comprimento real do corpo, por isso nenhum teste HTTP consegue entregar `null` com corpo --
  tentado e confirmado por sonda (pedido chunked de 64 KiB+1 chegava com `ContentLength=65537`).
  `ReadBoundedBodyAsync` é `internal static` (o `InternalsVisibleTo` já existia para
  `MapResponse`) e os testes usam `DefaultHttpContext` direto, sem Docker.
- **`InternalsVisibleTo Api.Tests` em `Api.csproj`.** Necessário para testar `MapResponse`
  como `internal` (o seam que a forma pede, sem tornar o método público sem chamador de
  produção). Item nativo do SDK (.NET 8+), sem `AssemblyInfo.cs` manual. Efeito colateral
  descoberto e corrigido nesta dispatch: expôs um segundo `Api.Accounts.CapturingMagicLinkEmailSender`
  interno que colidia, por nome, com o fake de teste homónimo em `Api.Tests.Accounts` dentro
  de `AuthEndpointsTests.cs` (ambos ficaram resolvíveis sem qualificação assim que o IVT
  passou a existir). Corrigido com um `using` de alias em `AuthEndpointsTests.cs`, sem tocar
  em nenhum dos dois tipos.
- **Sem retentativa/timeout configurados no `HttpClient`** passado ao construtor: `AddBilling`
  não regista `AbacatePayClient` em DI (continua sem chamador de produção em S12-01, ver
  "Pontos de entrada"); quem compõe o `HttpClient` (Polly, timeout, etc.) é o registo que
  S12-02 acrescenta junto do endpoint que o usa. `AbacatePayClient` só usa o que lhe é passado.

## Fora de âmbito desta dispatch

Nona e última fatia de código do ticket S12-01. Não tocado, fica para o fecho:
`docs/adr/ADR-S12-01-dedupe-de-webhook-sem-rls.md` (a ADR que documenta por que
`abacatepay_webhook_events` não tem RLS -- a decisão em si já está em vigor e testada por
`RowLevelSecurityCoverageTests`, só falta o documento). Ver `.harness/S12-01-forma.md`
("Seams, por ordem de fatia") para a lista completa e a ordem.
