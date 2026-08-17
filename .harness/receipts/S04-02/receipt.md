# Receipt — S04-02 Conflito transacional sob concorrência real

commit: 553ba11
branch: feat/S03-01-modelo-append-only-paciente
spec: S04 Agenda
rondas_review: 2

## Critério × prova × resultado

| Critério de aceite | Prova | Resultado |
|---|---|---|
| Testcontainers: duas transações concorrentes pelo mesmo horário produzem exatamente um vencedor | `SchedulingEndpointsTests.ScheduleAsync_TwoConcurrentRequestsForSameSlot_OnlyOnePersists` — dois `Task.Run` + `Task.WhenAll` contra Postgres real; índice único parcial `scheduled_sessions_live_slot_uq` decide, `PostgresErrorCodes.UniqueViolation` → `ScheduledSessionSlotConflictException` → `SchedulingFailureReason.SlotTaken`; confirmado por contagem direta na DB (1 linha viva) | PASS |
| Metadado de horário não cifrado; identidade do paciente permanece cifrada | `ScheduledSessions_HasNoPlaintextPatientColumn` — asserção sobre `information_schema.columns` do conjunto exato de colunas (`starts_at`/`duration_minutes` em claro, `patient_id` só uuid, nenhuma coluna de texto sobre a pessoa); decisão registada em `docs/adr/ADR-S04-02-horario-em-claro-servidor-zero-knowledge.md` | PASS |
| Sessão com gravação ativa não pode ser movida nem cancelada | `MoveSession_WithRecordingActive_Returns409...` e `CancelSession_WithRecordingActive_Returns409...` — guarda sob `SELECT ... FOR UPDATE` em `LockAndGuardAsync`, `recording_active` setada por SQL direto (sem escritor de produção ainda, seam para S05/S06) | PASS |

## Pipeline

1. Scout mapeou o padrão vertical de `Api.Patients` (store → service → endpoints → migração → ProblemCodes → teste de concorrência com `Task.WhenAll`) como molde a replicar.
2. Arquiteto desenhou a forma antes de código: índice único parcial `(tenant_id, starts_at) WHERE cancelled_at IS NULL` em vez de `EXCLUDE USING gist` (critério pede "mesmo horário", não sobreposição parcial — `ponytail:` regista o teto e o caminho de upgrade), grants por coluna (Scheduling quebra deliberadamente o padrão append-only de Patients porque mover/cancelar são updates), `recording_active` como seam sem escritor de produção neste ticket.
3. Implementer construiu módulo `Scheduling` completo, TDD, 25 testes novos, 100% cobertura.
4. Review-chain (6 eixos paralelos): C# limpo, SQL 1 bloqueante (grant de `UPDATE` em `recording_active` sem escritor, contra least-privilege de `0002`), thermo-nuclear 5 bloqueantes (dois tipos de resultado duplicados, rename identidade sem valor, guardas Move/Cancel copiadas, preâmbulo de autorização triplicado, extração de `EndpointHelpers` incompleta com assinatura errada e README a descrever estado falso), spec/lean/segurança sem bloqueantes.
5. Ronda 1: os 6 bloqueantes corrigidos. `EndpointHelpers` consolidado como única cópia de `ProblemJson`/`ValidationProblem`/`AccessTokenUnauthorizedProblem`/`IsAuthorizedForAccount`, usada pelos seis ficheiros de endpoints (Auth, DevicePairing, ProfessionalVerification, Recovery, TwoFactor, Patients) além de Scheduling — as cópias privadas divergentes saíram. `ScheduleSessionResult`/`MutateSessionResult` fundidos em `SchedulingResult`. `LockAndGuardAsync`/`AuthorizeAsync` extraídos.
6. Ronda 2 (thermo + segurança focados no diff da ronda 1): segurança sem achados novos. Thermo achou 1 bloqueante novo — a extração de `LockAndGuardAsync`/`AuthorizeAsync` trocou o wrapper apagado por conversão de tuplo nullable sem valor (`var (_, rejection) = ...`, `session!` a atravessar a fronteira store→service). Corrigido diretamente: `LockAndGuardAsync` devolve só `SchedulingFailureReason?`, `ScheduledSessionStore.MoveAsync`/`CancelAsync` devolvem `SchedulingResult` diretamente, sem tuplo intermédio. Dois achados adicionais do thermo (`HealthEndpoints` com cópia própria de `ProblemJson`; Move/Cancel ainda repetem o esqueleto de comando fora das guardas) ficam registados como não-resolvidos-mas-fora-do-âmbito: o primeiro é ficheiro nunca tocado por este diff, o segundo foi uma escolha explícita da ronda 1 ("não fundir Move e Cancel numa única query") — nenhum dos dois é achado novo desta ronda, não entram na correção.
7. Sem ronda 3 (regra do harness). Verificação final independente (`runner`, duas vezes) confirmou build/testes/cobertura sem depender do auto-relato do implementer.

## Cobertura final

C#: 471/471 testes (25 novos de Scheduling), 100% linhas/branches/métodos (coverlet, gate automático).

## Não-bloqueantes registados (não corrigidos neste ticket, por regra)

- SQL: nome de constraint `duration_positive` mistura duas invariantes; índice em falta para consulta "sessões futuras de um paciente".
- Lean: duplicação residual de `AlwaysValidSessionTokenIssuer`/`StubTotpProvider`/`StubCouncilRegistryVerifier` (5ª cópia, dívida pré-existente).
- Spec: âncora de concorrência do teste sem barreira de sincronização explícita; `MoveSessionRequest.DurationMinutes` e a guarda `SessionCancelled` são comportamento a mais que os três critérios não pediam literalmente (decisão de forma razoável, não desvio).
- Segurança: `patient_id` sem verificação de existência em `ScheduleAsync` (mesmo padrão que `PatientService.CreateAsync` já usa); teste de RLS direto na tabela em falta (Scheduling só prova isolamento pela via HTTP).
- Thermo: `SchedulingResult.Succeeded` é campo redundante (`FailureReason is null`); `HealthEndpoints.cs` mantém cópia própria de `ProblemJson` (8º ficheiro, fora do diff); linhas em branco residuais em 5 ficheiros de endpoints.

## Handoff

Ticket S04-02 fechado sem trabalho pendente nele próprio. Mas `/build:mr` foi invocado para a spec S04 e o portão de entrada **falhou**: 2 das 3 user stories da spec (arrastar sessão com notificação ao paciente; barra de ocupação) não têm ticket nem prova — só existem `S04-01` (modelo de tempo) e `S04-02` (conflito transacional), ambos backend. `CalendarViewport`, drag-to-move e a barra de ocupação nunca foram tracer-bulleted. Spec revertida para `em-desenvolvimento` (não `em-review`); MR não aberta. Próximo passo é `/plan:tickets S04` para partir as duas user stories em falta antes de qualquer MR desta spec.

Ronda 2 atingida → `/build:friction` agendado.
