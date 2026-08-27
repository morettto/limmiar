# Reestruturação de arquitetura — Clean Architecture (API) + Feature-Sliced Design (app)

Data: 2026-08-10
Branch de trabalho: `refactor/arch-vertical-slice`

## Contexto

Reestruturação puramente estrutural dos dois lados do produto (`apps/api`, `apps/app`), sem mudar comportamento. Todo teste hoje verde continua verde: 407 API + 216 app, cobertura 100% nos dois, mutação ≥90% (100% no que este trabalho toca), contrato Pact intacto, gates de i18n intactos.

Substitui a decisão do ticket 01 do wayfinder (`.scratch/arquitetura-rebuild/issues/01`, "pastas por capability, um único csproj") por decisão explícita do usuário via `/goal`: backend em Clean Architecture completo, frontend no padrão mais difundido da comunidade pra este tipo de projeto.

## Backend — Clean Architecture por feature

Cada fatia (`Features/<Feature>/`) ganha as 4 camadas canônicas como pastas dentro do único `Api.csproj` — múltiplos csproj continua descartado (cruzar assembly força `public`, triplica grafo de build, sem ganho sob Native AOT).

```
Features/Accounts/
  Domain/            entidades, value objects, regra pura — zero dependência de outra camada
    Account.cs  AccountRole.cs  AccountVerificationStatus.cs  TwoFactorPolicy.cs
    TwoFactorRequirement.cs  AccountAuthorizationGuard.cs  WebAuthnCeremonyFailureReason.cs
  Application/       um handler por caso de uso, ports (interfaces) que a Infrastructure implementa
    Credentials/Register/{RegisterCommand,RegisterHandler,RegisterResult}.cs
    Credentials/Login/...
    Credentials/ContinueWithGoogle/...
    Sessions/RefreshSession/...
    TwoFactor/BeginEnrollment/  TwoFactor/ConfirmEnrollment/  TwoFactor/VerifyChallenge/
    MagicLink/Request/  MagicLink/Verify/  MagicLink/CompleteWebAuthn/
    DevicePairing/CreateSession/  DevicePairing/Claim/  DevicePairing/GetClaimStatus/
    DevicePairing/SubmitPayload/  DevicePairing/FetchPayload/
    ProfessionalVerification/SubmitCredential/  ProfessionalVerification/Decide/
    Recovery/RecoverAccess/  Recovery/RegisterPhrase/
    Ports/  IAccountStore.cs  ISessionTokenIssuer.cs  IMagicLinkIssuer.cs  ITotpProvider.cs
            IWebAuthnCeremonyVerifier.cs  IDevicePairingIssuer.cs  ICouncilRegistryVerifier.cs
            IGoogleIdentityProvider.cs  IMagicLinkEmailSender.cs  INewDeviceAlertSender.cs
            IPasswordVerifierComparer.cs  ITwoFactorTicketIssuer.cs  IStaffAccessGuard.cs
  Infrastructure/    adapters concretos das ports acima (hoje em memória; Postgres real chega em S03+)
    InMemoryAccountStore.cs  SessionTokenIssuer.cs  MagicLinkIssuer.cs  TotpProvider.cs
    WebAuthnCeremonyVerifier.cs  GoogleIdentityProvider.cs  CouncilRegistryVerifier.cs
    MagicLinkEmailSender.cs  NewDeviceAlertSender.cs  DevicePairingIssuer.cs
    TwoFactorTicketIssuer.cs  StaffAccessGuard.cs  ConstantTimePasswordVerifierComparer.cs
    Base32.cs  BackupCodeGenerator.cs  CapturingMagicLinkEmailSender.cs
  Presentation/      endpoint mapping fino — resolve o handler certo via Mediator, nunca lógica de negócio
    AuthEndpoints.cs  TwoFactorEndpoints.cs  MagicLinkEndpoints.cs  DevicePairingEndpoints.cs
    ProfessionalVerificationEndpoints.cs  RecoveryEndpoints.cs
  AccountsComposition.cs   AddAccounts(IServiceCollection) + MapAccounts(WebApplication)
  AccountsJsonContext.cs   AccountsProblemCodes.cs
```

