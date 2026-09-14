# Forma · S09-04 — a agenda do painel deixa de modelar canceladas

Base: `4046cf4` na branch `feat/S09-01-painel-profissional` (worktree `C:/wt-S09-01`).
Skill de construção: `migration` (muda o contrato de resposta de um endpoint) + `tdd` + `ponytail`.

## 1. Contrato

`GET /accounts/{accountId}/agenda/sessions?from=&to=` devolve só sessões vivas, na janela
`[from,to)`, ordenadas por `starts_at` (`ScheduledSessionStore.ListLiveAsync:188-213`).
Uma cancelada nunca aparece, por isso o item de lista não tem `cancelledAt`.

## 2. Tipos e assinaturas

### Backend — `apps/api/src/Api/Features/Scheduling/SchedulingEndpoints.cs`

```csharp
// novo, ao lado de ScheduledSessionResponse (que fica igual: POST e PATCH continuam a devolvê-lo)
public sealed record ScheduledSessionListItem(Guid SessionId, Guid PatientId, DateTimeOffset StartsAt, int DurationMinutes);

// muda o tipo do item
public sealed record ListScheduledSessionsResponse(IReadOnlyList<ScheduledSessionListItem> Sessions);

// HandleListAsync:154
return TypedResults.Ok(new ListScheduledSessionsResponse(
    sessions.Select(s => new ScheduledSessionListItem(s.Id, s.PatientId, s.StartsAt, s.DurationMinutes)).ToList()));
```

`SchedulingJsonContext` já regista `ListScheduledSessionsResponse` como raiz; o gerador de fonte
alcança o item por ele. Se o teste AOT/JSON exigir, acrescentar `[JsonSerializable(typeof(ScheduledSessionListItem))]`.

### Front — `apps/app/src/entities/agenda/sessao.ts`

```ts
export const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000   // só a janela do pedido a usa

export interface SessaoAgendada {
  readonly sessionId: string
  readonly patientId: string
  readonly inicioEm: string
  readonly duracaoMinutos: number
}                                                       // canceladaEm sai

// um só filtro de tempo vivo, privado ao módulo
function porComecar(sessoes: readonly SessaoAgendada[], agora: Date): SessaoAgendada[]
  // inicioEm >= agora, preserva a ordem do servidor

export function proximaSessao(sessoes, agora): SessaoAgendada | null   // porComecar(...)[0] ?? null
export function sessoesNaSemana(sessoes, agora): number                // porComecar(...).length
```

A janela de 7 dias é do pedido, não do KPI: `sessoesNaSemana` deixa de recortar o limite superior.
`proximaSessao` passa a confiar na ordem do contrato (`ORDER BY starts_at`) e deixa de fazer `reduce`.

### Front — `apps/app/src/entities/agenda/api.ts`

Corpo tipado `{ sessions: { sessionId; patientId; startsAt; durationMinutes }[] }`, mapeamento dos 4 campos.

### Front — `apps/app/src/widgets/painel-profissional/PainelProfissional.tsx`

```ts
type DadosPacientes = { sumarios: readonly SummaryResult[]; consentimentos: readonly ConsentimentosPorPaciente[] }
// :35 → pacientes: ResultadoFonte<DadosPacientes>
// :78-81 → o alias local PacientesFonte sai; usa-se ResultadoFonte<DadosPacientes>
```

O `agora` de render (`:186`) continua a ser um só, partilhado pela ação principal e pelo KPI.
O desencontro de borda com o `agora` do fetch (`:119`) deixa de existir: o KPI já não recalcula o
limite de 7 dias, a janela é só do pedido. O filtro de render só retira as sessões que começaram
entre o fetch e o render, que é o comportamento certo.

## 3. Seams e fatias TDD (um vermelho de cada vez)

| # | Ficheiro de teste | Vermelho | Verde |
|---|---|---|---|
| B1 | `apps/api/tests/Api.Tests/Scheduling/SchedulingEndpointsTests.cs` | o teste da lista lê o JSON cru e asserta que nenhum item tem a propriedade `cancelledAt` (hoje sai `"cancelledAt":null`) | `ScheduledSessionListItem` |
| F1 | `apps/app/src/entities/agenda/api.test.ts` | o corpo do mock não traz `cancelledAt`; `toStrictEqual` com os 4 campos (o `toEqual` ignora `canceladaEm: undefined` e ficaria verde) | tipo e mapeamento sem `cancelledAt` |
| F2 | `apps/app/src/entities/agenda/sessao.test.ts` | fixture sem `canceladaEm`; `sessoesNaSemana` conta uma sessão a 8 dias (a janela é do pedido); testes de cancelada saem; `proximaSessao` com entrada ordenada devolve a primeira por começar | `porComecar` + `canceladaEm` fora do tipo |
| R1 | `PainelProfissional.test.tsx` (sem asserção nova nem alterada) | — refactor, fora do loop | `DadosPacientes`; `agendaResponse` e `sessaoEm1h` sem `cancelledAt`/`canceladaEm` |

## 4. Documentação

- `apps/app/src/entities/agenda/README.md`: tipo com 4 campos, filtro único, janela do pedido, ordem do contrato; apagar a nota "mapeado por completude".
- `apps/app/src/widgets/painel-profissional/README.md:29,94-97,114-117`: `SETE_DIAS_MS` só na janela do pedido; `DadosPacientes`.
- `apps/api/src/Api/Features/Scheduling/README.md:36-41`: o item da lista é `ScheduledSessionListItem`, sem `CancelledAt`.
- `ARCHITECTURE.md`: sem mudança (nenhum ficheiro criado, movido ou apagado).

## 5. Invariantes

401 sem token, token inválido ou sem `Bearer`; 403 `auth.forbidden` para outra conta; nunca 404.
100% de linha e ramo por ficheiro tocado. Nenhuma asserção de `PainelProfissional.test.tsx` muda.
