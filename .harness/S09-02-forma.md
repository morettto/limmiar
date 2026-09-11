# S09-02 — forma para o portão (etapa 4)

Desenho do ticket S09-02, sobre `C:\wt-S09-01`. **Nenhuma linha de implementação escrita.**

---

## 1. Decisões de âmbito

**As sessões carregam-se no widget, não no router.** O ticket diz "IndexRouteComponent carrega", mas isso não chega para os invariantes:

| | router carrega, passa `sessoes` | widget carrega (**escolhido**) |
|---|---|---|
| guarda kek/accountId/token | teria de duplicar `chaveiroDestrancado` fora do widget | já existe, fonte única (`PainelProfissional.tsx:43`) |
| falha → `—` + `role="alert"` | a prop teria de passar a `ResultadoFonte`, o que força o tipo a sair do widget | um segundo slot `sessoes: ResultadoFonte<…>` ao lado de `pacientes` |
| cancelamento no unmount | um segundo `AbortController` no router | reutiliza o `cancelled` e o abort do `useEffect` |
| em produção hoje | `accessToken=null` → nunca carrega | igual: painel em "chaveiro bloqueado" (fora de âmbito) |

Consequência: a prop `sessoes` **sai** de `PainelProfissional`, de `HomePage` e do router. O diff é menor do que carregar no router e fica tudo num só `useEffect`.

**Backend:**
- **Endpoint → store, sem passar pelo service.** `SchedulingService` só acrescenta `AuthorizeAsync` (profissional ativo) e a tradução de `SlotTaken`, e nenhum dos dois se aplica a uma leitura. O molde é a leitura de Patients (`PatientEndpoints.cs:49`: "does NOT require CanCreatePatientRecords"). Um `ListAsync` no service seria só pass-through, um módulo raso. Já há precedente de endpoint que injeta o store diretamente: `ProfessionalVerificationEndpoints.cs:85` (`IAccountStore store`).
- **As canceladas ficam de fora (`cancelled_at IS NULL`).** Assim o índice parcial `scheduled_sessions_live_slot_uq (tenant_id, starts_at) WHERE cancelled_at IS NULL` cobre exatamente o range scan (a RLS injeta `tenant_id = current_setting(...)`, que é STABLE e portanto serve de condição de índice). **Não há migração.** Incluir as canceladas obrigaria a um índice novo (migração) sem nenhum consumidor que o peça: `proximaSessao` e `sessoesNaSemana` descartam-nas de qualquer forma. `CancelledAt` continua no DTO (é sempre `null` aqui) para reutilizar `ScheduledSessionResponse` sem mexer.
- **Janela meio-aberta `[from, to)`, máximo de 7 dias, com o limite incluído.** O único consumidor pede `[agora, agora+7d)`, o mesmo intervalo de `sessoesNaSemana`. Se a próxima sessão estiver a mais de 7 dias, o botão fica "Iniciar próxima sessão" sem nome, e isso é aceitável: ninguém inicia a partir do painel uma sessão marcada para daqui a 8 dias. Alargar a janela é reversível e não precisa de paginação enquanto for 7d.
- **`from`/`to` ligam-se como `string?` e fazem-se parse à mão.** Ligar diretamente a `DateTimeOffset?` falha fora do nosso formato: em Development, o `BadHttpRequestException` cai no `GlobalProblemExceptionHandler` e sai **500**; em Production sai um 400 vazio. As duas coisas violam o critério 4. O parse usa `DateTimeOffset.TryParse(v, InvariantCulture, AssumeUniversal)` seguido de `.ToUniversalTime()`, porque o Npgsql exige offset zero em `timestamptz` (`SchedulingService.cs:38`). O front envia `toISOString()` (`Z`).
- **Resposta `{ sessions: [...] }`,** no molde de `ListPatientsResponse(Patients)`. A lista vazia dá 200 `{ "sessions": [] }`.
- **Conta alheia dá 401, não 403/404.** O ticket obriga a usar `IsAuthorizedForAccount`, que devolve `false` para um token de outra conta, e isso resulta em `AccessTokenUnauthorizedProblem` (401 `auth.access_token_invalid`). É o que fazem os outros cinco ficheiros de endpoints. O corpo é idêntico para conta alheia, conta inexistente e pedido sem token, por isso não se vaza a existência da conta. A RLS garante a segunda camada: um tenant nunca vê linhas de outro. Ver "Decisões que esperam o humano".

