Type: grilling
Status: resolved

## Question

Qual a convencao exata de pastas da vertical slice em `apps/api/src/Api`? Por feature (Accounts, Devices, ...), onde ficam Domain/Application/Infrastructure -- subpastas dentro da propria feature, ou projetos csproj separados por camada dentro da feature? Onde fica o que hoje e transversal (`Data/`, `ExceptionHandling/`, `Problems/`, `Serialization/`) -- vira "shared kernel" de uma feature especial, ou fica fora das slices?

## Answer

### 1. Um unico `Api.csproj`, top-level por feature

```
apps/api/src/Api/
  Api.csproj  Api.http  Program.cs  Program.Composition.cs
  Platform/
  Features/
    Accounts/
    Health/
```

Nem csproj por camada por feature, nem csproj por feature-modulo, nem Clean Architecture global de 4 projetos.

O que discrimina, sob os constraints deste repo e nao em geral:

- Contagem de csproj tem impacto runtime **zero**: ILC compila o programa inteiro num binario nativo unico, fronteira de assembly deixa de existir. Performance aqui e decidida por nao adicionar mediator/reflexao/EF -- ja verdade hoje.
- `Directory.Build.props` poe IL2026 e IL3050 em `WarningsAsErrors`, entao assembly scanning e auto-discovery de endpoint sao **erro de build**. O host tem que nomear cada feature explicitamente de qualquer jeito, logo `ProjectReference` so expressaria "quem pode dar `using` em quem" -- que o scan de fonte (item 4) expressa com granularidade maior.
- csproj por camada e autodestrutivo: cruzar fronteira de assembly obriga o tipo a ser `public`, entao um projeto `Accounts.Domain` torna todo tipo de dominio visivel pra aplicacao inteira. **Reduz** encapsulamento e triplica o grafo de build.
- Clean Architecture global contradiz o objetivo principal: espalha cada feature em 4 projetos, e um grafo de 4 nos nao consegue dizer nada sobre feature A versus feature B. O payoff classico (Infrastructure trocavel atras de Application invertida) nao existe aqui: sem EF Core, sem container com scanning, e as 13 portas de `Api/Accounts` ja estao invertidas dentro da pasta da feature sem fronteira de projeto nenhuma.
- Custos por projeto verificados no repo: linha `COPY` no `Dockerfile` cuja omissao falha so no `deploy-api.yml` depois do merge; escopar o ItemGroup de `migrations` em `Directory.Build.props`; `IsAotCompatible=true` em cada lib ou os analisadores IL silenciam no build; entradas no `Api.sln`.
- Um unico projeto de teste e forcado pelo gate de cobertura: coverlet mede o threshold por invocacao de `dotnet test`, dois projetos de teste instrumentariam `Api.dll` cada um vendo cobertura parcial, e os dois falhariam em `Threshold 100`.

Namespace `Api.<Feature>` desde ja. Promover pra modulo-csproj depois = mover diretorio, criar csproj com `RootNamespace` igual, entrada no sln, referencia do host. **Zero mudanca de namespace ou `using`.** Por isso um projeto so nao e stopgap: e a menor versao da mesma forma.

### 2. Subpastas por capability, nao por camada

Camada Domain/Application/Infrastructure dentro da feature foi **rejeitada por censo**, nao por gosto. Os 68 arquivos de `Api/Accounts` mapeiam em Domain 8, Application 46, **Infrastructure 0**.

Infrastructure vazio e fato verificavel: `InMemoryAccountStore`, `SessionTokenIssuer`, `MagicLinkIssuer`, `DevicePairingIssuer`, `TwoFactorTicketIssuer` sao todos `ConcurrentDictionary`; `TotpProvider` e `StaffAccessGuard` sao cripto in-process; `WebAuthnCeremonyVerifier` embrulha lib in-process; e `GoogleIdentityProvider`, `CouncilRegistryVerifier`, `MagicLinkEmailSender`, `NewDeviceAlertSender` **jogam `NotSupportedException`**. O unico I/O da API e `Platform/Data` mais o `SELECT 1` do health.

Uma pasta vazia mais duas desbalanceadas descreve um futuro pretendido, nao o codigo -- a "speculative abstraction and indirection" que AGENTS.md proibe. E e taxonomia que agente erra de propósito (`*Result` e domain ou application? `Base32` e domain ou infrastructure?).

Substituto: subpasta por capability, que ja existe de fato e alinha 1:1 com os 5 grupos de endpoint atuais.

