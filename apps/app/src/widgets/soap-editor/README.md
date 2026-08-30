# widgets/soap-editor

## Responsabilidade

Compõe a Tela P4.1 (spec S08, fatia 2 de 5): fila de assinatura à esquerda
(`features/nota-fila`) + editor SOAP à direita (`features/nota-editor`), lado a lado via
`AdaptivePanel` de `@limmiar/ui` (R5 -- coluna fixa em D, gaveta/faixa recolhível em T/M).
Este widget é a única peça que sabe que "selecionar uma nota na fila" e "qual nota o
editor mostra" são a mesma decisão -- as duas features, cada uma isoladamente, não sabem
uma da outra.

## Fluxo principal

1. `FilaEEditor` recebe `notas: readonly Nota[]` (a fila inteira, todas as abas, cada
   `Nota` já com o seu `estado`), `onChangeNota`, `aoTocar` e `aoAssinar`.
2. Guarda em estado só `selecionadoId` (por omissão, o primeiro item de `notas`, se
   existir). `notaSelecionada = notas.find((nota) => nota.id === selecionadoId)`.
3. `AdaptivePanel` recebe `FilaAssinatura` como filho -- em D é uma coluna fixa sempre
   visível; em T/M fica atrás de uma gaveta/faixa fechada por omissão (ver
   `packages/ui/src/AdaptivePanel.tsx`). `FilaAssinatura.onSelecionar` liga direto a
   `setSelecionadoId`.
4. Se `notaSelecionada` existir, renderiza `EditorSoap` com ela; senão, mostra
   `role="status"` ("Selecione uma nota na fila.") -- acontece hoje quando `itens` está
   vazio, e vai continuar a acontecer quando a fila real (buscada de um backend, ainda por
   construir) chegar vazia por qualquer motivo.
5. `onChangeNota`/`aoTocar`/`aoAssinar` são repassados direto ao `EditorSoap` -- este
   widget não intercepta nem transforma nenhum deles; só decide *qual* nota chega até lá.

## Pontos de entrada

- `FilaEEditor` (`FilaEEditor.tsx`) -- componente React, props `notas: readonly Nota[]`,
  `onChangeNota`, `aoTocar`, `aoAssinar`.
- Consumido por `pages/notas/NotaPage.tsx` (rota `/notas`, ver
  `app/routing/router.tsx`) -- ponto de entrada de produto para este widget, fora dele
  (camada `pages`/`app`). `NotaPage` ganhou README próprio na fatia 5 (`pages/notas/README.md`):
  deixou de ser fina de mais assim que `aoAssinar` passou a gravar no prontuário e assinar
  de facto, em vez de só mexer em estado local.

## Decisões desta fatia

- **`selecionadoId` (qual nota o editor mostra) vive aqui, não em `FilaAssinatura` nem em
  `EditorSoap`.** Nenhuma das duas features tem motivo para saber da outra -- é
  exatamente o tipo de decisão que pertence a um widget que as compõe, não a nenhuma
  delas.
- **Ordem dos filhos no JSX (fila primeiro, editor depois) decide esquerda/direita**, não
  alguma prop de posição do `AdaptivePanel` -- o primitivo é agnóstico a que lado do
  layout ocupa; quem o usa decide isso pela ordem em que o monta.

## Decisões desta fatia (atualizado no ticket S08-06)

- **Uma prop só, `notas: readonly Nota[]`, em vez de `itens`+`notas: Record<string, Nota>`.**
  As duas coleções paralelas (`ItemFila[]` e `Record<string, Nota>`, casadas à mão por
  `id`) eram a mesma entidade partida em duas, com `undefined` como resultado legítimo de
  um id presente numa e ausente na outra -- ver
  `[[S08-06 Fundir ItemFila em Nota e eliminar as listas paralelas]]`. `notaSelecionada`
  passou de lookup por `Record` (`notas[selecionadoId]`) para
  `notas.find((nota) => nota.id === selecionadoId)` -- mesmo resultado, uma coleção só.

## Fora de âmbito (fatias seguintes da spec S08)

- `notas` reais vindas de um backend (fila com múltiplas notas/pacientes) --
  continuam sempre injetadas pelo chamador. `pages/notas/NotaPage.tsx` continua a montar
  com uma única nota fixa em memória só para a rota `/notas` existir de facto (não um
  componente construído e nunca ligado) -- ver o README desse módulo para o que já é real
  (assinatura) e o que continua fixture (a própria fila/nota, a sessão/Keychain).
- Fonte real do áudio (`dir`/`dek`/`sessionId` vindos de um backend) -- `aoTocar` já liga
  ao reprodutor real (fatia 3), só falta a origem do áudio.
