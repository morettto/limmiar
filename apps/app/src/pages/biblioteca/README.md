# pages/biblioteca

## Responsabilidade

Monta a biblioteca de notas na rota `/biblioteca` (`app/routing/router.tsx`, spec S08,
ticket S08-02, fatia 5 de 5): é o único lugar que sabe compor os três módulos puros de
`features/nota-biblioteca` (agrupamento, índice de busca, persistência cifrada em OPFS)
com o widget de render (`widgets/biblioteca/BibliotecaNotas.tsx`), e dona da chave/ciclo de
vida do índice. O widget não decide nada disso -- só renderiza o `resultado` que esta
página já calculou.

## Fluxo principal

1. A cada render, calcula `impressao = impressaoDigital(notas)` (ticket S08-09) -- resume
   que notas (e que revisão de cada uma) as `notas` atuais cobrem. No mount (e sempre que
   `chaveIndice`/`accountId`/`impressao` mudarem), se `chaveIndice !== null` e
   `accountId !== null`:
   a. Usa a `impressao` já calculada no corpo do render (ticket S08-25).
   b. `restaurarIndice(store, chaveIndice, accountId, impressao)` -- tenta abrir um índice já
      persistido *e* que ainda cubra exatamente essas notas. Um blob de uma impressão
      diferente (nota nova/editada/apagada desde a última gravação) não é adotado: `null`,
      e o blob obsoleto já foi apagado por `restaurarIndice` (ver
      `features/nota-biblioteca/README.md`, "blob obsoleto é apagado, não só ignorado"). Se
      esse `apagar` falhar (OPFS negada/cheia), `restaurarIndice` engole a rejeição e devolve
      `null` na mesma -- esta página nunca vê esse erro; o passo seguinte (d) sobrescreve o
      mesmo ficheiro de qualquer forma.
   c. Se achou (`restaurado !== null`), usa-o direto -- **não** grava de novo.
   d. Se não achou (primeira vez, OPFS limpa, ou impressão obsoleta), constrói um novo a
      partir de `notas` (`notaParaDoc` + `construirIndice`) e persiste
      (`persistirIndice(store.gravar, ...)`, que embrulha a mesma `impressao` no envelope
      antes de selar).
   e. Guarda o resultado em estado (`indice`).
   f. Se qualquer um dos passos acima rejeitar (OPFS negada/corrompida, chave ou AAD errada
      em `abrirIndice`), a página cai num estado `erro` local e para de delegar a
      `BibliotecaNotas` -- renderiza o próprio `role="alert"` no lugar do widget, para não
      ficar presa em "Preparando a busca..." para sempre sem sinal ao utilizador. Mesmo
      padrão de `PatientWallet.tsx` (`load(kek).catch(...)`, `role="alert"`).
2. Com `chaveIndice === null` ou `accountId === null`, o efeito não faz nada -- `indice` fica `null` para sempre, e
   `buscar(null, termo)` já devolve `a-preparar` (`indice.ts`) sozinho. Não há um branch de
   render "bloqueado" próprio aqui, ao contrário de `PatientWallet` -- `BibliotecaNotas` já
   sabe renderizar `a-preparar`.
3. `termo` é estado local (`useState`), controlado pelo campo de busca via
   `onTermoChange={setTermo}` que o widget recebe.
4. Cada render passa `resultado={buscar(indice, termo)}` e
   `grupos={agruparPorPaciente(notas)}` ao widget -- os dois lados puros de
   `features/nota-biblioteca` que esta página conecta.
5. **Critério de aceite 1**: nenhum termo digitado sai por rede em canal nenhum. A busca
   (`buscar`) é inteiramente local (MiniSearch em memória); `persistirIndice`/
   `restaurarIndice` só tocam OPFS via `store` (injetado, tipicamente `opfsIndice(dir)`) --
   nada nesta página faz uma requisição de rede para buscar. O teste (`BibliotecaPage.test.tsx`,
   S08-05) espia `fetch`, `navigator.sendBeacon`, `XMLHttpRequest.prototype.open`,
   `WebSocket` e o setter `HTMLImageElement.prototype.src`, e afirma zero chamadas em
   cada um após `onTermoChange` -- prova positiva ("nenhum canal chamado"), não "o termo
   não aparece na string serializada de uma lista de chamadas que pode estar vazia".
   Confirmado por mutação: injetar `fetch(...)` no handler de `onTermoChange` faz o teste
   falhar; sem a mutação, passa.

