# app/routing

## Responsabilidade

A tabela de rotas da SPA (`@tanstack/react-router`) e os route components que ligam cada rota à
página real. Desde S18-10, `useSession()` vive em `entities/account/session-context.tsx` e pode
ser chamado direto de qualquer `pages/` -- este módulo deixou de ser o único sítio autorizado.

## Fluxo principal

1. `router.tsx` declara uma rota por `createRoute`. Rotas cuja página não precisa de nada além da
   própria sessão (`/`, `/settings/copilot`) apontam `component` direto para a página --
   `HomePage`, `CopilotKeyPage` -- sem route component intermédio: as duas chamam `useSession()`
   sozinhas (S18-10, ver `entities/account/README.md` e os READMEs das duas páginas). As que
   precisam de search params ainda têm um route component próprio (`MagicLinkCallbackRouteComponent`,
   `AuthScreenE2ERouteComponent`, `RecoveryScreenE2ERouteComponent`, `NotaRouteComponent`,
   `BibliotecaRouteComponent`); nenhum destes monta JSX de produto próprio -- só liga
   `useSession()`/search params a props e repassa para uma página/componente em
   `pages/`/`features/`. `MagicLinkCallbackRouteComponent`/`RecoveryScreenE2ERouteComponent`
   montam `MagicLinkCallback`/`RecoveryScreen` (de `features/`) diretamente desde S18-06 -- os
   wrappers `pages/magic-link-callback/MagicLinkCallbackPage.tsx` e `pages/recovery/RecoveryPage.tsx`
   foram apagados por reencaminharem todas as props sem tocar em nenhuma (nada como o
   `role: string` -> `AccountRole` de `AuthPage.tsx`); não há regra `.dependency-cruiser.cjs` a
   proibir `app -> features` (só `pages -> app`), e `SessionProvider` já importava direto de
   `features/copilot-byok`.
2. `routeTree` regista as rotas E2E-only (`/auth/screen`, `/devices/pair-*`, `/auth/recover`,
   `/auth/recovery-phrase-setup`, `/e2e/microfone`) só quando `VITE_ENABLE_E2E_TEST_ROUTES ===
   'true'` -- gate de build-time, não `import.meta.env.DEV`, porque `playwright.config.ts` corre
   um `vite build` real, não `vite dev`.
3. `E2eMicrofoneScaffold.tsx` é andaime de E2E puro (sem equivalente de produção): fica fora de
   `router.tsx` para o router continuar só tabela de rotas e a sua copy ficar fora do portão de
   i18n.

## Pontos de entrada

- `router` (`router.tsx`) -- exportado e montado por `App.tsx` via `<RouterProvider>`.
- `E2eMicrofoneScaffold({ consentimento })` (`E2eMicrofoneScaffold.tsx`).

## Decisões relevantes

- **`IndexRouteComponent`/`CopilotKeyRouteComponent` foram apagados (S18-10).** Existiam só
  para converter `sessao` em props porque `useSession()` vivia em `app/providers`, atrás da
  fronteira `fsd-pages-no-app`. Descer `useSession()` para `entities/account/session-context.tsx`
  (camada que `pages` já podia importar) tornou os dois wrappers desnecessários -- `HomePage` e
  `CopilotKeyPage` chamam `useSession()` diretamente e `router.tsx` aponta `component` para elas
  sem intermediário. `BibliotecaRouteComponent` fica porque a rota ainda fixa fixtures de
  produto (`chaveIndice`, `store`) que não fazem sentido dentro da página; deixou só de chamar
  `useSession()`, já que `BibliotecaPage` passou a ler a própria sessão.
- **`BibliotecaPage` já não recebe `accountId` por prop (S18-10).** A página lê
  `useSession().sessao?.id ?? null` sozinha; nenhum `?? ''` em lado nenhum desta cadeia --
  ver `entities/account/README.md` e `pages/biblioteca/README.md`.
- **`router.test.tsx` monta toda rota por um único helper, `renderRouter(router)` (S18-03).**
  Antes, ~25 sítios repetiam manualmente `<I18nProvider>`/`<SessionProvider>` (ou nenhum dos
  dois), e `loadFreshSessionProvider()` duplicava, quase ao carácter, o comentário sobre
  `vi.resetModules()` que já existia em `SessionProvider.test.tsx`. `renderRouter` faz o import
  fresco de `SessionProvider` (mesma técnica de `loadRouterAt` para o router: `vi.resetModules()`
  dá ao router recarregado um `SessionContext` novo; um provider importado estaticamente no topo
  do ficheiro seria outra instância de Context) e embrulha sempre em ambos os providers -- um
  no-op para as rotas que não usam nenhum dos dois, e obrigatório desde que `useSession()` passou
  a lançar sem `<SessionProvider>` ancestral.