`Features/Health/` segue como fatia leve própria (só Presentation + `HealthProblemCodes`, sem Domain/Application/Infrastructure — não tem caso de uso de negócio).

### Por que Infrastructure não é especulativo

O ticket 01 chamou Infrastructure de "vazio" exigindo I/O real. Sob Clean Architecture de verdade isso está errado: `InMemoryAccountStore`, `TotpProvider`, `WebAuthnCeremonyVerifier` e os 4 stubs (`GoogleIdentityProvider`, `CouncilRegistryVerifier`, `MagicLinkEmailSender`, `NewDeviceAlertSender`, que hoje jogam `NotSupportedException`) são todos **adapters de Infrastructure** — implementam port definida em Application, só que hoje em memória. A camada é real, não especulativa; a reclassificação resolve a objeção anterior contra abstração especulativa do AGENTS.md.

### AccountService é dissolvido, não vira `partial`

501 linhas, ctor de 13 argumentos — o débito que o ticket 04 nomeou (parâmetro opcional acumulado pra call site antigo compilar). Vira 18 handlers, um por caso de uso, cada um só com as portas que usa. Resolve o ticket 04 como efeito colateral direto, não como decisão separada.

### Dispatch: Mediator (source-generated), não MediatR

`Mediator` (martinothamar, MIT, `Mediator.Abstractions` + `Mediator.SourceGenerator`) — `IRequest<T>`/`IRequestHandler<TRequest,TResponse>` gerados em tempo de compilação, zero reflexão. Não confundir com MediatR (reflection-based, proibido pelo `WarningsAsErrors` em IL2026/IL3050 já configurado em `Directory.Build.props`). Dá pipeline de validação genuíno sem violar a restrição AOT que já derrubou MediatR na investigação do ticket 01.

### Enforcement

Mesmo mecanismo já decidido no ticket 01 (scan de texto-fonte em `Api.Tests`, ArchUnitNET continua rejeitado pelo mesmo motivo: `GeneratedRouteBuilderExtensions` do RequestDelegateGenerator referencia todo handler de todas as fatias, quebrando qualquer regra de boundary baseada em Cecil). Regras novas, direção clássica de CA:

1. `Features/<F>/Domain/` não referencia `Api.<F>.Application`, `.Infrastructure` nem `.Presentation`.
2. `Features/<F>/Application/` referencia só `Domain` (mais as próprias `Ports/`).
3. `Features/<F>/Infrastructure/` referencia `Application` (implementa as ports) e `Domain`; nunca `Presentation`.
4. `Features/<F>/Presentation/` pode referenciar tudo dentro da própria fatia; nunca outra fatia (regra herdada do ticket 01).
5. `Platform/` não referencia nenhuma fatia (regra herdada do ticket 01).

`Platform/` (`Data`, `Problems`, `Serialization`, `ExceptionHandling`) fica como está — composition root e cross-cutting entre fatias, não contradiz CA por feature.

## Frontend — Feature-Sliced Design (FSD)

Padrão mais documentado e versionado da comunidade pra este problema exato (SPA React grande precisando isolar feature e reusar design system) — metodologia própria em feature-sliced.design, não convenção de projeto único.

```
src/
  app/          providers (I18nProvider, router provider), route tree com shell + guard de sessão
                (resolve a falta de casca do router.tsx atual)
  pages/        composição por rota, fina: pages/auth, pages/magic-link-callback,
                pages/recovery, pages/device-pairing
  widgets/      blocos autocontidos: widgets/auth-screen, widgets/app-shell
  features/     um por caso de uso: features/register, /login, /continue-with-google,
                /totp-enrollment, /totp-challenge, /magic-link-auth, /recovery,
                /device-pairing-primary, /device-pairing-new, /qr-scan
  entities/     entities/account (Account, AccountRole, TwoFactorRequirement),
                entities/session (módulo que não existe hoje — ler/gravar/renovar,
                dois adapters: sessionStorage real + memória pra teste),
                entities/device
  shared/       shared/api (módulo de transporte único, substitui as 16 funções soltas
                de client.ts — candidato 2 do review de arquitetura),
                shared/ui (liga @limmiar/ui — 966 linhas hoje sem consumidor),
                shared/lib (base64 deduplicado, session-storage adapter),
                shared/i18n, shared/config
```

