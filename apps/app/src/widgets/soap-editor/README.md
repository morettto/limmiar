# widgets/soap-editor

## Responsabilidade

Compõe a Tela P4.1 (spec S08, fatia 2 de 5): fila de assinatura à esquerda
(`features/nota-fila`) + editor SOAP à direita (`features/nota-editor`), lado a lado via
`AdaptivePanel` de `@limmiar/ui` (R5 -- coluna fixa em D, gaveta/faixa recolhível em T/M).
Este widget é a única peça que sabe que "selecionar uma nota na fila" e "qual nota o
editor mostra" são a mesma decisão -- as duas features, cada uma isoladamente, não sabem
uma da outra.

## Fluxo principal

1. `FilaEEditor` recebe `itens` (a fila inteira), `notas` (mapa `id -> Nota`, chave =
   `ItemFila.id`), `onChangeNota`, `aoTocar` e `aoAssinar`.
2. Guarda em estado só `selecionadoId` (por omissão, o primeiro item de `itens`, se
   existir). `notaSelecionada = notas[selecionadoId]`.
3. `AdaptivePanel` recebe `FilaAssinatura` como filho -- em D é uma coluna fixa sempre
   visível; em T/M fica atrás de uma gaveta/faixa fechada por omissão (ver
   `packages/ui/src/AdaptivePanel.tsx`). `FilaAssinatura.onSelecionar` liga direto a
   `setSelecionadoId`.
4. Se `notaSelecionada` existir, renderiza `EditorSoap` com ela; senão, mostra
   `role="status"` ("Selecione uma nota na fila.") -- acontece hoje quando `itens` está
   vazio, e vai continuar a acontecer quando a fila real (fatia 4) chegar vazia por
   qualquer motivo.
5. `onChangeNota`/`aoTocar`/`aoAssinar` são repassados direto ao `EditorSoap` -- este
   widget não intercepta nem transforma nenhum deles; só decide *qual* nota chega até lá.

## Pontos de entrada

- `FilaEEditor` (`FilaEEditor.tsx`) -- componente React, props `itens`, `notas`,
  `onChangeNota`, `aoTocar`, `aoAssinar`.
- Consumido por `pages/notas/NotaPage.tsx` (rota `/notas`, ver
  `app/routing/router.tsx`) -- ponto de entrada de produto para este widget, fora dele
  (camada `pages`/`app`). `NotaPage` não tem README próprio: é fina de mais (monta uma
  nota fixa em memória e liga os três callbacks a estado local -- ver o comentário no topo
  do próprio ficheiro), mesmo padrão de `pages/settings/CopilotKeyPage.tsx`, que também não
  tem um.

## Decisões desta fatia

- **`selecionadoId` (qual nota o editor mostra) vive aqui, não em `FilaAssinatura` nem em
  `EditorSoap`.** Nenhuma das duas features tem motivo para saber da outra -- é
  exatamente o tipo de decisão que pertence a um widget que as compõe, não a nenhuma
  delas.
- **Ordem dos filhos no JSX (fila primeiro, editor depois) decide esquerda/direita**, não
  alguma prop de posição do `AdaptivePanel` -- o primitivo é agnóstico a que lado do
  layout ocupa; quem o usa decide isso pela ordem em que o monta.

## Fora de âmbito (fatias seguintes da spec S08)

- `notas`/`itens` reais vindos de um backend (fatia 4) -- hoje são sempre injetados pelo
  chamador. `pages/notas/NotaPage.tsx` monta com uma única nota fixa em memória só para a
  rota `/notas` existir de facto (não um componente construído e nunca ligado). O mesmo
  `NotaPage` já liga `aoTocar` ao reprodutor real de `features/nota-audio` (fatia 3) --
  falta só a fonte do áudio (`dir`/`dek`/`sessionId` reais), que é fatia 4.
- Assinatura de facto (`aoAssinar`, fatia 4) -- ver os READMEs de `features/nota-editor`
  e `features/nota-fila`.
