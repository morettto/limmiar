# widgets/biblioteca

## Responsabilidade

Render puro da Tela de biblioteca de notas (spec S08, ticket S08-02, fatia 4 de 5): campo
de busca + notas agrupadas por paciente. Não decide o estado da busca -- `resultado`
(`ResultadoBusca`, `features/nota-biblioteca/indice.ts`) já vem calculado do chamador
(`pages/biblioteca/BibliotecaPage.tsx`); este widget só sabe renderizar os três estados,
igual em espírito a `widgets/soap-editor/FilaEEditor.tsx` (compõe, não decide).

## Fluxo principal

1. `BibliotecaNotas` recebe `grupos` (`GrupoPaciente[]`, já agrupados e ordenados por
   `agruparPorPaciente`), `termo`/`onTermoChange` (campo de busca controlado pelo chamador)
   e `resultado` (`ResultadoBusca`).
2. `a-preparar` -- mostra `role="status"` ("Preparando a busca...") **e os grupos inteiros
   renderizam na mesma**, sem filtro. Nunca mostra "sem resultados" -- confundir "índice
   ainda a carregar" com "busca sem resultado" é exatamente o que o critério de aceite 2 da
   spec original proíbe (ver `features/nota-biblioteca/README.md`, "os três estados").
3. `ocioso` -- mesma coisa (grupos inteiros, sem filtro), mas sem o status de preparação:
   é a biblioteca inteira, termo vazio.
4. `pronto` -- filtra os itens de cada grupo por `resultado.ids` (`gruposFiltrados`, um
   `Set` para lookup) e descarta os grupos que ficaram sem itens depois do filtro. Só
   quando `ids` vier vazio (`[]`) é que aparece "Nenhuma nota encontrada" -- não quando o
   filtro apenas não bate com nenhum item de um grupo específico (esse grupo não
   renderiza, sem alarme).
5. A ordem dos itens dentro de cada grupo (rascunhos antes de assinadas) já vem pronta de
   `agruparPorPaciente` -- este widget nunca reordena, só filtra/renderiza na ordem
   recebida.

## Pontos de entrada

- `BibliotecaNotas` (`BibliotecaNotas.tsx`) -- componente React, props `grupos`, `termo`,
  `onTermoChange`, `resultado` (ver `BibliotecaNotasProps`).
- Consumido por `pages/biblioteca/BibliotecaPage.tsx` (rota `/biblioteca`, ver
  `app/routing/router.tsx`).

## Decisões desta fatia

- **`gruposFiltrados` é a única função além do componente**, e só filtra quando
  `resultado.estado === 'pronto'` -- `a-preparar`/`ocioso` devolvem `grupos` sem tocar.
  Não há `useMemo`: `grupos` tipicamente já é pequeno (uma fila de assinatura por
  profissional, não uma tabela paginada), e o widget não tem nenhum sinal de que essa
  recomputação por render seja um problema de facto medido.
- **"sem resultados" é `ids.length === 0`, não "todos os grupos filtrados ficaram
  vazios".** São coisas diferentes: `ids: []` é o índice a dizer "não achei nada" (o caso
  que a UI deve anunciar); `ids` não-vazio que por acaso não bate com nenhum item de
  `grupos` (ex.: uma nota apagada da fila depois de indexada) é um estado de dados
  divergentes, não "sem resultados" -- `gruposFiltrados` descarta esse grupo (sem itens,
  sem cabeçalho vazio), sem alarme.
- **Sem `.spec.tsx` com `toHaveScreenshot`.** O critério de aceite deste ticket é "axe
  limpo" (`BibliotecaNotas.spec.tsx`, `componentAxeBuilder`), não regressão visual --
  diferente de `AuthScreen.spec.tsx`/`TotpSetup.spec.tsx`, cuja AC explícita inclui
  screenshots nos 4 breakpoints. Adicionar baselines aqui seria escopo não pedido.

## Fora de âmbito

- Decidir quando reindexar/persistir o índice (nota assinada, editada) -- fica em
  `pages/biblioteca/BibliotecaPage.tsx` e em `features/nota-biblioteca` (`indice-store.ts`).
- Paginação/virtualização de listas grandes -- sem sinal de que seja necessário nesta
  fatia.