Regra de uma direção só (`app > pages > widgets > features > entities > shared`), enforçada por `apps/app/.dependency-cruiser.cjs` + script `lint:arch`, mesmo padrão que `packages/{crypto,i18n,ui}` já usam. Fecha o gap que o review de arquitetura achou: `apps/app` é hoje o único workspace sem regra de arquitetura declarada.

### Mapeamento do que existe hoje

| Hoje | Vira |
|---|---|
| `api/client.ts` (430 linhas, 16 funções, ~300 de esqueleto repetido) | `shared/api` — módulo de transporte único |
| `auth/AuthScreen.tsx` + `persistAccountSession` | `widgets/auth-screen` + `entities/session` |
| `auth/{TotpSetup,TotpChallenge}.tsx` | `features/totp-enrollment`, `features/totp-challenge` |
| `auth/MagicLinkCallback.tsx` | `features/magic-link-auth` + `pages/magic-link-callback` |
| `auth/RecoveryScreen.tsx`, `RecoveryPhraseSetup.tsx` | `features/recovery` |
| `auth/webauthn.ts` | `features/magic-link-auth` (só ele consome) |
| `auth/{password-verifier,recovery-verifier}.ts` | `entities/account` (baseline Argon2 unificada — corrige a duplicação achada no review) |
| `devices/PairingQr.tsx`, `PairPrimaryDevice.tsx` | `features/device-pairing-primary` |
| `devices/PairNewDevice.tsx`, `PairingScan.tsx` | `features/device-pairing-new`, `features/qr-scan` |
| `devices/base64.ts` | `shared/lib` (dedupe da cópia em `client.ts` — achado do review) |
| `errors/problem-messages.ts` + `problem-codes.ts` | `shared/api` (já corrigido nesta sessão, candidato 1 do review) |
| `locale/*`, `i18n.ts` | `shared/i18n` |
| `router.tsx` | `app/routing` — ganha shell, guard de sessão, rotas aninhadas; andaime de E2E sai da lista de rotas reais |

### Encaixe do roadmap

Roster de paciente → `widgets/patient-roster` (compõe `shared/ui` `AdaptiveTable`). Prontuário 7 abas → `pages/patient-record` + widget por aba, rotas aninhadas do `app/routing`. Agenda → `widgets/calendar` (compõe `CalendarViewport`; flag: contrato `ReactNode[]` dele precisa reabrir — achado do review, fora de escopo aqui). Gravação de sessão → `features/session-recording`. Nota SOAP → `features/soap-draft`.

## Não muda nesta reestruturação

- Comportamento observável: toda resposta HTTP, todo texto renderizado, toda regra de negócio idêntica.
- Contrato Pact (`pacts/limmiar-app-limmiar-api.json`).
- Persistência: `apps/api` continua sem I/O real fora de `Platform/Data`; trocar `InMemoryAccountStore` por Postgres é S03+, fora de escopo (já registrado como Out of scope no map do wayfinder).
- `apps/site` (Astro) e `packages/{crypto,i18n,ui}` internamente — só a conexão de `@limmiar/ui` em `apps/app` muda.

## Verificação

API: `dotnet test apps/api/Api.sln -c Release` (407 verdes, 100%/100%/100%), publish AOT sem `IL####`, gerador `generate-problem-codes.mjs` batendo antes/depois.
App: `pnpm --filter app test:unit` (216 verdes, cobertura 100% nos 4 eixos), `pnpm --filter app test:pact` (4/4, zero drift), `pnpm --filter app check:i18n-complete --strict`, mutação ≥90% (100% no que este trabalho toca).
