# entities/account

## Responsabilidade

Dono único da identidade da conta autenticada, do login/recuperação até qualquer leitor da
sessão em toda a app (spec S18, ticket S18-01). `session.ts` (`criarSessaoDeConta(storage)`,
`sessaoDaConta`) é a única fonte de verdade de "quem está logado agora" -- ninguém mais grava
ou lê `sessionStorage['limmiar:account']` diretamente. Esta slice não conhece purgas: apagar a
sessão no logout/troca de conta e disparar limpeza de outros dados (chaveiro, índice de busca
em OPFS...) é orquestração de fora, não responsabilidade de `entities` -- a regra
`fsd-no-cross-slice` (`.dependency-cruiser.cjs`) já impede `entities/account` de conhecer
`entities/nota`/`features/*` para forçar essa fronteira em compilação, não só em prosa.

## Fluxo principal

1. Um dos três ecrãs de entrada (`widgets/auth-screen/AuthScreen`, `features/recovery/RecoveryScreen`,
   `features/magic-link-auth/MagicLinkCallback`) autentica a conta e chama o próprio
   `onAuthenticated`/`onRecovered` -- eles não gravam a sessão sozinhos desde o S18-01 (antes,
   cada um chamava `recordSession` direto; ver Decisões).
2. Só `app/routing/router.tsx` liga esse callback a `iniciarSessao` de
   `app/providers/SessionProvider.tsx`, que por sua vez chama `sessaoDaConta.registar(account)`
   -- grava em `window.sessionStorage` e atualiza o estado React do provider na mesma chamada.
3. No mount do `SessionProvider` (qualquer navegação/reload da SPA), `sessaoDaConta.ler()`
   tenta restaurar a sessão gravada. Quatro ramos degradam para `null`, nunca lançam: nada
   gravado; JSON corrompido; valor parseado que não é um objeto não-nulo (array e o literal
   `"null"` incluídos); objeto sem `id` string não-vazio.
4. `terminar()` (S18-02, fora desta fatia) remove a entrada de `sessionStorage`.

## Pontos de entrada

- `criarSessaoDeConta(storage: KeyValueStorage): SessaoDeConta` (`session.ts`) -- fábrica pura,
  testável com um storage em memória. `SessaoDeConta` expõe `ler()`, `registar(account)`,
  `terminar()`.
- `sessaoDaConta: SessaoDeConta` (`session.ts`) -- a instância real, fechada sobre
  `window.sessionStorage`. Import direto do ficheiro (`entities/account/session`), não pelo
  barrel `index.ts` -- mesma disciplina de isolamento do antigo `recordSession` (S08-08).
- Consumido só por `app/providers/SessionProvider.tsx` (`useSession()` expõe `sessao`,
  `iniciarSessao`, `terminarSessao` a toda a árvore React). Nenhuma página em `src/pages/` pode
  importar `SessionProvider` diretamente -- a regra `fsd-pages-no-app` proíbe `pages` → `app`;
  quem precisa da conta recebe `accountId`/callback como prop, ligada por um route component em
  `app/routing/router.tsx`.
- `Account`, `AccountRole`, `TwoFactorRequirement` (`account.ts`); `register`, `login`,
  `continueWithGoogle`, `requestMagicLink`, `verifyMagicLink`, `recoverAccess`... (`api.ts`) --
  ver `index.ts` para a lista completa; não mudaram nesta fatia.

## Decisões desta fatia

- **Só `id` é validado em `ler()`.** É o único campo que este módulo lê de volta de uma sessão
  restaurada (o `accountId` que outras telas precisam). `role`/`twoFactorRequirement` chegam
  sempre frescos de `registar`, vindo direto do fluxo de login/recuperação -- nunca fazem o
  round-trip por `JSON.stringify`/`JSON.parse` sem um `registar` novo por trás.
- **`recordSession`/`createSessionRecorder` foram apagados, não mantidos como alias.** Zero
  chamadores depois do S18-01: os três ecrãs de entrada pararam de gravar a sessão sozinhos, e
  `criarSessaoDeConta`/`sessaoDaConta` (com `ler`/`terminar` novos) tomaram o lugar por inteiro.
- **`KeyValueStorage` ganhou `getItem`/`removeItem`, além do `setItem` que já tinha.** `ler()` e
  `terminar()` precisam deles; o storage real (`window.sessionStorage`) já implementa os três,
  só a interface injetada é que ficou maior para o teste poder dopar os quatro ramos de `ler()`.

## Fora de âmbito

- **Purga da sessão e de tudo o que depende dela no logout/troca de conta** -- `terminar()`
  existe nesta fatia, mas nenhum botão "Sair" o chama ainda; é o
  [[S18-02 Sair da conta por um ponto único de purga|S18-02]].
- **Chaveiro (KEK) real** -- `entities/account` não sabe nada de criptografia de repouso; quem
  monta o chaveiro é a spec S01, ainda não ligada a `SessionProvider`.
