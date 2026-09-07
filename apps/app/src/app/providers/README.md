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
   `[nome, purga]` -- `['clearApiKey', clearApiKey]`, `['purgarIndiceBusca', purgarIndiceBusca]`,
   desde S08-20/S18-08. Desde S18-05 corre as purgas num `for-of` sequencial com `try/catch` por
   purga -- uma que falhe não trava as outras nem o logout/troca de sessão, provado pelo teste que
   faz `clearApiKey` rebentar e confirma que `purgarIndiceBusca` (a purga seguinte na lista) ainda
   apaga o índice OPFS da conta que sai. Essa garantia o `Promise.allSettled` anterior também dava
   (S18-14): o que o `for-of` traz é legibilidade do rasto por nome, ao par com o `console.error`
   nomeado abaixo, a custo de latência irrelevante num logout. Desde S18-08, o `catch` também
   deixa rasto: `console.error` com o `nome` literal da purga (não `purga.name` -- minificação
   em produção apagaria o nome) e o `accountId`, provado pelo teste que força `clearApiKey` a
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
- **`purgarIndiceBusca` (S08-20) vive em `features/nota-biblioteca/indice-store.ts`, não
  aqui.** `purgar-conta.ts` só importa e acrescenta a `PURGAS` -- FSD permite `app` importar
  `features`, e a lógica de OPFS/convenção de diretório da conta pertence ao módulo dono do
  índice de busca, não à composição de sessão.
- **Regra: quem abre a raiz OPFS tem de ter entrada em `PURGAS` (S18-12).** Um módulo de
  produção que chame `navigator.storage.getDirectory()` escreve blobs escopados a uma conta;
  sem entrada em `PURGAS`, esses blobs sobrevivem ao logout. `arch.test.ts` ("purgas de conta
  cobrem quem abre a raiz OPFS") varre `src/`, cruza cada módulo que faz essa chamada com os
  nomes citados dentro do literal `PURGAS`, e fica vermelho no que sobrar -- importar um tipo
  do mesmo módulo não conta. A outra metade da regra é `dirIndiceDaConta`
  (`features/nota-biblioteca/indice-store.ts`): escritor e purga resolvem o diretório da conta
  pela mesma função, para não poderem divergir.
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
