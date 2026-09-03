# Api.Consent

## Responsabilidade

Consentimento por finalidade (S10-02): cada decisão (`Concedido`/`Revogado`) para cada
finalidade (`Gravacao`, `AnaliseIa`) é um evento; o estado atual de uma finalidade **não é
uma coluna** -- é sempre um fold do log de eventos, mais antigo primeiro, e o último evento
daquela finalidade vence. Sem eventos daquela finalidade, o estado é `Pendente`. É o mesmo
raciocínio append-only de `Api.Audit`: revogar é acrescentar um evento, nunca apagar ou
sobrescrever o anterior -- "a revogação não afeta ação passada" fica estrutural em vez de
uma regra que a aplicação se lembra. A fatia 3 acrescenta a superfície HTTP
(`ConsentEndpoints`/`ConsentService`, registados via `ConsentComposition.AddConsent()`/
`MapConsent()` em `Program.Composition.cs`) por cima dos mesmos tipos, do mesmo fold puro
(fatia 1) e da mesma persistência (fatia 2) -- ainda sem consumidor real, ver "Fora de
âmbito desta fatia" abaixo. Ver a secção "Desenho -- portão da forma" de
`Tickets/S10-02 Consentimento por finalidade + revogação.md` (vault) para as seis decisões
que fecharam este módulo, e `docs/adr/ADR-S10-02-consentimento-em-claro-por-finalidade.md`
para o porquê do consentimento viver em claro no servidor.

## Fluxo principal

- `ConsentEvent.cs`:
  - `enum ConsentPurpose` -- `Gravacao`, `AnaliseIa`. Fechado: cada finalidade tem um
    consumidor real e distinto (o microfone, o copiloto); uma terceira não teria leitor.
    Ordinal = o que o `CHECK (purpose BETWEEN 0 AND 1)` da migração 0007 (fatia 2) permite.
  - `enum ConsentDecision` -- `Concedido`, `Revogado`. Ordinal = o que o
    `CHECK (decision BETWEEN 0 AND 1)` da mesma migração permite.
  - `enum ConsentStatus` -- `Pendente`, `Concedido`, `Revogado`: o resultado do fold, nunca
    persistido diretamente.
  - `record ConsentEvent(TenantId, PatientId, Purpose, Decision, RecordedAt)` -- uma linha do
    log append-only `consent_events` (fatia 2). Cinco colunas de metadados, zero texto, zero
    conteúdo clínico -- `PatientId` continua um uuid nu, sem nome nem nota.
- `ConsentState.cs` -- puro, zero I/O, zero DI (molde `Api.Audit.AuditChain`):
  - `Fold(events, purpose)` -- recebe os eventos mais antigos primeiro (a ordem que
    `ConsentEventStore.ListAsync` devolve), filtra pela finalidade pedida e devolve o
    `ConsentStatus` do último evento; sem eventos daquela finalidade, `Pendente`.
- `ConsentEventStore.cs` -- store Postgres para `consent_events`, sem interface (mesma razão
  de `Api.Notes.NoteSignatureStore`: a prova de RLS precisa de um Postgres real via
  Testcontainers, não há fake válido para substituir):
  - `InsertAsync(evt, ct)` -- sempre um `INSERT`, nunca `UPDATE`; `recorded_at` não vem de
    `evt`, é o `DEFAULT now()` da coluna (molde `note_signatures.signed_at`) que devolve via
    `RETURNING`.
  - `ListAsync(tenantId, patientId, ct)` -- todos os eventos daquele par, mais antigo
    primeiro (`ORDER BY recorded_at`); sem `WHERE tenant_id`, o isolamento vem só da policy
    `tenant_isolation` (mesma convenção de `NoteSignatureStore.FindAsync`).
- `apps/api/migrations/0007_create_consent_events.sql` -- tabela `consent_events`
  (`tenant_id`, `patient_id`, `purpose`, `decision`, `recorded_at`), `PRIMARY KEY (tenant_id,
  patient_id, purpose, recorded_at)`, `CHECK (purpose BETWEEN 0 AND 1)` e
  `CHECK (decision BETWEEN 0 AND 1)` (mantêm o enum e a DDL sem divergir -- ver
  `ConsentEventsSchemaTests`), `ENABLE`+`FORCE ROW LEVEL SECURITY`, policy
  `tenant_isolation`, e `GRANT SELECT, INSERT` / `REVOKE UPDATE, DELETE` para `app_role`
  (molde `0006_create_audit_trail.sql`).
