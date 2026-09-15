# apps/api

## Responsabilidade

Backend da Limmiar: uma API .NET 10 Native AOT (`Api.sln`) sobre Postgres com Row-Level
Security (RLS) por tenant. Toda a aplicação assume zero-knowledge do lado do servidor --
qualquer campo clínico (nome, CPF, notas de sessão, etc.) chega e sai como um blob cifrado
opaco (`ciphertext`); o backend nunca vê texto plano nem detém as chaves que o decifram.

## Como correr os testes

```
dotnet test apps/api/tests/Api.Tests/Api.Tests.csproj
```

A maior parte dos testes (`*RlsTests`, `*EndpointsTests` marcados `[Collection("Database")]`)
sobe um Postgres real via Testcontainers (`Api.Tests/Infrastructure/PostgresContainerFixture`)
-- **o Docker tem de estar a correr** para esses testes passarem; sem Docker eles falham ao
tentar arrancar o container, não passam silenciosamente. Os testes puramente unitários (ex.
`PatientRecordProjectionGoldenTests`) não precisam de Docker.

## Estrutura

- `src/Api/Accounts` -- contas, autenticação (senha, Google, WebAuthn, magic link, TOTP),
  verificação profissional, cadastro de voz (`VoiceEnrollmentService`: `EnrollAsync`/
  `GetAsync`/`DeleteAsync` sobre `Account.VoiceEnrollment`, um único `VoiceEnrollment?` que
  agrupa `WrappedDek`/`SealedEmbedding` -- o compilador, não uma invariante em prosa, é quem
  garante que os dois campos viajam sempre juntos). Desde S11-03 (fatia 6), `PostgresAccountStore`
  persiste em `accounts` (migração `0010_create_accounts.sql`) com RLS por chave de procura (id,
  email ou fila de staff -- ver `Features/Accounts/README.md`); `PasswordVerifier`/
  `RecoveryVerifier` guardam `SHA256(verifier)`, nunca o verifier, e `totp_secret` viaja cifrado
  (AES-256-GCM, `TotpSecretCipher`) sob uma chave nova de configuração, `Totp:EncryptionKey`
  (base64 de 32 bytes) -- secret de deploy fail-closed, mesmo grupo de `StaffAccess:ApiKey`/
  `WebAuthn:RelyingPartyId`/`WebAuthn:ExpectedOrigin`/`AbacatePay:WebhookSecret` (ver
  `Features/Billing/README.md` para a ordem exata dos guards de arranque). `InMemoryAccountStore`
  mudou-se para `tests/Api.Tests/Fakes` (fake de `IAccountStore` só para testes que não precisam
  de provar nada sobre persistência).
  - `Features/Accounts/KeyPair` (S11-04 fatia 1; Postgres desde S11-03 fatia 6) -- o par X25519
    estático por conta (ADR-S11-06) mora em `account_key_pairs`, tabela própria (não uma coluna de
    `accounts`, para o last-write-wins de `IAccountStore.UpdateAsync` nunca a poder apagar):
    `AccountKeyPairService.PublishAsync`/`GetAsync` sobre essa tabela
    (`AccountKeyPair(PublicKey, WrappedDek, SealedPrivateKey)`, mesmo molde de envelope
    DEK/KEK que `VoiceEnrollment`). A pública é imutável: publicar de novo a MESMA `publicKey`
    substitui o envelope (204, serve rotação de KEK); uma `publicKey` DIFERENTE é `409
    key_pair.public_key_conflict` -- a primeira publicação vence, decidido pelo próprio Postgres
    (`INSERT ... ON CONFLICT ... WHERE public_key = EXCLUDED.public_key`), não por um
    `SemaphoreSlim` de instância (que só serializava um processo). `PUT`/`GET
    /accounts/{accountId}/key-pair` ficam protegidas por `RequireAccountAccessMiddleware` como
    qualquer outra rota `{accountId}` (`401`/`403` por RFC 9110), sem guarda própria.
- `src/Api/Patients` -- prontuário do paciente: modelo append-only cifrado sobre Postgres
  (`patient_record_entries`, migração `0002_create_patient_record_entries.sql`), RLS por
  tenant, sem UPDATE/DELETE possível (nem por grant de DB, nem por rota HTTP). Para o próximo
  módulo que precisar de uma tabela real com RLS por tenant, usar `Api/Data`'s
  `OpenTenantScopedTransactionAsync` (ver abaixo), não reescrever o `SET LOCAL app.tenant_id` à
  mão; `PatientService`'s mapeamento de exceção de conflito de unicidade para resultado de falha
  continua a ser o padrão a seguir para esse caso.
