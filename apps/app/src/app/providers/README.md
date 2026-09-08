# app/providers

## Responsabilidade

Composição de providers de topo da SPA. `AppProviders` monta a árvore real (`I18nProvider` +
`SessionProvider`) usada por `App.tsx`; `SessionProvider` é o dono único do *estado* de sessão
(`useState`/`iniciarSessao`/`terminarSessao`/purga), sobre `entities/account/session.ts` -- ver
`entities/account/README.md` para a fonte de verdade da persistência. Desde S18-10, o React
`Context` e o hook `useSession()` em si vivem em `entities/account/session-context.tsx`, não
aqui: `SessionProvider` só monta `<SessionContext.Provider>` com o valor que calcula.

## Fluxo principal

1. `AppProviders` dispara `bootLocale()` no mount e embrulha `children` em `I18nProvider` por
   fora, `SessionProvider` por dentro -- único ponto de montagem em produção
   (`App.tsx` -> `AppProviders`).
2. `SessionProvider` lê `sessaoDaConta.ler()` no mount para pré-preencher `sessao`. `iniciarSessao`
   e `terminarSessao` gravam/apagam via `sessaoDaConta` e dão trigger a `purgarConta`
   (`purgar-conta.ts`, ficheiro irmão -- extraído de dentro de `SessionProvider.tsx` para não ter
   JSX nenhum, portão `lint:i18n`), sobre a lista módulo-scoped não exportada `PURGAS`: entradas
   `[nome, purga]` -- `['clearApiKey', clearApiKey]`, `['purgarOpfsDaConta', purgarOpfsDaConta]`
   (`entities/account/opfs-conta.ts`, S18-15; antes `purgarIndiceBusca`, ver Decisões). Desde
   S18-05 corre as purgas num `for-of` sequencial com `try/catch` por purga -- uma que falhe não
   trava as outras nem o logout/troca de sessão, provado pelo teste que faz `clearApiKey`
   rebentar e confirma que `purgarOpfsDaConta` (a purga seguinte na lista) ainda apaga a árvore
   OPFS da conta que sai. Essa garantia o `Promise.allSettled` anterior também dava (S18-14): o
   que o `for-of` traz é legibilidade do rasto por nome, ao par com o `console.error` nomeado
   abaixo, a custo de latência irrelevante num logout. Desde S18-08, o `catch` também deixa
   rasto: `console.error` com o `nome` literal da purga (não `purga.name` -- minificação em
   produção apagaria o nome) e o `accountId`, provado pelo teste que força `clearApiKey` a
   rejeitar e verifica a mensagem.
3. `useSession()` (`entities/account/session-context.tsx`) lê o `SessionContext` React. Fora de
   um `<SessionProvider>` ancestral, lança (`useSession: nenhum <SessionProvider> ancestral`) em
   vez de devolver um default silencioso (S18-03) -- um erro de montagem em produção deixa de
   correr código sensível a sessão sem provider sem avisar ninguém.

## Pontos de entrada

- `AppProviders({ children })` (`AppProviders.tsx`) -- monta em `App.tsx`.
- `SessionProvider({ children })` (`SessionProvider.tsx`) -- monta `<SessionContext.Provider>`.
  `useSession(): ContextoSessao` e `SessionContext` em si vivem em
  `entities/account/session-context.tsx` (S18-10); qualquer `pages/`/`features/` pode chamar
  `useSession()` diretamente, sem passar por `app/routing`.
- `purgarConta(accountId): Promise<void>` (`purgar-conta.ts`) -- não é React (sem JSX), por isso
  vive fora de `SessionProvider.tsx`; só `SessionProvider` a chama.

## Decisões relevantes

- **`SessionContext`/`useSession()` desceram para `entities/account/session-context.tsx`, React
  puro sem imports de `features` (S18-10).** `SessionProvider.tsx` era o único dono de ambos, o
  que forçava `useSession()` a só poder ser chamado a partir de `app/routing/router.tsx`
  (`fsd-pages-no-app` proíbe `pages` de importar `app`) -- daí três route components
  (`IndexRouteComponent`, `CopilotKeyRouteComponent`, `BibliotecaRouteComponent`) que existiam só
  para injetar sessão em props. Com o contexto em `entities/account`, `pages` chama `useSession()`
  direto; `SessionProvider` continua o único dono do *estado* (não do contexto em si).
