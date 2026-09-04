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
4. `terminar()` remove a entrada de `sessionStorage`. Desde S18-02, `SessionProvider.terminarSessao()`
   chama-o e depois dispara a purga de outros dados da conta (ver `app/providers/SessionProvider.tsx`
   e `features/copilot-byok/README.md`, ponto 5) -- esta slice continua sem saber nada dessa purga.

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

- **`ler()` valida `id`, `email`, `role` e `twoFactorRequirement` (S18-02, review de segurança).**
  Um `sessionStorage` editável no DevTools não deve conseguir forjar um `role` ou um
  `twoFactorRequirement` que o predicado `valor is Account` depois trata como garantido para
  quem ler `sessao` do contexto -- mesmo que hoje nenhum consumidor leia esses dois campos.
  `twoFactorTicket` continua sem validação própria (`string | null` aceita qualquer coisa).
- **`twoFactorTicket` nunca persiste em `sessionStorage` (S18-07).** É um segredo do fluxo 2FA
  que o servidor já invalida ao consumir (~10 min, `TwoFactorEndpoints.cs`) -- não há razão para
  o gravar. `registar()` grava a conta sem esse campo; `ler()` força-o sempre a `null` (defesa em
  profundidade, cobre também sessões gravadas antes deste fix). O tipo `Account` continua com os
  cinco campos -- mudar `ler()`/`sessao` para um tipo mais estreito propagaria por doze
  assinaturas fora deste módulo (`SessionProvider`, `TotpChallenge`, `MagicLinkCallback`,
  `RecoveryScreen`, páginas de rota...) sem ganho: quem lê `state.account.twoFactorTicket` fá-lo
  sempre a partir da resposta fresca da API (`AuthScreen.tsx`, `RecoveryScreen.tsx`), nunca de
  `useSession().sessao`.
- **`recordSession`/`createSessionRecorder` foram apagados, não mantidos como alias.** Zero
  chamadores depois do S18-01: os três ecrãs de entrada pararam de gravar a sessão sozinhos, e
  `criarSessaoDeConta`/`sessaoDaConta` (com `ler`/`terminar` novos) tomaram o lugar por inteiro.
- **`KeyValueStorage` ganhou `getItem`/`removeItem`, além do `setItem` que já tinha.** `ler()` e
  `terminar()` precisam deles; o storage real (`window.sessionStorage`) já implementa os três,
  só a interface injetada é que ficou maior para o teste poder dopar os quatro ramos de `ler()`.

## Fora de âmbito

- **Chaveiro (KEK) real** -- `entities/account` não sabe nada de criptografia de repouso; quem
  monta o chaveiro é a spec S01, ainda não ligada a `SessionProvider`.

[[S18-02 Sair da conta por um ponto único de purga|S18-02]] fechou o botão "Sair" e a purga por
conta (`app/providers/SessionProvider.tsx`, `PURGAS`/`purgarConta`) -- fora desta slice, ver
`features/copilot-byok/README.md` ponto 5 para o desenho completo.
