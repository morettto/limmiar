# Api.Scheduling

## Responsabilidade

Agenda: agendar, mover e cancelar sessões (`scheduled_sessions`, migração
`0004_create_scheduled_sessions.sql`), RLS por tenant como `Api.Patients`. Ao contrário de
`patient_record_entries`, `starts_at`/`duration_minutes` ficam em claro no servidor -- é o
metadado mínimo necessário para o próprio Postgres detetar um conflito de horário sob
concorrência real (ver `docs/adr/ADR-S04-02-horario-em-claro-servidor-zero-knowledge.md`).
`patient_id` continua a ser só um uuid, sem nenhum campo em claro sobre a pessoa.

## Fluxo principal

- `ScheduledSessionStore` -- único ponto de acesso a `scheduled_sessions`. `InsertAsync`
  confia inteiramente no índice único parcial `scheduled_sessions_live_slot_uq`
  (`(tenant_id, starts_at) WHERE cancelled_at IS NULL`) para decidir quem vence uma corrida
  pelo mesmo horário -- não há verificação otimista em aplicação antes do INSERT.
  `MoveAsync`/`CancelAsync` correm sob `SELECT ... FOR UPDATE` (lock de linha) via o método
  privado partilhado `LockAndGuardAsync`, que lê a linha e corre as três guardas (sessão não
  encontrada, já cancelada, gravação ativa) uma única vez -- cada chamador só faz depois o seu
  próprio `UPDATE`. `MoveAsync`/`CancelAsync` devolvem `(ScheduledSession? Session,
  SchedulingFailureReason? FailureReason)`: o store já fala o vocabulário final de falha, não
  há tipo intermédio a traduzir a jusante.
- `SchedulingService` -- `AuthorizeAsync` (privado) verifica a conta uma única vez para
  `ScheduleAsync`/`MoveAsync`/`CancelAsync` (existe, é Profissional Ativo, reusando
  `AccountAuthorizationGuard.CanCreatePatientRecords`, o mesmo guard que `PatientService`
  usa); cada método público só adapta `ScheduledSessionSlotConflictException` para
  `SchedulingFailureReason.SlotTaken` e devolve `SchedulingResult` -- nenhuma
  `PostgresException` nem exceção de domínio escapa deste serviço.
- `Api.Endpoints.SchedulingEndpoints` -- `POST/PATCH/DELETE
  /accounts/{accountId}/agenda/sessions[/{sessionId}]`. Sem `GET` (não pedido por nenhum
  critério de aceite deste ticket). Usa os helpers partilhados de
  `Api.Endpoints.EndpointHelpers` (`IsAuthorizedForAccount`/`ProblemJson`/
  `ValidationProblem`/`AccessTokenUnauthorizedProblem`), os mesmos que os outros cinco
  ficheiros de endpoints usam. Um único `MapFailureToProblem(SchedulingFailureReason)` cobre
  as três rotas.

## Decisões relevantes

- Índice único parcial em vez de `EXCLUDE USING gist`: o critério de aceite pede deteção de
  "mesmo horário" (exact match), não sobreposição parcial de intervalos -- ver o comentário
  `ponytail:` em `0004_create_scheduled_sessions.sql` para o caminho de upgrade.
- `recording_active` não tem escritor nem `GRANT UPDATE` de produção neste ticket -- só
  `ScheduledSessionStore.MoveAsync`/`CancelAsync` o leem (sob o lock de linha) para rejeitar
  mover/cancelar uma sessão com gravação ativa. A futura migração S05/S06 que introduzir o
  endpoint de gravação tem de acrescentar o `GRANT UPDATE (recording_active)` nessa altura --
  esse `UPDATE` depois fica na fila do mesmo lock, não é preciso inventar uma segunda tabela
  nem um segundo lock quando esse endpoint existir.
- `SchedulingFailureReason`/`SchedulingResult` são um único tipo partilhado por
  Schedule/Move/Cancel (não `ScheduleSessionResult` + `MutateSessionResult` em paralelo,
  quase idênticos): `SlotTaken` só é produzido por Schedule e Move (Cancel nunca muda
  `starts_at`, logo nunca pode colidir com outra linha viva) -- não há um enum próprio por
  operação para essa única assimetria.