- **`SessionContext` é `createContext<ContextoSessao | null>(null)`, não um default no-op
  (S18-03).** O default anterior (`SEM_PROVIDER`, sessão nula e funções no-op) existia só para
  não forçar `router.test.tsx` a montar `<SessionProvider>` em ~25 sítios; esse custo de teste
  não justificava mascarar um erro de montagem real. `router.test.tsx` agora monta sempre pelo
  helper `renderRouter` (`app/routing/router.test.tsx`).
- **Purga recursiva da árvore OPFS da conta, não mais um apagar de blob a blob (S18-15).**
  Até ao S18-14, `PURGAS` continha `['purgarIndiceBusca', purgarIndiceBusca]`
  (`features/nota-biblioteca/indice-store.ts`), que só apagava o ficheiro `indice-busca` --
  qualquer outro blob escrito sob `<raiz OPFS>/<accountId>` (por exemplo, um chunk de
  `features/live-session/chunk-store.ts`) sobrevivia ao logout, exatamente o defeito que o
  S18-15 fecha. Agora `PURGAS` tem `['purgarOpfsDaConta', purgarOpfsDaConta]`
  (`entities/account/opfs-conta.ts`): `raiz.removeEntry(accountId, { recursive: true })`, uma
  única chamada que apaga o diretório inteiro. `dirIndiceDaConta`/`purgarIndiceBusca` foram
  apagados -- `opfsIndice`/`persistirIndice`/`restaurarIndice` sobrevivem, só deixaram de ter
  um chamador de purga próprio. **Caso que a purga recursiva piora, para nomear se algum dia
  aparecer:** se alguma coisa tiver de sobreviver ao logout, não pode estar debaixo do
  diretório da conta -- hoje nada precisa disso, mas um módulo futuro que queira persistência
  entre sessões da mesma conta tem de escolher outra raiz.
- **O guarda de arquitetura do S18-12 (`arch.test.ts`, "purgas de conta cobrem quem abre a raiz
  OPFS") foi apagado, não substituído (S18-15).** Porquê, e qual o risco residual nomeado e
  aceite: `docs/adr/ADR-S18-01-purga-recursiva-da-arvore-opfs-da-conta.md`.
- **Na troca de conta, a purga da conta anterior é disparada antes de registar a nova, mas não
  esperada (S08-20).** `iniciarSessao` continua síncrona e faz `void purgarConta(anterior)` antes
  de `sessaoDaConta.registar(account)`. Como `purgarConta` é `async`, só a primeira purga da lista
  (`clearApiKey`, síncrona) corre de facto antes do registo; `purgarOpfsDaConta` corre depois do
  primeiro `await`, portanto depois de a sessão nova estar montada. Isso é seguro porque a árvore
  de uma conta vive em `<raiz OPFS>/<accountId>` e os diretórios das duas contas são disjuntos: a
  purga de A não toca em nada que a sessão de B abra. A alternativa -- esperar pela purga --
  tornava `iniciarSessao` assíncrona, propagava a promessa para `onAuthenticated` em
  `MagicLinkCallback`, `AuthPage` e `RecoveryScreen`, e punha o login à espera de I/O de disco,
  com um OPFS bloqueado a pendurar o login. O que o teste prova, e o que interessa, é o efeito: a
  árvore de A é apagada e a de B fica intacta.
- **O que fazer a um blob que sobreviveu a uma purga falhada (S18-08): nada, nesta fatia.** Não há
  retentativa nem fila de purgas pendentes -- o rasto no `console.error` do `catch` de
  `purgarConta` é tudo o que existe hoje. Porquê: o produto é zero-knowledge (o blob que sobra é
  cifrado, não texto em claro utilizável sem a chave da sessão que acabou de terminar), a purga
  corre num cliente que já perdeu a sessão (não há onde agendar retentativa nem para onde voltar
  a autenticar sozinho), e telemetria remota está fora de âmbito -- este produto não manda nada
  para fora do cliente. Se compensar corrigir isto (ex.: uma varredura no arranque da sessão
  seguinte para reconciliar diretórios OPFS órfãos), é ticket próprio, não uma extensão desta
  fatia. Por isso o `catch` só regista: sem essa reconciliação, um "vamos tentar outra vez" seria
  promessa vazia. Porque é que o objeto de erro pode ir para o console em segurança: ver o
  comentário no `catch` de `purgarConta` (`purgar-conta.ts`).