- `ConsentService.cs` (fatia 3) -- `RecordAsync(professionalId, patientId, purpose,
  decision, ct)` verifica a conta (existe, é Profissional Ativo, reusando
  `AccountAuthorizationGuard.CanCreatePatientRecords`, mesmo guard de
  `NoteService.SignAsync`) e insere o evento, com `professionalId` a dobrar de `tenant_id`
  (mesma convenção de todas as tabelas com RLS por tenant deste repositório).
  `SnapshotAsync(professionalId, patientId, ct)` lista os eventos uma vez e aplica
  `ConsentState.Fold` duas vezes, uma por finalidade -- sem verificar a conta, porque quem
  chama (`ConsentEndpoints`) já provou pelo bearer token que `professionalId` é a própria
  conta do chamador.
- `RecordConsentResult.cs` (fatia 3) -- molde `Api.Platform.Result<TValue, TFailure>` (ADR
  `docs/adr/ADR-api-store-service-boundary-result-contract.md`): `RecordConsentFailureReason`
  fechado em `AccountNotFound`/`NotAuthorizedToCreateRecords`, nunca um tuplo nulável nem `!`
  a cruzar a fronteira store/service. Este módulo ainda mantém a sua própria cópia do molde
  antigo (`required bool Succeeded` + dois nullables) em vez do tipo partilhado -- migrar
  para `Api.Platform.Result<TValue, TFailure>` é trabalho por fazer (S08-14 migrou só
  `Api.Notes`/`Api.Patients`).
- `ConsentEndpoints.cs` (fatia 3) --
  `POST /accounts/{accountId:guid}/patients/{patientId:guid}/consents` (`201`/`400`/`401`/
  `403`/`404`) e `GET` na mesma rota (`200`/`401`). Sem `DELETE` nem `PUT`: revogar é o
  mesmo `POST` com `decision: "revogado"` -- um `DELETE` sugeriria apagar, exatamente o que
  a decisão 2 do ticket proíbe. `purpose`/`decision` **no pedido** viajam como strings no
  corpo (`"gravacao"|"analiseIa"`, `"concedido"|"revogado"`), desserializadas com
  `Enum.TryParse(ignoreCase: true)` **mais** `Enum.IsDefined` -- `TryParse` sozinho aceita
  uma string numérica fora do enum (ex. `"99"`), por isso o `IsDefined` extra; `400
  validation.invalid_field` num valor desconhecido. Deliberadamente sem
  `JsonStringEnumConverter` nestes dois campos, para não deixar a desserialização automática
  do enum escapar por cima da validação e devolver um erro genérico em vez do `400` com
  `params.field` correto (decisão do desenho do ticket).
- `ConsentComposition.cs` (fatia 3) -- `AddConsent()` regista `ConsentEventStore` e
  `ConsentService` em DI, insere `ConsentJsonContext` na cadeia de resolvers JSON, e
  regista `JsonStringEnumConverter<ConsentStatus>(JsonNamingPolicy.CamelCase)` (o overload
  genérico fechado, seguro para AOT -- o mesmo já usado em `AccountRole`/
  `AccountVerificationStatus`/etc., ao contrário do conversor não genérico baseado em
  reflexão) para que `ConsentSnapshot` (só na resposta do `GET`, nunca desserializado de
  volta a partir de um pedido) via de facto como `"pendente"|"concedido"|"revogado"` no
  fio, como o comentário da assinatura do desenho do ticket documenta -- confirmado por
  `GetConsents_AfterRevokingRecording_ReportsRevogado`, que compara o corpo bruto da
  resposta. Registado a nível de `JsonSerializerOptions`, não como atributo
  `[JsonConverter]` no próprio `ConsentStatus` (que vive em `ConsentEvent.cs`, fatia 1, não
  tocado por esta fatia) -- fica inteiramente dentro dos ficheiros da fatia 3.
  `MapConsent()` chama `MapConsentEndpoints()`. Ligados em `Program.Composition.cs` junto de
  `AddNotes()`/`MapNotes()`.
- `ConsentProblemCodes.cs` (fatia 3) -- `consent.not_authorized_to_record`, devolvido no
  `403` de `RecordAsync`.

## Pontos de entrada

- `Api.Consent.ConsentState.Fold(IReadOnlyList<ConsentEvent> events, ConsentPurpose purpose)`
  -- puro, testável sem Docker.
- `Api.Consent.ConsentEventStore.InsertAsync(ConsentEvent evt, CancellationToken ct)` e
  `.ListAsync(Guid tenantId, Guid patientId, CancellationToken ct)` -- persistência real,
  precisa de Postgres (Testcontainers nos testes).