---

## 2. Tipos e assinaturas

```csharp
// SchedulingEndpoints.cs
app.MapGet("/accounts/{accountId:guid}/agenda/sessions", HandleListAsync)
    .WithName("ListScheduledSessions")
    .Produces<ListScheduledSessionsResponse>(200)
    .Produces<LimmiarProblemDetails>(400, "application/problem+json")
    .Produces<LimmiarProblemDetails>(401, "application/problem+json");

private static readonly TimeSpan MaxListWindow = TimeSpan.FromDays(7);

private static async Task<Results<Ok<ListScheduledSessionsResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleListAsync(
    Guid accountId, string? from, string? to,
    [FromHeader(Name = "Authorization")] string? authorization,
    ISessionTokenIssuer sessionTokenIssuer, ScheduledSessionStore store, CancellationToken cancellationToken);
// 1. !IsAuthorizedForAccount → AccessTokenUnauthorizedProblem()   (auth antes da validação, molde :59)
// 2. !TryParseWindow → problem
// 3. store.ListLiveAsync → Ok(new(sessions.Select(ToResponse).ToList()))

/// from ausente/ilegível → ValidationProblem("from"); to ausente/ilegível, to <= from, to - from > 7d → ValidationProblem("to")
private static bool TryParseWindow(string? from, string? to,
    out DateTimeOffset fromUtc, out DateTimeOffset toUtc, out JsonHttpResult<LimmiarProblemDetails> problem);

public sealed record ListScheduledSessionsResponse(IReadOnlyList<ScheduledSessionResponse> Sessions);

// ScheduledSessionStore.cs — ÚLTIMO membro da classe, depois de ReadSession (sem StyleCop/SA1202 no repo)
/// Live sessions with starts_at in [fromUtc, toUtc), earliest first. Isolation from RLS, no WHERE tenant_id.
public async Task<IReadOnlyList<ScheduledSession>> ListLiveAsync(
    Guid tenantId, DateTimeOffset fromUtc, DateTimeOffset toUtc, CancellationToken cancellationToken);

// SchedulingComposition.cs
[JsonSerializable(typeof(ListScheduledSessionsResponse))]
```

```ts
// entities/agenda/sessao.ts — única mudança: `const` → `export const SETE_DIAS_MS`

// entities/agenda/api.ts   [novo; importa ./sessao e ../../shared/api — dependency-cruiser ok]
export type ListarSessoesResult = { ok: true; sessoes: SessaoAgendada[] } | ProblemResult
/** GET …/agenda/sessions?from=&to= — de/ate via toISOString + encodeURIComponent. */
export function listarSessoes(baseUrl: string, accountId: string, accessToken: string, de: Date, ate: Date): Promise<ListarSessoesResult>
// body { sessions: {sessionId, patientId, startsAt, durationMinutes, cancelledAt: string|null}[] }
//   → { sessionId, patientId, inicioEm: startsAt, duracaoMinutos: durationMinutes, canceladaEm: cancelledAt }

// widgets/painel-profissional/PainelProfissional.tsx
export interface PainelProfissionalProps { baseUrl; accountId; accessToken; kek; notas; openSummaries? }  // sai `sessoes`
type EstadoPainel =
  | { status: 'bloqueado' } | { status: 'a-carregar' }
  | { status: 'pronto'
      pacientes: ResultadoFonte<{ sumarios; consentimentos }>        // como hoje
      sessoes: ResultadoFonte<readonly SessaoAgendada[]> }             // novo slot
```

`HomePageProps` perde `sessoes`. O `IndexRouteComponent` deixa de passar `sessoes={[]}`.

---

## 3. SQL exato

```sql
-- dentro de OpenTenantScopedTransactionAsync(tenantId) → SET LOCAL app.tenant_id; COMMIT no fim
SELECT id, tenant_id, patient_id, starts_at, duration_minutes, recording_active, cancelled_at, created_at  -- {SelectColumns}
FROM scheduled_sessions
WHERE cancelled_at IS NULL
  AND starts_at >= @from
  AND starts_at <  @to
ORDER BY starts_at
```

A ordem é determinística: entre as linhas vivas, `(tenant_id, starts_at)` é único por índice. Cada linha lê-se com o `ReadSession` já existente. Não há migração nem GRANT novo (`GRANT SELECT` já está em `0004:48`).