- `src/Api/Scheduling` -- agenda: agendar, mover e cancelar sessões (`scheduled_sessions`,
  migração `0004_create_scheduled_sessions.sql`), RLS por tenant via a mesma
  `OpenTenantScopedTransactionAsync` que Patients usa. Ao contrário de Patients, `starts_at`/
  `duration_minutes` ficam em claro no servidor -- ver
  `docs/adr/ADR-S04-02-horario-em-claro-servidor-zero-knowledge.md` e o README do módulo
  (`src/Api/Scheduling/README.md`).
- `src/Api/Features/Notes` -- assinatura de nota: uma trava por `(tenant_id, note_id)`
  (`note_signatures`, migração `0005_create_note_signatures.sql`), imposta pela própria chave
  primária, RLS por tenant via a mesma `OpenTenantScopedTransactionAsync`. Como Scheduling,
  abre uma exceção pontual ao zero-knowledge: o servidor vê a existência da nota, a revisão
  assinada, e o instante da assinatura -- ver
  `docs/adr/ADR-S08-01-assinatura-visivel-ao-servidor.md` e o README do módulo
  (`src/Api/Features/Notes/README.md`). O blob de assinatura em si continua opaco.
- Minimal API, um ficheiro por área dentro de `src/Api/Features/<Módulo>` (ex.
  `Scheduling/SchedulingEndpoints.cs`, `Notes/NoteEndpoints.cs`, `Patients/PatientEndpoints.cs`)
  ou de `src/Api/Features/Accounts/<Fatia>/Presentation` (ex.
  `DevicePairing/Presentation/DevicePairingEndpoints.cs`). Toda rota `{accountId}` nasce
  protegida por `RequireAccountAccessMiddleware`
  (`Accounts/Sessions/Presentation/RequireAccountAccessMiddleware.cs`, ver
  `Accounts.Sessions/README.md`) sem nenhuma chamada por rota -- fechado por omissão: o
  middleware decide direto do `RoutePattern` do `RouteEndpoint`, registado uma única vez em
  `Program.Composition.cs`, correndo depois do routing e antes de qualquer endpoint, logo antes
  do binding do corpo/query desse endpoint (um `IEndpointFilter` corre depois desse binding,
  tarde demais). As 4 rotas que autorizam de outra forma -- as 3 de TOTP (ticket de dois
  fatores) e `professional-verification/decision` (`X-Staff-Api-Key`) -- optam por fora com
  `.AllowWithoutAccountToken()`, com o porquê no comentário da própria rota.
  `ProblemJson`/`ValidationProblem` vivem em `Api.Problems.ProblemResults`;
  `TryValidateSealedBlobShape` (piso de 28 bytes para um blob AES-256-GCM selado) vive em
  `Api.Problems.SealedBlobShape` -- `PatientEndpoints`, `NoteEndpoints` e
  `VoiceEnrollmentEndpoints` chamam a mesma cópia, nenhum mantém a sua própria. `PUT
  /accounts/{accountId}/voice-enrollment` é idempotente (re-cadastro substitui, `204`, nunca
  `409`); `DELETE` é `404` (não `204` silencioso) quando não há cadastro para remover. Os três
  verbos distinguem o mesmo par de causas com o mesmo `code`: `auth.account_not_found` para
  conta desconhecida, `voice.enrollment_not_found` para conta real sem cadastro.
  `EnrollAsync`/`DeleteAsync` devolvem `Task<VoiceEnrollmentFailureReason?>` (`null` = sucesso);
  `GetAsync` devolve `Result<VoiceEnrollment, VoiceEnrollmentFailureReason>` (S06-04) por ser o
  caso com valor. `MapFailureToProblem` (`Presentation/VoiceEnrollmentEndpoints.cs`) é o único
  mapeador de falha, partilhado pelos três verbos -- desde o S06-07 não há segundo molde de
  falha (`VoiceEnrollmentResult` com `Succeeded`/`FailureReason?` nullable, que deixava
  `{ Succeeded = false, FailureReason = null }` construível e sem significado); o ficheiro dessa
  classe foi renomeado para `VoiceEnrollment.cs` (só ficam o `record VoiceEnrollment` e o `enum
  VoiceEnrollmentFailureReason`). Nenhuma das três rotas de voice-enrollment usa `AccountAuthorizationGuard.CanCreatePatientRecords` --
  cadastro de voz é a própria conta do profissional, não um registo de paciente, então a única
  guarda é a de conta.