```
Features/Accounts/
  AccountsComposition.cs      AddAccounts + MapAccounts
  AccountsJsonContext.cs      todo DTO de Accounts
  AccountsProblemCodes.cs     os codigos auth.* / staff.*
  Account.cs  AccountRole.cs  AccountVerificationStatus.cs
  AccountAuthorizationGuard.cs  IAccountStore.cs  InMemoryAccountStore.cs
  AccountService.cs           nucleo compartilhado (campos, ctor, NormalizeEmail, ...)
  Credentials/  Sessions/  TwoFactor/  MagicLink/  WebAuthn/
  DevicePairing/  ProfessionalVerification/  Recovery/
```

**Subpasta nao carrega namespace**: todo arquivo declara `namespace Api.Accounts`. Refilar arquivo dentro da fatia fica sendo `git mv` puro, sem edicao de fonte, permanentemente. Quando `NpgsqlAccountStore` chegar ao lado de `InMemoryAccountStore`, introduzir a camada e rename de pasta -- custo de adiar = zero.

`AccountService` (501 linhas) vira 7 arquivos `partial`, um por capability. `partial` e identico em comportamento e nao exige mudanca nenhuma em registro de DI, assinatura de endpoint, nem nos construtores de 13 argumentos que `AccountServiceTests` usa -- decompor em 5 servicos exigiria editar teste e quebraria a condicao "407 verdes".

Ganho pro agente de IA: quem trabalha em TOTP carrega `Features/Accounts/TwoFactor/` (13 arquivos) e recebe rotas, DTOs, portas, adapters e as ~95 linhas relevantes do orquestrador -- nao 440 linhas irrelevantes.

### 3. Transversal: `Platform/`, com regra de admissao

Nada vira "feature especial". Destino sai da **direcao da dependencia**, nao de "e transversal". Regra de admissao em `Platform/`: **duas ou mais features dependem dele, e ele nao depende de feature nenhuma.** A segunda metade e enforcada por maquina (item 4).

```
Platform/Data/NpgsqlDataSourceFactory.cs
Platform/Data/MigrationRunner.cs
Platform/Problems/LimmiarProblemDetails.cs
Platform/Problems/ProblemCodes.cs          so unexpected_error + validation.invalid_field
Platform/Problems/ProblemResults.cs        o helper ProblemJson/ValidationProblem unico
Platform/Serialization/PlatformJsonContext.cs   so LimmiarProblemDetails + Dictionary<string,string>
Platform/ExceptionHandling/GlobalProblemExceptionHandler.cs
```

Nome `Platform`, deliberadamente nao `Infrastructure` (convida a arquivar repositorio de feature ali) nem `Shared`/`Common` (convida qualquer coisa).

- `Data/` depende so de Npgsql; e consumido por `Program.cs`, pela composicao, pela `PostgresContainerFixture` e -- da proxima sprint em diante -- por todo repositorio de feature que pega `NpgsqlDataSource` do DI. `MigrationRunner` tem zero conhecimento de feature (glob de `*.sql` + uma substituicao).
- `LimmiarProblemDetails` e folha sem dependencia, consumida por toda feature, e e contrato de wire congelado por Pact.
- `PlatformJsonContext` corrige a **unica inversao real do codebase**: hoje `Api/Serialization/ApiJsonSerializerContext.cs` faz `using Api.Accounts` e `using Api.Endpoints`, ou seja, arquivo transversal depende de feature. Cada feature passa a ter seu proprio `JsonSerializerContext`, anexado ao `TypeInfoResolverChain` pela propria composicao. A inversao desaparece estruturalmente.
- `ExceptionHandling/` depende de Problems + Serialization e de nenhuma feature; nada depende dele exceto `AddExceptionHandler<T>`.

Dissolvido nas fatias: codigos `auth.*`/`staff.*` vao pra `AccountsProblemCodes`, `health.database_unreachable` pra `HealthProblemCodes`. **Valores de string congelados** -- eles vivem tambem em `pacts/limmiar-app-limmiar-api.json`, `apps/app/src/errors/problem-messages.ts` e nos 4 catalogos `.po`; mover o `const` entre classes C# nao toca a string. Nomes de classe **tem** que diferir do compartilhado: 5 dos 6 arquivos de endpoint usam codigo compartilhado e codigo de feature no mesmo arquivo, entao dois `ProblemCodes` homonimos dao CS0104 em toda referencia.