---

## 4. Onde vive cada peça

```text
apps/api/src/Api/Features/Scheduling/
├── SchedulingEndpoints.cs      # + MapGet, HandleListAsync, TryParseWindow, ListScheduledSessionsResponse
├── ScheduledSessionStore.cs    # + ListLiveAsync (fim da classe)
├── SchedulingComposition.cs    # + [JsonSerializable] do record da lista
└── README.md                   # sai "Sem GET"; entra GET, janela, canceladas fora, parse em string
apps/app/src/
├── entities/agenda/api.ts      # NOVO — HTTP → SessaoAgendada
├── entities/agenda/sessao.ts   # export SETE_DIAS_MS
├── widgets/painel-profissional/PainelProfissional.tsx  # 2.ª fonte, 2.º alert, KPI "—"
├── pages/home/HomePage.tsx     # sem prop sessoes
└── app/routing/router.tsx      # sem sessoes={[]}; comentário ponytail atualizado
```

---

## 5. Call tree

```text
GET /accounts/{id}/agenda/sessions?from&to
└─ HandleListAsync
   ├─ IsAuthorizedForAccount ──✗──→ 401 auth.access_token_invalid
   ├─ TryParseWindow ──────────✗──→ 400 validation.invalid_field {field: from|to}
   └─ store.ListLiveAsync(accountId, fromUtc, toUtc)
      └─ tenant tx → SELECT … → ReadSession* → COMMIT → 200 { sessions }

PainelProfissional useEffect([kek, accountId, accessToken, …])
├─ !chaveiroDestrancado → 'bloqueado'                          ← nenhum pedido sai
└─ Promise.all([                                               ← as duas fontes nunca rejeitam
     carregarPacientes(kek, acc, tok).catch(→ {ok:false, motivo genérico}),   // corpo atual
     carregarSessoes(acc, tok).catch(→ {ok:false, t`Não foi possível carregar a agenda.`})
       └─ listarSessoes(baseUrl, acc, tok, agora, agora + SETE_DIAS_MS)
            !ok → {ok:false, translateProblemCode(...)}
   ]) → cancelled? return : setEstado({status:'pronto', pacientes, sessoes})
render
├─ proxima = sessoes.ok ? proximaSessao(sessoes.dados, agora) : null
├─ KPI "Sessões na semana" = sessoes.ok ? sessoesNaSemana(...) : '—'
└─ !sessoes.ok → <p role="alert">{sessoes.motivo}</p>   (irmão do alert de pacientes)
```

---

## 6. Fatias TDD, por ordem (um vermelho de cada vez)

| # | Teste vermelho | Asserta | Critério |
|---|---|---|---|
| B1 | `SchedulingEndpointsTests.ListSessions_ReturnsOnlyOwnLiveSessionsInsideWindow_OrderedByStartsAt` | A: 3 sessões na janela inseridas fora de ordem, 1 em `from-1min`, 1 exatamente em `to` (fica de fora), 1 cancelada (DELETE). B (segundo client da mesma factory): 1 sessão na janela. GET de A com janela de **exatamente 7d** → 200, as 3 de A por `startsAt`. Faz nascer o endpoint, o store e o JsonContext. | 2 |
| B2 | `ListSessions_WithInvalidWindow_Returns400WithProblemDetails` (Theory) | `from` ausente, `to` ausente, `from=amanha`, `from==to`, `from>to`, `7d+1s` → 400 `application/problem+json`, `code=validation.invalid_field`, `params.field` ∈ {from, to}. Cobre todos os ramos de `TryParseWindow`. | 4 |
| B3 | `ListSessions_WithoutTokenOrOtherAccountsToken_Returns401WithSameProblem` | sem token; token de B no URL de A; token de A num guid aleatório → os três 401 com **o mesmo corpo** (`auth.access_token_invalid`). | 3 |
| F1 | `entities/agenda/api.test.ts` | `vi.stubGlobal('fetch')` (molde `patient/api.test.ts`): URL `…/agenda/sessions?from=<enc>&to=<enc>` + `Authorization: Bearer`; mapeia os 5 campos, incluindo `cancelledAt` não-nulo; 403 → `ProblemResult` intacto. | 1 |
| F2 | `PainelProfissional.test.tsx` — critério 1 reescrito | **Sem prop `sessoes`**: o `fetch` stubbed responde a `/agenda/sessions` com uma sessão em +1h de `p-1` → botão `Amelia <hora>`. Asserta também que o fetch foi chamado com `/accounts/acc-1/agenda/sessions?from=`. O `openSummaries` continua injetado (é o seam do worker, não das sessões). | 1 |
| F3 | mesmo ficheiro | `/agenda/sessions` → 500: KPI "Sessões na semana" = `—`, um `role="alert"` com o motivo, "Pacientes ativos" continua numérico, botão sem nome. | invariante `—` |
| F4 | mesmo ficheiro (verde por refactor) | `fetchMockPadrao` passa a encaminhar `/agenda/sessions` → `{sessions:[]}` (senão os testes de consentimento ganham um alert espúrio). Os testes "exceção lançada" e "listPatients 500" passam a `findAllByRole('alert')` com 2 elementos, ou encaminham a agenda para 200. Os testes de "sem sessão" e "uuid" alimentam-se pelo fetch. "kek=null não chama fetch" fica igual e cobre o invariante herdado. | 1, invariantes |
| F5 | `HomePage.test.tsx` (verde por refactor) | sai `sessoes={[]}`; os casos atuais continuam verdes. | — |

