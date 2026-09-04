# app/providers

## Responsabilidade

Composição de providers de topo da SPA. `AppProviders` monta a árvore real (`I18nProvider` +
`SessionProvider`) usada por `App.tsx`; `SessionProvider` é o dono único do estado de sessão em
React (`useSession()`), sobre `entities/account/session.ts` -- ver
`entities/account/README.md` para a fonte de verdade da persistência.

## Fluxo principal

1. `AppProviders` dispara `bootLocale()` no mount e embrulha `children` em `I18nProvider` por
   fora, `SessionProvider` por dentro -- único ponto de montagem em produção
   (`App.tsx` -> `AppProviders`).
2. `SessionProvider` lê `sessaoDaConta.ler()` no mount para pré-preencher `sessao`. `iniciarSessao`
   e `terminarSessao` gravam/apagam via `sessaoDaConta` e dão trigger a `purgarConta` (lista
   `PURGAS` módulo-scoped, hoje só `clearApiKey`) sob `Promise.allSettled`, nunca bloqueando a
   troca/saída de sessão por uma purga que falhe.
3. `useSession()` lê o `SessionContext` React. Fora de um `<SessionProvider>` ancestral, lança
   (`useSession: nenhum <SessionProvider> ancestral`) em vez de devolver um default silencioso
   (S18-03) -- um erro de montagem em produção deixa de correr código sensível a sessão sem
   provider sem avisar ninguém.

## Pontos de entrada

- `AppProviders({ children })` (`AppProviders.tsx`) -- monta em `App.tsx`.
- `SessionProvider({ children })`, `useSession(): ContextoSessao` (`SessionProvider.tsx`).
  `useSession` só pode ser chamado a partir de `app/routing/router.tsx` (`fsd-pages-no-app`
  proíbe `pages` de importar `app` diretamente).

## Decisões relevantes

- **`SessionContext` é `createContext<ContextoSessao | null>(null)`, não um default no-op
  (S18-03).** O default anterior (`SEM_PROVIDER`, sessão nula e funções no-op) existia só para
  não forçar `router.test.tsx` a montar `<SessionProvider>` em ~25 sítios; esse custo de teste
  não justificava mascarar um erro de montagem real. `router.test.tsx` agora monta sempre pelo
  helper `renderRouter` (`app/routing/router.test.tsx`).
