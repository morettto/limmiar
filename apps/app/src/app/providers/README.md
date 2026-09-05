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
   e `terminarSessao` gravam/apagam via `sessaoDaConta` e dão trigger a `purgarConta` (interna ao
   módulo; lista `PURGAS` módulo-scoped: `clearApiKey`, `purgarIndiceBusca` desde S08-20), que
   desde S18-05 corre as purgas num `for-of` sequencial com `try/catch` por purga -- uma que
   falhe não trava as outras nem o logout/troca de sessão, provado pelo teste que faz
   `clearApiKey` rebentar e confirma que `purgarIndiceBusca` (a purga seguinte na lista) ainda
   apaga o índice OPFS da conta que sai.
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
- **`purgarIndiceBusca` (S08-20) vive em `features/nota-biblioteca/indice-store.ts`, não
  aqui.** `SessionProvider` só importa e acrescenta a `PURGAS` -- FSD permite `app` importar
  `features`, e a lógica de OPFS/convenção de diretório da conta pertence ao módulo dono do
  índice de busca, não à composição de sessão.
- **Na troca de conta, a purga da conta anterior é disparada antes de registar a nova, mas não
  esperada (S08-20).** `iniciarSessao` continua síncrona e faz `void purgarConta(anterior)` antes
  de `sessaoDaConta.registar(account)`. Como `purgarConta` é `async`, só a primeira purga da lista
  (`clearApiKey`, síncrona) corre de facto antes do registo; `purgarIndiceBusca` corre depois do
  primeiro `await`, portanto depois de a sessão nova estar montada. Isso é seguro porque o blob do
  índice vive em `<raiz OPFS>/<accountId>/indice-busca` e os diretórios das duas contas são
  disjuntos: a purga de A não toca em nada que a sessão de B abra. A alternativa -- esperar pela
  purga -- tornava `iniciarSessao` assíncrona, propagava a promessa para `onAuthenticated` em
  `MagicLinkCallback`, `AuthPage` e `RecoveryScreen`, e punha o login à espera de I/O de disco,
  com um OPFS bloqueado a pendurar o login. O que o teste prova, e o que interessa, é o efeito: o
  blob de A é apagado e o de B fica intacto.