- `Api.Consent.ConsentService.RecordAsync(Guid professionalId, Guid patientId,
  ConsentPurpose purpose, ConsentDecision decision, CancellationToken ct)` e
  `.SnapshotAsync(Guid professionalId, Guid patientId, CancellationToken ct)` -- a fronteira
  de serviço, chamada por `ConsentEndpoints`.
- `POST`/`GET /accounts/{accountId:guid}/patients/{patientId:guid}/consents` -- a superfície
  HTTP real, atrás de `Authorization: Bearer` para exatamente essa conta.

## Decisões relevantes

- **Log append-only com o estado como fold, não coluna.** Revogar é `INSERT`, nunca
  `UPDATE`; ver a decisão 2 do ticket S10-02 para o porquê. O par `GRANT SELECT, INSERT` /
  `REVOKE UPDATE, DELETE` da migração 0007 torna isto estrutural, não uma regra da
  aplicação -- `app_role` (o único papel com que a API corre) não tem caminho de escrita
  nenhum para alterar ou apagar um evento já gravado.
- **Sem entrada de auditoria na concessão/revogação.** `consent_events` já é a sua própria
  trilha (append-only, imutável para `app_role`, datado); ver decisão 4 do ticket.
- **Sem retry de concorrência em `InsertAsync`** (ao contrário de `AuditEntryStore.AppendAsync`):
  não há cadeia de hash nem sequência a colidir aqui, só a PK
  `(tenant_id, patient_id, purpose, recorded_at)`. `ponytail:` `now()` é o instante de início
  da transação -- duas escritas concorrentes para o mesmo (paciente, finalidade) podem ficar
  ordenadas pelo relógio e não pela ordem de commit; não é caminho concorrente real (mesmo
  profissional, mesmo paciente, ação manual). Teto/upgrade: uma sequence por
  (tenant, patient, purpose), como `audit_entries` já faz -- ver o comentário `ponytail:`
  homónimo na migração 0007.
- **Sem `device_id`/`actor_id` em `consent_events`.** `ponytail:` nenhum critério os lê, e
  "de que dispositivo" é trabalho da trilha de auditoria, não deste log.
- **`purpose`/`decision` no pedido viajam como strings, sem `JsonStringEnumConverter`.**
  Decisão do desenho do ticket: aplicar o conversor a esses dois campos deixaria uma string
  desconhecida virar `JsonException` genérica em vez do `400 validation.invalid_field` com
  `params.field` que o handler decide. `TryParse` mais `IsDefined` fecha o buraco que
  `TryParse` sozinho deixaria (uma string numérica fora do enum, ex. `"99"`, faria
  `TryParse` ter sucesso sem `IsDefined`). Isto não é o mesmo argumento que baniria
  `JsonStringEnumConverter` de qualquer enum da fatia -- `ConsentStatus`, que só aparece na
  resposta do `GET` e nunca é desserializado de um pedido, usa exatamente esse conversor
  (overload genérico fechado, seguro para AOT) para satisfazer o wire format que o desenho
  documenta; ver `ConsentComposition.cs` acima.
- **`SnapshotAsync` não valida a conta.** Ao contrário de `RecordAsync`, o `GET` só devolve
  `200`/`401` no desenho do ticket -- a prova de que `professionalId` é a própria conta já
  veio do bearer token em `IsAuthorizedForAccount`, então uma segunda validação em
  `IAccountStore` seria redundante para essa rota.
- **`ConsentEndpoints.MapFailureToProblem`** segue o mesmo padrão de
  `NoteEndpoints.MapFailureToProblem`/`PatientEndpoints.MapCreateFailureToProblem`: cada
  ramo nomeado (`AccountNotFound` -> `404`, `NotAuthorizedToCreateRecords` -> `403`) tem
  teste HTTP dedicado, e só o fallback gerado pelo compilador para o `switch` fica
  `[ExcludeFromCodeCoverage]`.

## Fora de âmbito desta fatia

Fatia 3 de seis do ticket S10-02. A superfície HTTP e o serviço já existem, mas ainda sem
qualquer consumidor real: nem o portão do microfone em
`apps/app/src/features/live-session/microfone.ts` (fatia 4) nem a máquina de sessão
(`packages/session`, fatia 5), nem o portão do copiloto para `AnaliseIa` (fica para a S07).
Ver as "seis fatias" e a secção "Fora de âmbito" do ticket para o argumento de cada
exclusão.
