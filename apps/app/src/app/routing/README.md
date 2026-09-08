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
3. `magicLinkCallbackRoute` passa sempre `baseUrl={API_BASE_URL}`
   (`import.meta.env.VITE_API_BASE_URL ?? ''`, constante de build) ao `MagicLinkCallback` --
   `MagicLinkCallbackSearch` só tem `token`, lido por `readSearchString`. Nenhum ramo, gate de e2e
   incluído, deixa a query string escolher o servidor (S18-17, ver Decisões).
4. `E2eMicrofoneScaffold.tsx` é andaime de E2E puro (sem equivalente de produção): fica fora de
   `router.tsx` para o router continuar só tabela de rotas e a sua copy ficar fora do portão de
   i18n.

## Pontos de entrada

- `router` (`router.tsx`) -- exportado e montado por `App.tsx` via `<RouterProvider>`.
- `E2eMicrofoneScaffold({ consentimento })` (`E2eMicrofoneScaffold.tsx`).

## Decisões relevantes

- **A fronteira de confiança do `baseUrl` apaga o ramo em vez de o acrescentar (S18-13, revisto no
  S18-17).** `/auth/magic-link` é a única rota de autenticação que fica fora do portão
  `VITE_ENABLE_E2E_TEST_ROUTES`, e é alcançada por um link que chega ao utilizador de fora. Aceitar
  `baseUrl` da query string aí punha `verifyMagicLink` e `completeWebAuthnCeremony` a falar com o
  servidor que o remetente do link escolhesse, e a entregar-lhe o resultado da cerimónia WebAuthn --
  limitado, mas não fechado, pelo facto de o `relyingPartyId` ter de bater com a origem da app. O
  S18-13 fechou esse buraco acrescentando um `baseUrlDeConfianca(search)` que só devolvia a query
  string sob o portão de e2e; o S18-17 apagou esse ramo por inteiro: `E2E_ROUTES_LIGADAS` passou a
  governar duas coisas sem relação (que rotas se registam, e de onde vem o host da API desta
  cerimónia), `VITE_API_BASE_URL` não estava definida em lado nenhum do repositório (sempre `''`),
  e `validateSearch` devolvia um `baseUrl` que nunca tinha vindo da search -- serializável de volta
  para o URL em navegações a partir desta rota. O host da API desta rota é agora constante de build
  em todos os builds, e2e incluído: `playwright.config.ts` passa `VITE_API_BASE_URL` no `env` do
  `webServer` que corre `vite build` (mesmo mecanismo que já existia para `API_BASE_URL`,
  hardcoded, do servidor .NET), e `e2e/magic-link-login.spec.ts` já não põe `baseUrl` na query
  string do link. Um `?baseUrl=` de terceiros continua provadamente ignorado, agora com o portão
  de e2e ligado e desligado (`router.test.tsx`). As outras rotas continuam a ler `baseUrl` por
  `readSearchString` porque já estão todas atrás desse portão -- mover as nove rotas para uma
  origem única em `shared/api/client.ts` é spec própria, fora deste ticket.
  **Nota de calibração que acompanha o dia em que `VITE_API_BASE_URL` ganhar um valor real:** essa
  constante passa a ser a única âncora de confiança do host da cerimónia de autenticação, e tem de
  entrar em `connect-src` de `apps/app/security-headers.ts` no mesmo diff -- esse ficheiro já deriva
  `connect-src` de `SUPPORTED_PROVIDERS` (ver `features/copilot-byok/README.md`, secção "Fora deste
  módulo, mas lê dele") e já tem o seu próprio ponytail a marcar que `'self'` só cobre a API .NET
  enquanto ela partilhar esta origem; sem esse diff em conjunto, o browser bloqueia as chamadas de
  `/auth/magic-link` para o novo host.
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
