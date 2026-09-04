# app/routing

## Responsabilidade

A tabela de rotas da SPA (`@tanstack/react-router`) e os route components que ligam cada rota à
página real, incluindo o único sítio autorizado a chamar `useSession()` fora de
`app/providers` (`fsd-pages-no-app` proíbe `pages` de importar `app`).

## Fluxo principal

1. `router.tsx` declara uma rota por `createRoute`, com um route component próprio quando a
   página precisa de search params ou de `useSession()` (`IndexRouteComponent`,
   `MagicLinkCallbackRouteComponent`, `AuthScreenE2ERouteComponent`,
   `RecoveryScreenE2ERouteComponent`, `CopilotKeyRouteComponent`, `BibliotecaRouteComponent`);
   as restantes (`PairPrimaryRouteComponent`, `PairNewRouteComponent`, ...) só repassam search
   params, sem sessão. Todos os nove, sem exceção desde S18-04, só ligam `useSession()`/search
   params a props e repassam para uma página/componente em `pages/`/`features/` -- nenhum monta
   JSX de produto próprio (`IndexRouteComponent` fazia isso até S18-04; ver `pages/home/HomePage.tsx`).
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

- **`CopilotKeyRouteComponent`/`BibliotecaRouteComponent` passam `sessao?.id ?? null`, nunca
  `?? ''` (S18-04).** A sentinela `''` era a mesma armadilha que `assertAccountId`
  (`features/copilot-byok/key-store.ts`) rejeita -- `CopilotKeyPageProps.accountId` e
  `BibliotecaPageProps.accountId` são `string | null`, e cada página trata `null` no mesmo
  ramo que tratava `''` antes (ver os dois READMEs/comentários dessas páginas).
- **`router.test.tsx` monta toda rota por um único helper, `renderRouter(router)` (S18-03).**
  Antes, ~25 sítios repetiam manualmente `<I18nProvider>`/`<SessionProvider>` (ou nenhum dos
  dois), e `loadFreshSessionProvider()` duplicava, quase ao carácter, o comentário sobre
  `vi.resetModules()` que já existia em `SessionProvider.test.tsx`. `renderRouter` faz o import
  fresco de `SessionProvider` (mesma técnica de `loadRouterAt` para o router: `vi.resetModules()`
  dá ao router recarregado um `SessionContext` novo; um provider importado estaticamente no topo
  do ficheiro seria outra instância de Context) e embrulha sempre em ambos os providers -- um
  no-op para as rotas que não usam nenhum dos dois, e obrigatório desde que `useSession()` passou
  a lançar sem `<SessionProvider>` ancestral.
