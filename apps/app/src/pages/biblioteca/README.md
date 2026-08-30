# pages/biblioteca

## Responsabilidade

Monta a biblioteca de notas na rota `/biblioteca` (`app/routing/router.tsx`, spec S08,
ticket S08-02, fatia 5 de 5): é o único lugar que sabe compor os três módulos puros de
`features/nota-biblioteca` (agrupamento, índice de busca, persistência cifrada em OPFS)
com o widget de render (`widgets/biblioteca/BibliotecaNotas.tsx`), e dono da DEK/ciclo de
vida do índice. O widget não decide nada disso -- só renderiza o `resultado` que esta
página já calculou.

## Fluxo principal

1. No mount (e sempre que `dek`/`accountId`/`store`/`notas` mudarem), se `dek !== null`:
   a. `restaurarIndice(store.ler, dek, accountId)` -- tenta abrir um índice já persistido.
   b. Se achou (`restaurado !== null`), usa-o direto -- **não** grava de novo.
   c. Se não achou (primeira vez, ou OPFS limpa), constrói um novo a partir de `notas`
      (`notaParaDoc` + `construirIndice`) e persiste (`persistirIndice`, que sela sob a
      DEK antes de gravar).
   d. Guarda o resultado em estado (`indice`).
   e. Se qualquer um dos passos acima rejeitar (OPFS negada/corrompida, DEK ou AAD errada
      em `abrirIndice`), a página cai num estado `erro` local e para de delegar a
      `BibliotecaNotas` -- renderiza o próprio `role="alert"` no lugar do widget, para não
      ficar presa em "Preparando a busca..." para sempre sem sinal ao utilizador. Mesmo
      padrão de `PatientWallet.tsx` (`load(kek).catch(...)`, `role="alert"`).
2. Com `dek === null`, o efeito não faz nada -- `indice` fica `null` para sempre, e
   `buscar(null, termo)` já devolve `a-preparar` (`indice.ts`) sozinho. Não há um branch de
   render "bloqueado" próprio aqui, ao contrário de `PatientWallet` -- `BibliotecaNotas` já
   sabe renderizar `a-preparar`.
3. `termo` é estado local (`useState`), controlado pelo campo de busca via
   `onTermoChange={setTermo}` que o widget recebe.
4. Cada render passa `resultado={buscar(indice, termo)}` e
   `grupos={agruparPorPaciente(itens)}` ao widget -- os dois lados puros de
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

- `BibliotecaPage({ itens, notas, accountId, dek, store })` -- componente React. `itens`
  é a fila de assinatura (`ItemFila[]`, `features/nota-fila`); `notas` são as notas
  completas de onde o índice é construído; `store` é `{ ler: LerSelado; gravar:
  GravarSelado }` (tipicamente `opfsIndice(dir)`, `features/nota-biblioteca/indice-store.ts`).
  **`store` (e `notas`) têm de chegar estáveis por identidade entre renders** -- os dois
  estão na dependency array do `useEffect` que chama `restaurarIndice`/`persistirIndice`;
  um chamador que passe `store={opfsIndice(dir)}` inline recria o objeto a cada render do
  pai e faz o efeito repetir a leitura/gravação em OPFS sem necessidade. O chamador atual
  (`BibliotecaRouteComponent`, `app/routing/router.tsx`) já usa uma constante de módulo
  (`BIBLIOTECA_STORE_FIXTURE`); um chamador futuro com `dir` real deve `useMemo`/definir
  `store` fora do corpo do componente pela mesma razão.
- Montada em `/biblioteca` via `BibliotecaRouteComponent` (`app/routing/router.tsx`), rota
  normal de produto -- não vai atrás do gate `VITE_ENABLE_E2E_TEST_ROUTES`.

## Decisões desta fatia

- **`itens`/`notas`/`accountId`/`dek`/`store` são todos props, sem fixture interna.**
  Ao contrário de `NotaPage` (que guarda fixtures fixas dentro do próprio componente),
  a forma acordada no portão deste ticket exige que `BibliotecaPage` receba tudo por
  parâmetro -- é o container "fino" que a instrução de página deste harness pede. As
  fixtures (`dek={null}`, `store` que nunca acha nada, `itens`/`notas` vazios) vivem em
  `BibliotecaRouteComponent`, no router -- mesmo padrão, mesmo motivo do
  `kek={null}, accountId=""` de `CopilotKeyPage`, só que um nível acima (na composição da
  rota, não dentro da página).
- **`dek === null` não precisa de um estado "bloqueado" dedicado.** `buscar(null, termo)`
  já devolve `a-preparar` (`features/nota-biblioteca/indice.ts`) -- reaproveitar esse
  estado evita duplicar a decisão "o quê mostrar enquanto não há nada para buscar" que
  `BibliotecaNotas` já sabe tomar.
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
- **`preparar(dek).catch(...)` para um estado `erro` local, não um `ResultadoBusca` novo.**
  A rejeição de `restaurarIndice`/`persistirIndice` (OPFS negada/corrompida, DEK ou AAD
  errada) não é "sem resultado" nem "a preparar" -- são estados de `ResultadoBusca` que
  `buscar` decide, e essa página nunca finge que `buscar` devolveu algo que ele não
  devolveu. `erro` é `useState` próprio da página, igual em espírito ao `status: 'error'`
  de `PatientWallet`, só que aqui vira um branch de render cedo (não delega mais a
  `BibliotecaNotas`) em vez de um quarto membro da união de estado -- estender
  `ResultadoBusca` obrigaria `BibliotecaNotas` (e todo teste que já cobre os três estados
  hoje) a saber renderizar erro também, ampliando um contrato já acordado no portão de
  forma sem necessidade.

## Fora de âmbito

- Sessão/Keychain real (substituir os cinco valores fixture por props reais no router) --
  mesma situação, mesmo motivo do `pages/notas/README.md`.
- Reindexar automaticamente quando uma nota é assinada/editada fora desta página (ex.: via
  `NotaPage`) -- este componente só constrói/restaura o índice no seu próprio ciclo de
  vida; sincronizar as duas telas é trabalho futuro, fora deste ticket.
