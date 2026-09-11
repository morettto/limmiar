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
  próprio `UPDATE`. `MoveAsync`/`CancelAsync` devolvem `Api.Platform.Result<ScheduledSession,
  SchedulingFailureReason>`: o store já fala o vocabulário final de falha, não há tipo
  intermédio a traduzir a jusante, e a exclusividade valor-ou-falha é estrutural (`Match`), não
  um `required bool Succeeded` com dois nullables. `ListLiveAsync` é a única leitura: sem
  `WHERE tenant_id` (a RLS injeta-o via `OpenTenantScopedTransactionAsync`), devolve as linhas
  vivas na janela pedida ordenadas por `starts_at`.
- `SchedulingService` -- `AuthorizeAsync` (privado) verifica a conta uma única vez para
  `ScheduleAsync`/`MoveAsync`/`CancelAsync` (existe, é Profissional Ativo, reusando
  `AccountAuthorizationGuard.CanCreatePatientRecords`, o mesmo guard que `PatientService`
  usa); cada método público só adapta `ScheduledSessionSlotConflictException` para
  `SchedulingFailureReason.SlotTaken` e devolve `Result<ScheduledSession,
  SchedulingFailureReason>` -- nenhuma `PostgresException` nem exceção de domínio escapa deste
  serviço.
- `SchedulingEndpoints` -- `POST/PATCH/DELETE /accounts/{accountId}/agenda/sessions[/{sessionId}]`
  e `GET /accounts/{accountId}/agenda/sessions?from=&to=`, que lista sessões vivas na janela
  meio-aberta `[from, to)`, máximo de 7 dias com o limite incluído, ordenadas por `starts_at`.
  Canceladas ficam sempre de fora (`cancelled_at IS NULL`), coberto pelo mesmo índice parcial
  `scheduled_sessions_live_slot_uq` -- sem migração nem `GRANT` novo. O item da lista é
  `ScheduledSessionListItem` (`SessionId`, `PatientId`, `StartsAt`, `DurationMinutes`), sem
  `CancelledAt`: como uma cancelada nunca chega a este endpoint, o campo não tem razão de
  existir no fio -- `ScheduledSessionResponse` (POST/PATCH) continua com `CancelledAt?`, porque
  essas duas rotas devolvem a sessão que acabaram de mutar, cancelada ou não. `from`/`to`
  ligam-se como `string?` e fazem parse à mão com `DateTimeOffset.TryParse(...,
  DateTimeStyles.AssumeUniversal)`: ligar diretamente a `DateTimeOffset?` dá 500 em Development
  (o `BadHttpRequestException` cai no `GlobalProblemExceptionHandler`) e um 400 vazio em
  Production. `GET` vai direto ao `ScheduledSessionStore` (sem passar por `SchedulingService`,
  molde `ProfessionalVerificationEndpoints.HandleListQueueAsync`, que também injeta um store
  diretamente para uma listagem): o service só acrescentaria `AuthorizeAsync` e a tradução de
  `SlotTaken`, e nenhum dos dois se aplica a uma leitura -- `ListLiveAsync` já devolve
  exatamente a forma que a rota expõe, sem nenhuma regra de negócio entre o store e a
  resposta. As quatro rotas têm `{accountId}` no padrão, o que basta para
  `RequireAccountAccessMiddleware` (`Accounts.Sessions/README.md`) as proteger e distinguir
  401 de 403 (RFC 9110): sem token ou token inválido/expirado dá 401 `auth.access_token_invalid`
  (§15.5.2); um token válido mas de OUTRA conta dá 403 `auth.forbidden` (§15.5.4), com o MESMO
  corpo quer a conta do URL exista quer não -- o 403 decide-se só por "o token não é desta
  conta", sem consultar a existência da conta; a RLS é a segunda camada de isolamento. Usa
  também os helpers partilhados `ProblemJson`/`ValidationProblem`
  (`Api.Problems.ProblemResults`). Um único `MapFailureToProblem(SchedulingFailureReason)` cobre
  as três rotas de escrita.

## Decisões relevantes

- Índice único parcial em vez de `EXCLUDE USING gist`: o critério de aceite pede deteção de
  "mesmo horário" (exact match), não sobreposição parcial de intervalos -- ver o comentário
  `ponytail:` em `0004_create_scheduled_sessions.sql` para o caminho de upgrade.
- `recording_active` não tem escritor nem `GRANT UPDATE` de produção neste módulo -- só
  `ScheduledSessionStore.MoveAsync`/`CancelAsync` o leem (sob o lock de linha) para rejeitar
  mover/cancelar uma sessão com gravação ativa. O endpoint de gravação que vier a existir tem
  de acrescentar o `GRANT UPDATE (recording_active)` nessa altura -- esse `UPDATE` depois fica
  na fila do mesmo lock, não é preciso inventar uma segunda tabela nem um segundo lock.
- `SchedulingFailureReason` é um único enum partilhado por Schedule/Move/Cancel (não
  `ScheduleSessionFailureReason` + `MutateSessionFailureReason` em paralelo, quase idênticos):
  `SlotTaken` só é produzido por Schedule e Move (Cancel nunca muda `starts_at`, logo nunca
  pode colidir com outra linha viva) -- não há um enum próprio por operação para essa única
  assimetria. Vive em `SchedulingService.cs`, não num ficheiro `SchedulingResult.cs` à parte: o
  limite store/service devolve `Api.Platform.Result<ScheduledSession, SchedulingFailureReason>`
  diretamente.