## Pontos de entrada

- `BibliotecaPage({ notas, chaveIndice, store })` -- componente React. `accountId` não é prop
  (S18-10): a página lê `useSession().sessao?.id ?? null` sozinha (`entities/account/session-context.tsx`),
  `null` sem sessão, tratado no mesmo ramo cedo do efeito que `chaveIndice === null` já cobria
  (ver Decisões).
  `chaveIndice: ChaveIndiceBusca | null` (`features/nota-biblioteca/indice-crypto.ts`,
  ticket S08-10) só aceita o tipo marcado que `chaveIndiceDaConta(kek)` produz -- uma
  `CryptoKey` crua (ex.: uma DEK de paciente) não compila aqui, ver
  `features/nota-biblioteca/README.md`, "DEK de conta, não DEK de paciente". `notas`
  (`readonly Nota[]`, `entities/nota/nota`) é a fila de assinatura inteira -- a mesma
  coleção alimenta `agruparPorPaciente`, a construção do índice de busca **e**
  `impressaoDigital(notas)` (ticket S08-09); `store` é
  `{ ler: LerSelado; gravar: GravarSelado; apagar: ApagarSelado }` (tipicamente
  `opfsIndice(dir)`, `features/nota-biblioteca/indice-store.ts`). Até ao ticket S08-06, `itens` (`ItemFila[]`)
  e `notas` eram duas props/coleções separadas casadas à mão por `id` -- fundidas numa só
  (ver `[[S08-06 Fundir ItemFila em Nota e eliminar as listas paralelas]]`).
- Montada em `/biblioteca` via `BibliotecaRouteComponent` (`app/routing/router.tsx`), rota
  normal de produto -- não vai atrás do gate `VITE_ENABLE_E2E_TEST_ROUTES`.

## Decisões desta fatia

- **`notas`/`chaveIndice`/`store` são props, sem fixture interna; `accountId` não é prop
  (S18-10).** Ao contrário de `NotaPage` (que guarda fixtures fixas dentro do próprio
  componente), a forma acordada no portão deste ticket exige que `BibliotecaPage` receba
  `notas`/`chaveIndice`/`store` por parâmetro -- é o container "fino" que a instrução de página
  deste harness pede. As fixtures (`chaveIndice={null}`, `store` que nunca acha nada, `notas`
  vazias) vivem em `BibliotecaRouteComponent`, no router -- mesmo padrão, mesmo motivo do
  `kek={null}` de `CopilotKeyPage`, só que um nível acima (na composição da rota, não dentro da
  página). `accountId` era prop até S18-09; S18-10 tirou-a: a página lê
  `useSession().sessao?.id ?? null` sozinha (`entities/account/session-context.tsx`), o que
  apagou o `useSession()`/wrapper que `BibliotecaRouteComponent` tinha só para essa injeção.
- **`accountId` deriva de `useSession().sessao?.id ?? null`, não `string` com sentinela `''`
  (S18-04, movido de prop para leitura direta em S18-10).** O efeito que restaura/constrói o
  índice trata `accountId === null` no mesmo ramo cedo que já tratava `chaveIndice === null`
  (nenhuma das duas condições tem hoje índice para carregar) -- sem reintroduzir a sentinela
  que `assertAccountId` (`features/copilot-byok/key-store.ts`) rejeitaria noutra página.
- **`chaveIndice: ChaveIndiceBusca | null`, não `dek: CryptoKey | null` (ticket S08-10).**
  O nome/tipo antigo (`dek`) não dizia de quem era a chave -- quem ligasse a sessão real
  teria uma DEK de paciente na mão e um prop `CryptoKey` à espera, e o texto de todas as
  notas de todos os pacientes ficaria selado sob a chave de um só. `ChaveIndiceBusca` (tipo
  marcado) e o prop renomeado fecham essa ambiguidade em compilação, não só em prosa; ver
  `features/nota-biblioteca/README.md`, "DEK de conta, não DEK de paciente".
- **`chaveIndice === null` não precisa de um estado "bloqueado" dedicado.**
  `buscar(null, termo)` já devolve `a-preparar` (`features/nota-biblioteca/indice.ts`) --
  reaproveitar esse estado evita duplicar a decisão "o quê mostrar enquanto não há nada
  para buscar" que `BibliotecaNotas` já sabe tomar.
