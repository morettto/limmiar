# pages/biblioteca

## Responsabilidade

Monta a biblioteca de notas na rota `/biblioteca` (`app/routing/router.tsx`, spec S08,
ticket S08-02, fatia 5 de 5): é o único lugar que sabe compor os três módulos puros de
`features/nota-biblioteca` (agrupamento, índice de busca, persistência cifrada em OPFS)
com o widget de render (`widgets/biblioteca/BibliotecaNotas.tsx`), e dona da chave/ciclo de
vida do índice. O widget não decide nada disso -- só renderiza o `resultado` que esta
página já calculou.

## Fluxo principal

1. No mount (e sempre que `chaveIndice`/`accountId` mudarem), se
   `chaveIndice !== null`:
   a. Calcula `impressao = impressaoDigital(notas)` (ticket S08-09) -- resume que notas (e
      que revisão de cada uma) as `notas` atuais cobrem.
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
2. Com `chaveIndice === null`, o efeito não faz nada -- `indice` fica `null` para sempre, e
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

- `BibliotecaPage({ notas, accountId, chaveIndice, store })` -- componente React.
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

- **`notas`/`accountId`/`chaveIndice`/`store` são todos props, sem fixture interna.**
  Ao contrário de `NotaPage` (que guarda fixtures fixas dentro do próprio componente),
  a forma acordada no portão deste ticket exige que `BibliotecaPage` receba tudo por
  parâmetro -- é o container "fino" que a instrução de página deste harness pede. As
  fixtures (`chaveIndice={null}`, `store` que nunca acha nada, `notas` vazias) vivem em
  `BibliotecaRouteComponent`, no router -- mesmo padrão, mesmo motivo do
  `kek={null}, accountId=""` de `CopilotKeyPage`, só que um nível acima (na composição da
  rota, não dentro da página).
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
- **`impressao` calculada dentro de `preparar`, não em `useMemo`/dependência própria
  (ticket S08-09).** `impressaoDigital(notas)` é O(n log n) e já roda a cada disparo do
  efeito, que já depende de `notas` -- mesma razão do "sem `useMemo`" abaixo, um valor a
  mais na dependency array do `useEffect` só duplicaria o que `notas` já expressa.
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
- **O `useEffect` que restaura/constrói/persiste o índice depende só de `chaveIndice` e
  `accountId` (ticket S08-13).** São esses os dois valores que identificam *qual* índice
  carregar -- `notas`, `store` e `t` não mudam essa identidade, só o conteúdo que o efeito lê
  quando dispara. `notas`/`store`/`t` passam a ser lidos via `useEffectEvent` (`lerAtuais`,
  React 19.2), que devolve os valores do último render sem os tornar reativos, em vez de
  entrarem na dependency array; o corpo do efeito continua igual, só a fonte dos três valores
  muda. Consequência direta: uma
  mudança em `notas` já não reindexa sozinha -- o efeito só volta a correr quando
  `chaveIndice`/`accountId` mudam. Hoje isso não custa nada porque o único chamador
  (`BibliotecaRouteComponent`) passa `notas={[]}` fixture; quem ligar notas reais tem de
  disparar a reindexação por outra via (mudar `chaveIndice`/`accountId`, ou um ticket futuro
  que trate a reindexação em condições).

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