`Features/Health/` e fatia propria (endpoint + `HealthProblemCodes`), nao Platform: mapeia rota e tem contrato de wire congelado (interacao Pact de `/health/db`, health check do `fly.toml`). Mantem a regra "toda rota mapeada vive em `Features/<X>/`" sem excecao. Health usa o `PlatformJsonContext` -- um contexto proprio seria **vazio**, `MapHealthEndpoints` nao declara DTO nenhum.

Migrations ficam globais e planas em `apps/api/migrations/`, nomeadas `NNNN_<feature>_<o-que>.sql`: ordem ordinal de nome no banco inteiro e o contrato que `MigrationRunner` implementa, ha um schema Postgres unico, e FK cross-feature e politica RLS precisam de ordem total. Este e o limite honesto do desacoplamento aqui.

### 4. Fronteira enforcada por scan de fonte em `Api.Tests`

`tests/Api.Tests/Architecture/ModuleBoundaryTests.cs`, rodando no gate `dotnet test apps/api/Api.sln -c Release` que ja existe. Espelha o que o monorepo ja faz no lado TS (dependency-cruiser no job `arch`) e estende `Contracts/AuthRequestContractsTests.cs`, que ja enforca regra estrutural por reflexao a partir de um teste.

Regras:

1. Nenhum arquivo em `Features/<A>/` contem o texto `Api.<B>` de outra feature, salvo allow-list explicita. **Allow-list vazia hoje** e isso e a verdade atual, nao aspiracao: Health toca so `Api.Problems`/`Api.Serialization`; Accounts toca esses mais `Fido2NetLib`.
2. Nenhum arquivo em `Platform/` contem `Api.<Feature>`. Impede a inversao do `ApiJsonSerializerContext` de voltar.
3. Todo arquivo em `Features/<A>/` declara exatamente `namespace Api.<A>` -- impede evadir a regra 1 declarando `namespace Api.Accounts` dentro de `Features/Scheduling/`.
4. Nenhum `global using` de namespace `Api.*`.
5. Nada fora de `Program*.cs` referencia `Program`, que vive no namespace global.

Scan de texto e **completo, nao heuristico**: C# nao torna namespace irmao visivel implicitamente. De `Api.Scheduling`, alcancar `Api.Accounts.AccountService` exige `using`, alias ou nome qualificado -- os tres contem o literal `Api.Accounts`. Com as regras 3 e 4, nao ha rota de escape.

**ArchUnitNET foi rejeitado.** Mono.Cecil ve `Microsoft.AspNetCore.Http.Generated.GeneratedRouteBuilderExtensions` (RequestDelegateGenerator), as metades geradas do JsonSerializerContext, `<Main>$` e as display classes. O glue de rota gerado referencia **todo** handler e DTO de todas as fatias a partir de um namespace unico, entao qualquer regra "nada fora da fatia X referencia X" falha imediatamente. Escapar disso exigiria excluir tipos compiler-generated a mao. Bonus de nao usar pacote: o gate SCA (`dependency-review-action`, `fail-on-severity: high`) sai da conversa -- o repo ja foi mordido uma vez ali (pin de `Microsoft.OpenApi` 2.7.6 por GHSA-v5pm-xwqc-g5wc).

Custo contra o gate de cobertura: **zero**. `coverage.cobertura.xml` tem um unico `<package name="Api">`; o assembly de teste nao e instrumentado. Essa e a assimetria economica decisiva: **codigo em `Api.Tests` custa nada contra o gate de 100%; codigo em `src/Api` custa 1:1.**

Escalonamento se um dia furar: analise de IL com Mono.Cecil no mesmo arquivo de teste, ainda de graca.

### 5. Armadilhas que o CI nao pega (achadas por red-team, verificadas)

**A que vale mais -- falha silenciosa em producao.** `apps/api/src/Api/bin/Release/net10.0/Api.runtimeconfig.json` tem `"System.Text.Json.JsonSerializer.IsReflectionEnabledByDefault": false`; em `Api.Tests.runtimeconfig.json` a chave **nao existe**. O host de teste e a app de entrada, entao o runtimeconfig dele governa o processo. Logo: um DTO ausente de todo contexto encadeado **cai no resolver de reflexao sob `dotnet test` e passa**, e joga `NotSupportedException` -> 500 no binario AOT. O gate `api-aot-publish` e analise de compilacao, nao runtime -- tambem nao pega. Passo obrigatorio: **diff mecanico do conjunto de `[JsonSerializable]` antes/depois**. Maior risco: `IReadOnlyList<ProfessionalVerificationQueueEntry>`, o unico tipo-colecao nao alcancavel como membro de outro DTO registrado.

