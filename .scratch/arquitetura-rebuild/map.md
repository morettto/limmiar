# Map: Reestrutura de arquitetura (API + UI)

## Destination

`apps/api` migra de csproj unico e plano (Accounts/Data/Endpoints/ExceptionHandling/Problems/Serialization) para **Clean Architecture por feature**: cada fatia (Accounts, Devices, ...) com Domain/Application/Infrastructure/Presentation proprios, dispatch via `Mediator` (source-generated, AOT-safe). `apps/app/src` migra pra **Feature-Sliced Design**: `app > pages > widgets > features > entities > shared`, uma direcao so, enforcada por dependency-cruiser. Refactor puramente estrutural: todo teste hoje verde (407 API, 216 app, crypto 100%, pact 4/4, i18n, dependency-cruiser) continua verde ao final, sem mudanca de comportamento.

Decisao fixada em 2026-08-10 por override direto do usuario via `/goal` (substitui a forma "capability, nao camada" que o ticket 01 tinha fechado por investigacao propria -- ver nota "Superseded" no ticket 01). Desenho completo: `docs/superpowers/specs/2026-08-10-arquitetura-clean-arch-fsd-design.md`.

## Notes

- Skills a consultar por ticket: domain-modeling e codebase-design (desenho de modulo/interface), tdd (migracao segura sem quebrar comportamento).
- CLAUDE.md deste repo: nunca escrever comentarios em codigo.
- AGENTS.md: proibe shims de backward-compatibility -- ver ticket 04 (debito do AccountService).
- "Architecture rules (dependency-cruiser)" ja existe como check de CI e passa hoje; qualquer nova estrutura precisa manter ou atualizar essas regras.
- PR aberto: https://github.com/morettto/limmiar/pull/8 (branch feat/S02-01-tela-a1-cadastro, S02 completo).

## Decisions so far

- [Convencao vertical slice API](issues/01-convencao-vertical-slice-api.md) — decisao original (capability, nao camada) **superseded** em 2026-08-10, ver nota no proprio ticket. Continua valendo dele: `Platform/` pro transversal, fronteira por scan de fonte em `Api.Tests` (ArchUnitNET rejeitado), a armadilha de `Api.Tests.runtimeconfig.json` nao ter `IsReflectionEnabledByDefault: false` (JSON context esquecido passa no `dotnet test` e estoura no AOT).
- [Padrao macro UI](issues/02-padrao-macro-ui.md) — Feature-Sliced Design, fechado por override direto do usuario (nao pelo grilling normal do ticket). Conecta `packages/ui` (zero consumidor ate aqui) via `shared/ui`; cria `entities/session` (modulo que nao existia).

## Not yet specified

- Se `apps/site` (Astro) e `packages/{crypto,i18n,ui}` entram no escopo da reestrutura ou ficam de fora (ticket 03).
- Ordem de migracao das features futuras do roadmap (Patients, Scheduling, Sessions, Billing, Audit, Privacy...) pra dentro da forma CA-por-feature / FSD agora fixada nos dois lados.

## Out of scope

- **Introduzir persistencia real na API.** O ticket 01 revelou que a API nao tem I/O nenhum hoje fora de `Platform/Data` e do `SELECT 1` do health: todo store/issuer e `ConcurrentDictionary` e `GoogleIdentityProvider`, `CouncilRegistryVerifier`, `MagicLinkEmailSender`, `NewDeviceAlertSender` jogam `NotSupportedException`. Trocar isso por stores Npgsql muda comportamento e contraria o destino deste map ("refactor puramente estrutural, todo teste verde ao final"). E trabalho de S03 em diante, nao desta reestrutura. O layout escolhido acomoda: quando `NpgsqlAccountStore` chegar ao lado de `InMemoryAccountStore`, a camada Domain/Application/Infrastructure passa a se justificar e entra como rename de pasta sem editar fonte.