- `src/Api/Features/Audit` -- trilha de auditoria encadeada por hash (`audit_entries` e
  `audit_anchors`, migração `0006_create_audit_trail.sql`): `AuditChain.ComputeHash`/`Verify`
  são puros (zero I/O, zero DI); a imposição de não-fork da cadeia é
  `UNIQUE (tenant_id, previous_hash)` no Postgres, não uma trava de aplicação. `AuditEntryStore`
  está completo (`AppendAsync` com retry, `ListAsync`, `CaptureAnchorAsync`, `ListAnchorsAsync`)
  e a âncora deteta a reescrita completa e recomputada da cadeia -- com o teto de viver na mesma
  base que as entradas. Ainda sem produtor real de evento, sem endpoint e sem registo em DI: os
  testes constroem o store diretamente. Ver
  `docs/adr/ADR-S10-01-campos-do-hash-da-trilha.md` e o README do módulo
  (`src/Api/Features/Audit/README.md`).
- `src/Api/Features/Consent` -- consentimento por finalidade (`Gravacao`, `AnaliseIa`):
  `ConsentState.Fold` é um fold puro (zero I/O, zero DI, molde `AuditChain`) sobre o log de
  eventos `ConsentEvent`, mais antigo primeiro -- último evento daquela finalidade vence, sem
  eventos é `Pendente`. `ConsentEventStore` persiste esse log em `consent_events`
  (migração `0007_create_consent_events.sql`), append-only via `GRANT SELECT, INSERT` /
  `REVOKE UPDATE, DELETE` para `app_role`. `ConsentService` (molde `Api.Notes.NoteService`)
  reusa `AccountAuthorizationGuard.CanCreatePatientRecords` para autorizar o registo;
  `ConsentEndpoints.MapConsentEndpoints` expõe
  `POST`/`GET /accounts/{accountId}/patients/{patientId}/consents` -- sem `DELETE` nem
  `PUT`, revogar é o mesmo `POST` com `decision: "revogado"`. `purpose`/`decision` no
  pedido viajam como strings (`Enum.TryParse` + `Enum.IsDefined`, sem
  `JsonStringEnumConverter` nesses dois campos, para controlar o `400
  validation.invalid_field` num valor desconhecido); `ConsentStatus`, só na resposta do
  `GET`, usa esse mesmo conversor (overload genérico fechado, seguro para AOT) para sair
  como `"pendente"|"concedido"|"revogado"`. Fatia 3 de seis do ticket S10-02: ainda sem
  consumidor real (o portão do microfone e a máquina de sessão são as fatias 4 e 5). Ver o
  README do módulo (`src/Api/Features/Consent/README.md`).
- `src/Api/Features/PatientLinks` (S11-04 fatias 2-3) -- vínculo 1:1 profissional-paciente por
  código de uso único (`PatientLinkStore`, singleton em memória, sem migração própria -- as
  contas de que depende passaram a Postgres em S11-03 fatia 6, mas vínculos/convites/envelopes
  continuam em memória até ao S11-03 fatia 7): 12 caracteres Crockford-Base32, TTL de 7 dias, uso
  único; `409 link.already_linked` por `(profissional, conta da paciente)` OU `(profissional,
  patientId)`. `PatientLinkService` cruza papel/autorização com `IAccountStore`; `LinkView`
  carrega a pública do par via `AccountKeyPairService.GetAsync` (não mais `Account.KeyPair`,
  apagado quando o par de chaves ganhou tabela própria) do OUTRO lado -- a única resposta desta
  API com a pública de outra conta, e só para quem é parte do vínculo. `DELETE
  /accounts/{accountId}/links/{peerAccountId}` desvincula por qualquer das partes, `404
  link.not_found` se não havia vínculo. Desde S11-02 (fatias 1-2), o mesmo store também guarda
  envelopes de `shared-items` e o blob opaco de `sharing-preferences` (CAS por `version`, `409
  sharing.version_conflict`) -- o servidor nunca vê o tipo do item nem o estado do
  compartilhamento. Ver o README do módulo (`src/Api/Features/PatientLinks/README.md`).
- `src/Api/Features/Billing` -- cliente AbacatePay e dedupe de webhooks (S12-01,
  `abacatepay_webhook_events`, migração `0009_...`), a única tabela sem RLS -- ver
  `docs/adr/ADR-S12-01-dedupe-de-webhook-sem-rls.md` e o README do módulo
  (`src/Api/Features/Billing/README.md`).
