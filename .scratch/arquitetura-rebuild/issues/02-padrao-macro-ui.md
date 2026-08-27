Type: grilling
Status: resolved

## Question

`apps/app/src` reestrutura macro: feature-folder atual (auth, devices, errors, locale, api, test-support) e o modelo certo, ou troca para outro (Feature-Sliced Design, atomic design, custom)? Se mantiver feature-folder, qual convencao interna por feature (components/hooks/api/state)? Onde ficam `locales/` e `test-support/`, que hoje sao transversais e nao features de negocio?

## Answer

**Feature-Sliced Design (FSD)** — decisao por override direto do usuario via `/goal` (2026-08-10), nao pelo processo normal de grilling deste ticket. Registrado aqui pra fechar o ticket e manter o map coerente; ver `docs/superpowers/specs/2026-08-10-arquitetura-clean-arch-fsd-design.md` pro desenho completo.

Camadas, uma direcao so (`app > pages > widgets > features > entities > shared`), enforcada por `apps/app/.dependency-cruiser.cjs` + `lint:arch` -- mesmo padrao que `packages/{crypto,i18n,ui}` ja usam. Fecha o gap que o review de arquitetura achou: `apps/app` era o unico workspace sem regra de arquitetura declarada.

`locales/` -> `shared/i18n/` (junto com o `i18n.ts` atual). `test-support/` fica onde esta -- e glue de harness Playwright CT, ortogonal as camadas de negocio.

Mapeamento completo do que existe hoje pro que vira: ver tabela na secao "Frontend — Feature-Sliced Design" do design doc.

Efeito colateral direto: conecta `packages/ui` (966 linhas, zero consumidor ate 2026-08-10) via `shared/ui`, e cria `entities/session` (modulo que nao existia -- `persistAccountSession` era write-only dentro de `AuthScreen.tsx`).

### Metodo

Nao seguiu o fluxo normal do ticket (grilling um-a-um). Usuario definiu via `/goal` com Stop hook: "front siga o padrao de projeto mais apropriado, avancavel, organizado e escalavel conhecido e difundido na comunidade". FSD e a resposta mais documentada e versionada da comunidade pra este problema exato (SPA React grande + design system compartilhado a reconectar) -- ver feature-sliced.design. Design fechado via `/brainstorming`, doc escrito e commitado (`5c42d2a`), implementacao em andamento por subagente especializado.