**Branch incoberivel em composicao por feature.** Lambda criada dentro de outra lambda ganha cache por display-class (`<>9__n ?? (<>9__n = new ...)`); quando o callback externo roda exatamente uma vez, o lado de reuso nunca e tomado -> branch permanentemente descoberto -> `Threshold 100 / line,branch` falha. O mecanismo esta documentado no proprio `Program.Composition.cs:21`. Mesma armadilha: `ArgumentNullException.ThrowIfNull(services)` em qualquer `Add*`/`Map*` publico novo. Regra: registro por feature escrito sem lambda aninhada e sem guard-clause nao exercitada.

**Ordem de guard e asserida.** `MissingConfigurationTests` fixa a sequencia AppDb -> `WebAuthn:RelyingPartyId` -> `WebAuthn:ExpectedOrigin` -> `StaffAccess:ApiKey`. `AddAccounts` rodando seu guard de WebAuthn antes do guard de AppDb do Platform quebra um dos quatro. Pior e silencioso: reescrever `if (string.IsNullOrEmpty(x)) throw` como `x ?? throw` -- forma natural dentro de extension method -- derruba o guard de string vazia que `Program.Composition.cs:105` documenta como deliberado, e **nenhum teste cobre o caso vazio**, entao essa regressao entra verde.

**`.gitleaks.toml` e path-pinado** em `apps/api/src/Api/Api.http`, arquivo rastreado que contem `passwordVerifier` e `idToken` de exemplo e esta allowlistado **porque** o gitleaks dispara nele. O regex nao e prefixo: `Features/Accounts/Api.http` nao casa. `gitleaks detect` roda com `fetch-depth: 0`. Mover ou dividir o `Api.http` exige atualizar `paths` no mesmo commit, senao o gate `secrets` fica vermelho.

**CORS e host-level.** `CorsConfigurationTests` fixa CORS como default policy com `UseCors()` depois de `UseExceptionHandler`. Nao mover pra dentro de fatia.

**`MagicLink:TestCaptureEndpoint` cruza a fronteira builder/app**: lido uma vez, consumido no swap de `IMagicLinkEmailSender` e no `MapMagicLinkDebugEndpoints`. Split por feature separa os consumidores em `AddAccounts(builder)` e `MapAccounts(app)`, entao a flag tem que ser relida de `app.Configuration` -- identico em comportamento, ambos os branches cobertos. Passar por local capturado em lambda aninhada e a armadilha de branch acima.

**Plano B de `internal` esta bloqueado.** Existem dois `internal sealed class CapturingMagicLinkEmailSender` (um em `src/Api/Accounts`, um em `tests/Api.Tests/Accounts`); compila hoje **so porque** o de src e invisivel atraves da fronteira de assembly. `AuthEndpointsTests` importa os dois namespaces e usa o nome simples -> `InternalsVisibleTo` da CS0104 na hora. Se algum dia houver split em csproj usando `internal`, renomear um dos dois e pre-requisito.

### 6. Sequencia de migracao

Cada passo termina verde em `dotnet test apps/api/Api.sln -c Release` e no publish AOT. Nenhum passo toca `Api.sln`, `Directory.Build.props`, `Dockerfile`, `fly.toml` ou os workflows -- essa propriedade e o payoff principal da decisao de projeto unico.