- `src/Api/Platform` -- (S08-14, S08-26) `Result<TValue, TFailure>`, o molde partilhado de
  resultado store/service do repositório: um valor de sucesso ou uma razão de falha (`enum`),
  nunca os dois nem nenhum (contrato completo no doc comment do próprio `Result.cs`). Usado
  por `NoteService.SignAsync`, `PatientService.CreatePatientAsync`/`AppendEntryAsync`, e desde
  o S08-21 também por `LoginHandler`/`ContinueWithGoogleHandler` (`Api.Accounts`),
  `ConsentService.RecordAsync` e `SchedulingService`/`ScheduledSessionStore`
  (`Move`/`CancelAsync`), e desde o S06-04 por `VoiceEnrollmentService.GetAsync`.
  `Api.Audit.AuditVerification` deliberadamente não migrou -- não é um
  par valor-ou-falha (`Ok()` não carrega valor nenhum), ver o README do módulo
  (`src/Api/Features/Audit/README.md`).
- `src/Api/Platform/Problems` -- `LimmiarProblemDetails` (RFC 7807 + `code` + `params`
  estruturado, nunca a mensagem de exceção crua) e o catálogo central `ProblemCodes` (ex.:
  `voice.enrollment_not_found` para o `GET`/`DELETE` de cadastro de voz sem cadastro
  prévio, distinto de `auth.account_not_found`).
- `src/Api/Platform/Data` -- `MigrationRunner` (executor de `*.sql` sem framework, AOT-safe),
  `NpgsqlDataSourceFactory` (builder AOT-safe via `NpgsqlSlimDataSourceBuilder`; `EnableArrays()`
  desde S11-03 fatia 6, para `accounts.totp_backup_code_hashes text[]` -- o slim builder não traz
  suporte a array por omissão), e `OpenTenantScopedTransactionAsync` (extensão de
  `NpgsqlDataSource`): abre ligação + transação e já corre o `set_config('app.tenant_id',
  ..., true)` que a política `tenant_isolation` de qualquer tabela com RLS por tenant
  precisa -- é o único sítio do repositório que emite esse `set_config`, para todo o resto
  não voltar a reescrevê-lo. `Program.Composition.cs` regista o `NpgsqlDataSource` singleton via
  um delegate de fábrica (`AddSingleton(_ => NpgsqlDataSourceFactory.Create(...))`), não uma
  instância já construída -- só assim o container de DI o descarta ao fim de cada
  `WebApplicationFactory` de teste; registá-lo como instância pronta (a forma antiga) fazia cada
  factory de teste vazar o seu pool de ligações até o Postgres do Testcontainers esgotar
  `max_connections`, o que só apareceu quando Accounts passou a Postgres em S11-03 e a maioria
  dos `*EndpointsTests` passou a precisar de uma app real. **Regra de imutabilidade das migrações**: enquanto
  `MigrationRunner` não tiver tabela de migrações aplicadas, ele corre todo `*.sql` de
  `migrations/` em todo o arranque -- um ficheiro de migração já publicado é imutável, porque
  uma base onde ele já correu vê qualquer edição desse ficheiro como um `CREATE TABLE IF NOT
  EXISTS` no-op e nunca a recebe. Qualquer mudança de schema depois de publicado entra num
  ficheiro novo, numerado a seguir, idempotente (guardas `IF EXISTS`, sem `IF NOT EXISTS` a
  mascarar um no-op). Caso concreto que motivou a regra, S08-29:
  `0005_create_note_signatures.sql` foi editado in-place no S08-15 para renomear `revisao`
  para `revision`; numa base onde a 0005 antiga já tinha corrido isso nunca aconteceu, e
  `NoteSignatureStore` (que fala `revision`) rebentava com `42703 undefined_column`. A 0005
  voltou à forma publicada e `0008_rename_note_signatures_revisao_to_revision.sql` faz o
  rename, com dois guardas independentes porque Postgres não tem `RENAME COLUMN/CONSTRAINT IF
  EXISTS`.

## Decisões relevantes

`patient_record_entries` é a única tabela do domínio Patients -- não existe uma tabela
`patients` separada. O `patientId` é gerado no cliente (necessário para computar a AAD antes
do POST) e a entrada de sequência 1 carrega o DEK envolvido (`wrapped_dek`); toda a
imutabilidade é reforçada em três camadas independentes: grants de DB (`REVOKE UPDATE,
DELETE`), rotas HTTP (só `MapPost`/`MapGet`, nunca `MapPut`/`MapPatch`/`MapDelete`), e a
constraint `UNIQUE(tenant_id, patient_id, sequence)` (reutilizar uma sequência é um 409 de
conflito, nunca uma sobrescrita silenciosa).