- **Guarda de cancelamento (`cancelado`) depois de `restaurarIndice` E depois de
  `persistirIndice`.** Desmontar a página no meio do `await restaurarIndice(...)` não pode
  continuar para `construirIndice`/`persistirIndice` (gravaria em OPFS por um componente
  que já não existe); desmontar no meio do `await persistirIndice(...)` não pode chamar
  `setIndice` depois (React avisaria de "update num componente desmontado"). Mesmo padrão
  de `PatientWallet.tsx` (`cancelled`/`AbortController`), sem `AbortController` aqui porque
  nem `restaurarIndice` nem `persistirIndice` aceitam um `signal` -- a flag booleana chega.
- **Sem `useMemo` em `agruparPorPaciente(itens)`/`buscar(indice, termo)`.** As duas são
  baratas (uma fila de assinatura, não uma tabela grande) e recalculam a cada render de
  qualquer forma -- sem sinal medido de que isso seja um problema real nesta fatia.
- **`preparar(chaveIndice).catch(...)` para um estado `erro` local, não um `ResultadoBusca`
  novo.** A rejeição de `restaurarIndice`/`persistirIndice` (OPFS negada/corrompida, chave
  ou AAD errada) não é "sem resultado" nem "a preparar" -- são estados de `ResultadoBusca` que
  `buscar` decide, e essa página nunca finge que `buscar` devolveu algo que ele não
  devolveu. `erro` é `useState` próprio da página, igual em espírito ao `status: 'error'`
  de `PatientWallet`, só que aqui vira um branch de render cedo (não delega mais a
  `BibliotecaNotas`) em vez de um quarto membro da união de estado -- estender
  `ResultadoBusca` obrigaria `BibliotecaNotas` (e todo teste que já cobre os três estados
  hoje) a saber renderizar erro também, ampliando um contrato já acordado no portão de
  forma sem necessidade.
- **`impressao` calculada no corpo do render, não em `useMemo`, e dependência do `useEffect`
  no lugar de `notas` (ticket S08-25, substitui a decisão do ticket S08-09 e corrige o
  ticket S08-13).** `impressaoDigital(notas)` é O(n log n), string, barata o bastante para
  recalcular a cada render (mesma razão do "sem `useMemo`" acima) -- e é a identidade real
  do que o índice cobre: duas `notas` de conteúdo diferente têm `impressao` diferente mesmo
  com a mesma identidade de array. Entra na dependency array do `useEffect`
  (`[chaveIndice, accountId, impressao]`) porque comparação por valor (string) é o que a
  reindexação precisa, não comparação por identidade de array. `store` e `mensagemErroBusca`
  não entram na array: `store` é a constante de módulo `BIBLIOTECA_STORE_FIXTURE` (no
  router) e `mensagemErroBusca` é uma string igual entre renders (não há regra
  `exhaustive-deps` neste projeto -- o oxlint só corre `react/rules-of-hooks`), lidos
  diretamente do closure do efeito. O ticket S08-13 tinha tirado `notas` das deps e lido
  `notas`/`store`/`mensagemErroBusca` via `useEffectEvent` (`lerAtuais`, React 19.2) -- a
  documentação do React 19.2 desaconselha esse uso (é para lógica tipo-evento não reativa,
  não para encolher a dependency array), e o resultado era regressão real: uma mudança em
  `notas` deixava de reindexar sozinha. `BibliotecaPage.test.tsx` prova o comportamento
  corrigido: rerender com `notas` de conteúdo diferente (mesma `chaveIndice`/`accountId`)
  faz `store.gravar` correr de novo.

## Fora de âmbito

- Sessão/Keychain real (substituir os cinco valores fixture por props reais no router) --
  mesma situação, mesmo motivo do `pages/notas/README.md`.
- Reindexar automaticamente quando uma nota é assinada/editada fora desta página (ex.: via
  `NotaPage`) -- este componente só constrói/restaura o índice no seu próprio ciclo de
  vida; sincronizar as duas telas é trabalho futuro, fora deste ticket.
- Apagar o blob no logout ou na troca de conta como evento explícito (terceiro critério de
  aceite do ticket S08-09) -- não há hoje um hook de logout/troca de conta real chamando
  esta página (ver "Sessão/Keychain real", acima); a via coberta nesta fatia é indireta,
  via `impressaoDigital`: reabrir com `notas` diferentes das que o blob cobre já dispara
  `store.apagar()` dentro de `restaurarIndice`. Um logout/troca de conta que chame
  `store.apagar()` diretamente (sem depender de `notas` terem mudado) fica para quando a
  sessão real existir.
