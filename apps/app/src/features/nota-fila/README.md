# features/nota-fila

## Responsabilidade

Fila de assinatura da Tela P4.1 (spec S08, fatia 2 de 5): abas de estado (pendente/assinada)
sobre uma lista de notas, com uma listbox acessível e navegável só por teclado (`j`/`k`,
Enter). Sem backend: recebe os itens já prontos (`Nota[]`, com o seu campo `estado`) por
prop -- buscá-los de um servidor é a fatia 4. Sem áudio, sem edição de nota: isso é
`features/nota-editor`.

## Fluxo principal

1. `FilaAssinatura` recebe `itens` (a fila inteira, todas as abas), `selecionadoId` (qual
   nota está aberta no editor -- estado do widget-pai, não deste componente) e
   `onSelecionar(id)`.
2. Internamente guarda só duas coisas: `aba` ativa (`'pendente' | 'assinada'`, por omissão
   `'pendente'`) e `indiceAtivo` (posição do cursor do teclado dentro da lista **já
   filtrada** pela aba atual). Trocar de aba filtra de novo e reaplica `indiceInicial`
   (índice `0` se a nova aba tiver itens, `-1` se estiver vazia). `indiceAtivo` é sempre
   lido através de `indiceClampado` antes de indexar `filtrados` -- ver Decisões
   ("índice ativo sobrevive a `itens` que encolhem").
3. A listbox (`role="listbox"`, focável via `tabIndex={0}`) ouve `onKeyDown`:
   - `j`/`k` chamam `proximoIndice` (seam puro de `navegacao-teclado.ts`) e atualizam
     `indiceAtivo`. `aria-activedescendant` aponta sempre para o id do item nesse índice --
     é assim que um leitor de ecrã sabe qual item está em foco sem mover o foco real do DOM
     para fora do container da listbox (padrão ARIA "listbox de seleção única").
   - `Enter` chama `onSelecionar(itemAtivo.id)`, mas só se `indiceAtivo >= 0` (lista vazia
     não tem o que selecionar).
4. Cada opção (`role="option"`) tem `aria-selected` ligado a `selecionadoId` (a nota
   *realmente aberta no editor*), não a `indiceAtivo` (o *cursor do teclado*) -- os dois
   podem divergir: navegar com `j`/`k` move o cursor sem trocar a nota aberta até premir
   Enter ou clicar. Um clique direto na opção chama `onSelecionar` imediatamente, sem
   depender do estado do cursor.
5. Lista vazia (aba sem notas) mostra `role="status"` em vez de qualquer opção.

## Pontos de entrada

- `FilaAssinatura` (`FilaAssinatura.tsx`) -- componente React, props `itens: readonly
  Nota[]`, `selecionadoId`, `onSelecionar`.
- `EstadoNota`, `ESTADO_PENDENTE`, `ESTADO_ASSINADA` vivem em `entities/nota/nota.ts` desde
  o ticket S08-06 (fundir `ItemFila` em `Nota`) -- este módulo importa-os de lá, não os
  redeclara. Ver `entities/nota/README.md`, "Decisões da fatia S08-06".
- `proximoIndice(indice, total, tecla)`, `ehAtalhoAssinar(e)` (`navegacao-teclado.ts`) --
  seam puro, sem React, sem browser. `ehAtalhoAssinar` também é consumido por
  `features/nota-editor/EditorSoap.tsx` (import lateral entre features do mesmo nível,
  permitido pela regra do FSD deste repo -- só `app`/`pages`/`widgets` upstream são
  proibidos a `features`, ver `.dependency-cruiser.cjs`).
- Consumido por `widgets/soap-editor/FilaEEditor.tsx`, que monta esta fila lado a lado com
  `EditorSoap`.

## Decisões desta fatia

- **Índice ativo sobrevive a `itens` que encolhem "por fora" (mesma aba, sem `trocarAba`).**
  `itens` é uma prop controlada pelo widget-pai; ele pode mudar de tamanho sob a aba já
  ativa (ex.: `aoAssinar` em `NotaPage` marca a única nota pendente como assinada,
  `filtrados` encolhe de 1 para 0 na aba "pendente" sem que a aba mude). `indiceAtivo`
  guardado em estado não é reclampado sozinho nesse caso -- por isso toda leitura passa
  por `indiceClampado(indiceAtivo, filtrados.length)` (devolve `-1` para lista vazia,
  senão o índice preso a `[0, filtrados.length - 1]`) antes de indexar `filtrados`, tanto
  no corpo do componente como dentro do updater de `j`/`k`. Acesso a `filtrados[indice]`
  também passa a ser guardado (`itemAtivo`), nunca `.id` direto sobre um índice não
  verificado. Ver o teste de `rerender` com `itens` encolhendo sob a mesma aba em
  `FilaAssinatura.test.tsx`.
- **`j`/`k` param nos limites, não dão a volta.** Testado explicitamente (topo e fundo da
  lista) em `navegacao-teclado.test.ts`. Segue o ARIA Authoring Practices Guide para
  listbox de seleção única: setas (aqui, `j`/`k`) não fazem *wrap* por omissão -- descer no
  último item mantém o foco nele, em vez de saltar de volta ao primeiro de forma
  silenciosa. Upgrade, se um dia a spec pedir *wrap*: trocar só o corpo de `proximoIndice`,
  a assinatura do seam não muda.
- **`ehAtalhoAssinar` aceita `metaKey` OU `ctrlKey`, sem detetar o sistema operativo.** A
  spec S08 escreve o atalho como `⌘↵` (Mac), mas a assinatura do seam
  (`Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>`) não carrega nenhuma informação de
  plataforma de propósito: detetar o SO exigiria ler `navigator.platform`/`userAgent`
  (não fiável, e o próprio seam deixaria de ser uma função pura testável só com um objeto
  literal). Em vez disso, `Enter` com **qualquer um** dos dois modificadores conta --
  `⌘↵` funciona no Mac, `Ctrl+↵` funciona fora dele, e nenhum profissional fica sem atalho
  de teclado por causa do sistema operativo que usa. Efeito colateral aceite: `Ctrl+Enter`
  também funciona num Mac (inofensivo) e `Cmd+Enter` "funcionaria" num Windows/Linux se
  esse teclado tivesse uma tecla Meta (na prática, nunca acontece por acidente).
- **`ESTADO_PENDENTE`/`ESTADO_ASSINADA` são `const` exportadas, não literais inline.**
  Mesma justificação (`lingui/no-unlocalized-strings`, convenção `SCREAMING_SNAKE_CASE`
  isenta) de `ORDEM_SECOES` -- ver README de `entities/nota` (dono do padrão e, desde
  S08-06, dono também destas duas constantes).

## Fora de âmbito (fatias seguintes da spec S08)

- Buscar `itens` de um backend real (fila com múltiplas notas/pacientes) -- continua fora
  de âmbito; `pages/notas/NotaPage.tsx` continua a montar com uma única nota fixa em
  memória (ver o seu README). Isto é distinto de assinar de facto (linha abaixo), que já
  está feito.
- Assinatura de facto (fatia 5, feita): este módulo continua a só saber navegar/selecionar
  -- assinar é `EditorSoap`/`FilaEEditor` chamando `aoAssinar`, hoje implementado a sério
  em `pages/notas/NotaPage.tsx` (grava no prontuário, assina, marca só o item da nota
  assinada). `ESTADO_PENDENTE`/`ESTADO_ASSINADA` continuam a única coisa que este módulo
  sabe sobre esse resultado -- em qual aba um item aparece.
