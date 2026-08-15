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
  verificação profissional. Armazenamento em memória (`InMemoryAccountStore`) -- ainda não
  persistido em Postgres.
- `src/Api/Patients` -- prontuário do paciente: modelo append-only cifrado sobre Postgres
  (`patient_record_entries`, migração `0002_create_patient_record_entries.sql`), RLS por
  tenant, sem UPDATE/DELETE possível (nem por grant de DB, nem por rota HTTP). É a primeira
  fatia vertical do produto de facto apoiada em Postgres (ao contrário de Accounts, que
  ainda é em memória) -- para o próximo módulo que precisar de uma tabela real com RLS por
  tenant, usar `Api/Data`'s `OpenTenantScopedTransactionAsync` (ver abaixo), não reescrever o
  `SET LOCAL app.tenant_id` à mão; `PatientService`'s mapeamento de exceção de conflito de
  unicidade para resultado de falha continua a ser o padrão a seguir para esse caso.
- `src/Api/Endpoints` -- Minimal API, um ficheiro por área (`AuthEndpoints`,
  `DevicePairingEndpoints`, `PatientEndpoints`, etc.), cada um com o seu próprio par de
  helpers `IsAuthorizedForAccount`/`ProblemJson` (duplicado deliberadamente entre ficheiros,
  ver comentário em `PatientEndpoints.cs` -- não há abstração partilhada ainda).
- `src/Api/Problems` -- `LimmiarProblemDetails` (RFC 7807 + `code` + `params` estruturado,
  nunca a mensagem de exceção crua) e o catálogo central `ProblemCodes`.
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
