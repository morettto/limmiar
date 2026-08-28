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
  garante que os dois campos viajam sempre juntos). Armazenamento em memória
  (`InMemoryAccountStore`) -- ainda não persistido em Postgres.
- `src/Api/Patients` -- prontuário do paciente: modelo append-only cifrado sobre Postgres
  (`patient_record_entries`, migração `0002_create_patient_record_entries.sql`), RLS por
  tenant, sem UPDATE/DELETE possível (nem por grant de DB, nem por rota HTTP). É a primeira
  fatia vertical do produto de facto apoiada em Postgres (ao contrário de Accounts, que
  ainda é em memória) -- para o próximo módulo que precisar de uma tabela real com RLS por
  tenant, usar `Api/Data`'s `OpenTenantScopedTransactionAsync` (ver abaixo), não reescrever o
  `SET LOCAL app.tenant_id` à mão; `PatientService`'s mapeamento de exceção de conflito de
  unicidade para resultado de falha continua a ser o padrão a seguir para esse caso.
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
- `src/Api/Endpoints` -- Minimal API, um ficheiro por área (`AuthEndpoints`,
  `DevicePairingEndpoints`, `PatientEndpoints`, `ProfessionalVerificationEndpoints`,
  `RecoveryEndpoints`, `SchedulingEndpoints`, `TwoFactorEndpoints`, `VoiceEnrollmentEndpoints`).
  Todos os oito ficheiros de endpoints partilham a única cópia de `IsAuthorizedForAccount`,
  `ProblemJson`, `ValidationProblem` e `AccessTokenUnauthorizedProblem` em `EndpointHelpers.cs`
  (`internal static class`, só usado dentro deste assembly) -- não há cópia local de nenhum
  destes em nenhum ficheiro de endpoints; cada ficheiro só mantém o helper que de facto é só
  seu (ex. `TwoFactorEndpoints.TicketInvalidProblem`,
  `ProfessionalVerificationEndpoints.StaffUnauthorizedProblem`). `TryValidateSealedBlobShape`
  (piso de 28 bytes para um blob AES-256-GCM selado) também mora em `EndpointHelpers.cs` desde
  o S06-02 -- `PatientEndpoints` e `VoiceEnrollmentEndpoints` chamam a mesma cópia, nenhum dos
  dois mantém a sua própria. `PUT /accounts/{accountId}/voice-enrollment` é idempotente
  (re-cadastro substitui, `204`, nunca `409`); `DELETE` é `404` (não `204` silencioso) quando
  não há cadastro para remover. Nenhuma das três rotas usa
  `AccountAuthorizationGuard.CanCreatePatientRecords` -- cadastro de voz é a própria conta do
  profissional, não um registo de paciente, então a única guarda é
  `IsAuthorizedForAccount` (o token pertence a esta conta).
- `src/Api/Problems` -- `LimmiarProblemDetails` (RFC 7807 + `code` + `params` estruturado,
  nunca a mensagem de exceção crua) e o catálogo central `ProblemCodes` (ex.:
  `voice.enrollment_not_found` para o `GET`/`DELETE` de cadastro de voz sem cadastro
  prévio, distinto de `auth.account_not_found`).
- `src/Api/Data` -- `MigrationRunner` (executor de `*.sql` sem framework, AOT-safe),
  `NpgsqlDataSourceFactory`, e `OpenTenantScopedTransactionAsync` (extensão de
  `NpgsqlDataSource`): abre ligação + transação e já corre o `set_config('app.tenant_id',
  ..., true)` que a política `tenant_isolation` de qualquer tabela com RLS por tenant
  precisa -- é o único sítio do repositório que emite esse `set_config`, para todo o resto
  não voltar a reescrevê-lo.

## Decisões relevantes

`patient_record_entries` é a única tabela do domínio Patients -- não existe uma tabela
`patients` separada. O `patientId` é gerado no cliente (necessário para computar a AAD antes
do POST) e a entrada de sequência 1 carrega o DEK envolvido (`wrapped_dek`); toda a
imutabilidade é reforçada em três camadas independentes: grants de DB (`REVOKE UPDATE,
DELETE`), rotas HTTP (só `MapPost`/`MapGet`, nunca `MapPut`/`MapPatch`/`MapDelete`), e a
constraint `UNIQUE(tenant_id, patient_id, sequence)` (reutilizar uma sequência é um 409 de
conflito, nunca uma sobrescrita silenciosa).