0. Baseline: rodar os dois comandos de CI na arvore intocada; registrar contagem de teste e `line-rate="1" branch-rate="1"`.
1. Moves puros, zero edicao de fonte: criar `Platform/` e `Features/`, `git mv` de `Data`/`Problems`/`Serialization`/`ExceptionHandling` e de `Accounts`. Nenhum namespace tocado. Prova: `Api.csproj` usa glob `**/*.cs` e o Dockerfile copia `src/Api/` inteiro; `git diff --stat -M` mostra 100% rename.
2. Dissolver `Api.Endpoints`: Health pra `Features/Health/` com `namespace Api.Health`; os outros 5 pras subpastas de `Features/Accounts/` com `namespace Api.Accounts`. Prova: compilador (CS0246 no que faltar, CS0101 em colisao -- nao ha overlap hoje). Rota, `WithName` e `Produces` intocados, logo Pact e OpenAPI intocados.
3. Deduplicar o helper de problem: `Platform/Problems/ProblemResults.cs` unico, apagar as 6 copias. **Antes** do passo 4: colapsa `...Default.LimmiarProblemDetails` de 6 call sites pra 2.
4. Contextos JSON por feature. Apagar `ApiJsonSerializerContext` de vez -- AGENTS.md proibe alias de compatibilidade. Passo de maior risco real: aplicar o diff de `[JsonSerializable]` do item 5, e nao esquecer `[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]` em contexto novo.
5. Gate de fronteira (item 4), allow-list vazia. So pode entrar aqui: antes do passo 4 a regra 2 falharia no proprio `ApiJsonSerializerContext`, e abrir excecao documentada seria o stopgap que AGENTS.md rejeita. Provar indo vermelho de proposito antes de commitar.
6. Composicao por feature. Prova: os 4 casos de `MissingConfigurationTests` (ordem de guard) + gate de cobertura.
7. Split dos problem codes. Mover simbolo por cut-and-paste, **nunca redigitar literal** -- valor de string nao e checado por compilador.
8. Subpastas de capability por `git mv` + `partial` no `AccountService`. Totalmente verificado por compilador.
9. Espelhar a arvore de teste.
10. `apps/api/AGENTS.md` com o layout, a regra de admissao de `Platform` e as regras de fronteira. Documentacao, nao comentario em codigo.

Passos 1, 2, 8 e 9 sao mecanicamente reversiveis. Passo 4 e o que exige revisao.

### 7. Argumento mais forte contra, e o que muda a decisao

Assembly unico torna `internal` sem efeito, entao a fronteira inteira de um codebase de 10 features e um arquivo de teste que qualquer contribuidor -- humano ou agente -- pode editar no mesmo commit da violacao. Com csproj por feature, `AccountService` poderia ser `internal` e o compilador negaria acesso cross-feature sempre, pra todo mundo: IDE, build parcial, ferramenta que nunca roda teste. O scan so fala quando a suite roda, e alargar a allow-list e diff de uma linha num array de strings.

Gatilhos que revertem pra csproj por feature:

1. Qualquer commit alarga a allow-list sem superficie `Contracts/` e razao escrita.
2. Allow-list passa de ~3 pares -- o grafo deixou de ser estrela em torno de Accounts.
3. Violacao passa pelo scan via source generator ou `global using` gerado. Primeiro escalar pra Cecil no mesmo teste.
4. Build incremental de `dotnet test` vira gargalo em 5-6 features.
5. Mais de uma pessoa trabalhando features em paralelo -- contencao de merge em `Program.Composition.cs` passa a dominar.
6. Coverlet se comportar diferente do que o relatorio de um pacote implica numa run multi-modulo. Verificar antes de qualquer split.

Pre-requisito de qualquer split: renomear um dos dois `CapturingMagicLinkEmailSender` (item 5).

### Metodo

Decisao fechada com `/grilling` + 3 subagentes paralelos: verificacao factual de mecanica AOT (interrompida por limite de sessao apos confirmar encadeamento multi-assembly de `JsonSerializerContext`), red-team da migracao contra os 16 jobs de CI, e design independente a frio. Os dois que concluiram convergiram de forma independente em "um `Api.csproj`, top-level por feature" e divergiram da proposta inicial em dois pontos (camada -> capability; ArchUnitNET -> scan de fonte). Skills consultadas: `architecture-advisor`, `clean-architecture`, `vertical-slice` de `codewithmukesh/dotnet-claude-kit` (641 stars).

### Superseded (2026-08-10)

Override direto do usuario via `/goal`: "backend completo em clean arch". A conclusao "capability, nao camada" (Infrastructure=0 no censo) fica registrada como investigacao correta sob seu proprio escopo -- mas o usuario pediu explicitamente a forma mais canonica, e uma releitura sob lente de Clean Architecture completa reclassifica os adapters em memoria (`InMemoryAccountStore`, `TotpProvider`, os 4 stubs `NotSupportedException`) como Infrastructure legitima, nao vazia. Decisao nova: Domain/Application/Infrastructure/Presentation por feature, `AccountService` dissolvido em 18 handlers via `Mediator` (source-generated, AOT-safe). Ver `docs/superpowers/specs/2026-08-10-arquitetura-clean-arch-fsd-design.md` pro desenho completo e ticket ativo de implementacao.