Critério 1 de ponta a ponta: o F2 atravessa `listarSessoes` → `request` → `fetch` (stub global do Vitest, que é a ferramenta que o app já usa; não há MSW no repo). O B1 prova que o backend devolve essa forma.

---

## 7. `ficheiros_previstos` finais

| Ficheiro | Responsabilidade |
|---|---|
| toca `apps/api/src/Api/Features/Scheduling/SchedulingEndpoints.cs` | GET, validação, record da lista |
| toca `apps/api/src/Api/Features/Scheduling/ScheduledSessionStore.cs` | `ListLiveAsync` no fim |
| toca `apps/api/src/Api/Features/Scheduling/SchedulingComposition.cs` | **novo na lista**: registo AOT do record |
| toca `apps/api/src/Api/Features/Scheduling/README.md` | doc-sync |
| toca `apps/api/tests/Api.Tests/Scheduling/SchedulingEndpointsTests.cs` | B1–B3 |
| **novo** `apps/app/src/entities/agenda/api.ts` | `listarSessoes` |
| **novo** `apps/app/src/entities/agenda/api.test.ts` | F1 |
| toca `apps/app/src/entities/agenda/sessao.ts` | `export SETE_DIAS_MS` |
| toca `apps/app/src/entities/agenda/README.md` | sai "Sem api.ts" |
| toca `apps/app/src/widgets/painel-profissional/PainelProfissional.tsx` | 2.ª fonte |
| toca `apps/app/src/widgets/painel-profissional/PainelProfissional.test.tsx` | F2–F4 |
| toca `apps/app/src/widgets/painel-profissional/README.md` | sai "sessoes por prop" |
| toca `apps/app/src/pages/home/HomePage.tsx` | sem `sessoes` |
| toca `apps/app/src/pages/home/HomePage.test.tsx` | F5 |
| toca `apps/app/src/pages/home/README.md` | props |
| toca `apps/app/src/app/routing/router.tsx` | sem `sessoes={[]}` |
| toca `apps/app/src/app/routing/README.md` | linha 40–42 |
| toca `apps/app/src/locales/*/messages.po` | `lingui extract` ("Não foi possível carregar a agenda.") |
| toca `ARCHITECTURE.md` | linha 8: `entities/agenda` passa a ter `api.ts` sobre o GET |

---

## ADR

Nenhuma. Nenhuma das escolhas é difícil de reverter: as canceladas fora, 7d e o parse a partir de `string` mudam-se sem migração nem quebra de contrato para o único cliente. O 401 para conta alheia é a convenção que já existe e não surpreende quem conhece o código. Tudo fica registado no README do Scheduling.

---

## Decisões que esperam o humano

1. **O critério 3 diz "403/404"; a forma entrega 401.** Resulta de `IsAuthorizedForAccount`, que o próprio ticket impõe, e é a convenção dos outros endpoints. O corpo é igual para conta alheia, conta inexistente e pedido sem token, por isso não vaza existência. **Não bloqueia:** o default é 401 e o B3 asserta-o. Distinguir 403 exigiria ler o `accountId` do token fora do helper partilhado, e seria o único endpoint a fazê-lo.
