# features/nota-biblioteca

## Responsabilidade

Biblioteca de notas assinadas/pendentes da spec S08 (ticket S08-02). Três partes puras,
sem UI e sem router (fatias 1-3 de 5): agrupar a fila de assinatura por paciente
(`biblioteca.ts`), o índice de busca full-text sobre o texto das notas (`indice.ts`, via
`minisearch`) e a persistência desse índice cifrado em OPFS (`indice-crypto.ts` +
`indice-store.ts`). Mesma disciplina do resto do monorepo: entra e sai por
parâmetro/retorno, zero estado global, zero primitiva de cifra própria.

## Fluxo principal

1. `agruparPorPaciente(itens: readonly ItemFila[])` (`biblioteca.ts`) -- agrupa os itens da
   fila de assinatura (`features/nota-fila/FilaAssinatura.tsx`) por `patientId`. Grupos
   saem na ordem da primeira ocorrência de cada `patientId` em `itens` (`Map` preserva
   ordem de inserção); dentro de cada grupo, os itens com `estado === ESTADO_PENDENTE`
   (rascunho) vêm primeiro, e a ordem relativa dentro de cada partição (rascunhos entre si,
   assinadas entre si) é a de entrada -- `Array.prototype.filter` é estável, sem
   comparador de sort próprio. É o critério de aceite 3 ("rascunhos em destaque no topo").
2. `notaParaDoc(nota: Nota)` (`indice.ts`) -- concatena o texto de todas as frases da nota
   (`nota.frases.map(f => f.texto).join(' ')`) num único `DocNota` buscável.
3. `construirIndice(docs)` cria um `MiniSearch<DocNota>` configurado por `OPCOES_INDICE`
   (`fields: ['texto']`, `storeFields: ['patientId']`) e indexa `docs`.
4. `serializarIndice(indice)`/`carregarIndice(json)` fazem o roundtrip do índice para bytes
   UTF-8 de JSON (`indice.toJSON()`/`MiniSearch.loadJSON`), sempre com `OPCOES_INDICE` --
   ver Decisões, "opções partilhadas".
5. `buscar(indice, termo)` devolve um de três estados (`ResultadoBusca`): `a-preparar`
   (`indice === null`, ainda não construído/restaurado), `ocioso` (termo vazio -- mostra a
   biblioteca toda) ou `pronto` com `ids` (pode ser `[]`, sem resultados). Ver Decisões,
   "os três estados não colapsam em dois".
6. `indiceBuscaAad(accountId)`/`selarIndice`/`abrirIndice` (`indice-crypto.ts`) cifram o
   JSON do índice sob a DEK da conta (`webcrypto.encrypt`/`decrypt` de `@limmiar/crypto`),
   AAD `limmiar/note-index/v1|{accountId}` -- rejeita se `accountId` não bater com o usado
   para selar.
7. `opfsIndice(dir)` (`indice-store.ts`) devolve `{ ler, gravar }`, o único par autorizado a
   tocar a API OPFS para o índice de busca (um ficheiro fixo, `indice-busca`, por diretório
   já escopado à conta pelo chamador). `ler` devolve `null` quando o ficheiro ainda não
   existe (apanha só `NotFoundError`; qualquer outro erro propaga).
8. `persistirIndice(gravar, dek, accountId, indice)`/`restaurarIndice(ler, dek, accountId)`
   compõem os passos 4+6+7: serializar → selar → gravar, e ler → abrir → carregar. `gravar`
   nunca recebe o JSON em claro, só o blob selado.

## Pontos de entrada

- `agruparPorPaciente(itens: readonly ItemFila[]): GrupoPaciente[]` (`biblioteca.ts`).
- `DocNota`, `OPCOES_INDICE`, `notaParaDoc(nota: Nota): DocNota`,
  `construirIndice(docs: readonly DocNota[]): MiniSearch<DocNota>`,
  `serializarIndice(indice): Uint8Array<ArrayBuffer>`, `carregarIndice(json): MiniSearch<DocNota>`,
  `ResultadoBusca`, `buscar(indice: MiniSearch<DocNota> | null, termo: string): ResultadoBusca`
  (`indice.ts`).
- `indiceBuscaAad(accountId): Uint8Array<ArrayBuffer>`,
  `selarIndice(dek, accountId, json): Promise<Uint8Array<ArrayBuffer>>`,
  `abrirIndice(dek, accountId, selado): Promise<Uint8Array<ArrayBuffer>>` (`indice-crypto.ts`).
- `LerSelado`, `GravarSelado`, `opfsIndice(dir): { ler, gravar }`,
  `persistirIndice(gravar, dek, accountId, indice): Promise<void>`,
  `restaurarIndice(ler, dek, accountId): Promise<MiniSearch<DocNota> | null>`
  (`indice-store.ts`).
- Ainda sem chamador nesta fatia -- ligar à UI (widget/página que renderiza a biblioteca e o
  campo de busca) é trabalho das fatias 4-5 desta spec, fora deste diff.

## Decisões desta fatia

- **OPFS, não Dexie, para persistir o índice.** A spec original apontava Dexie, mas o
  índice de busca não é um dado relacional/consultável por campo -- é um blob opaco
  (`MiniSearch.toJSON()` serializado) que só precisa de ser lido e escrito inteiro, de novo
  a novo. `features/live-session`/`features/nota-audio` já usam exatamente esse padrão
  (blob cifrado por ficheiro OPFS) para os chunks de áudio e agora para a nota assinada
  (`entities/nota`); manter OPFS aqui evita introduzir uma segunda tecnologia de
  persistência local só para um caso que a primeira já cobre, e reusa o par
  ler/gravar-com-`NotFoundError`-vira-`null` que `opfsWriter` já estabeleceu como
  convenção do módulo.
- **MiniSearch, não `String.includes`.** Busca por substring simples não cobre o critério
  de aceite (termos multi-palavra, tokenização, resultados por relevância) sem reimplementar
  um tokenizador e um índice invertido à mão -- exatamente o trabalho que uma lib já
  instalada (`minisearch@^7.2.0`, dependência de produção já presente em `package.json`)
  resolve. Subir a escada: não há utilitário do repo nem da stdlib que cubra isto, e a
  lib já estava instalada -- não foi adicionada para esta fatia.
- **`OPCOES_INDICE` é uma única constante exportada, reusada literalmente por
  `construirIndice` e `carregarIndice`.** `minisearch` serializa a estrutura do índice
  (`fieldIds`, `storedFields`) mas continua a precisar de `fields`/`storeFields` no
  `loadJSON` para reidratar corretamente -- se os dois lados declarassem opções separadas
  (mesmo com os mesmos valores, por descuido de manutenção futura), um campo novo
  adicionado só de um lado quebraria o roundtrip em silêncio (buscar por um termo que só
  existe fora do campo agora indexado passaria a devolver algo diferente do que devolvia
  antes de serializar). O teste de roundtrip (`indice.test.ts`) é o que trava esse
  invariante. `Options<DocNota>` sem `as const`: os tipos de `minisearch` querem
  `fields`/`storeFields` mutáveis (`string[]`), e uma tupla `readonly` não é atribuível a
  isso -- a constante continua única, só o tipo muda.
- **Os três estados de `ResultadoBusca` não colapsam em dois.** `a-preparar` (índice ainda
  não existe) e `pronto` com `ids: []` (índice existe, buscou, não achou nada) pareceriam
  a mesma coisa numa UI ingênua ("nada para mostrar"), mas confundi-los é o "sem resultados
  enganoso" que o critério de aceite 2 proíbe explicitamente -- mostrar "nenhuma nota
  encontrada" enquanto o índice ainda está a carregar do OPFS engana o utilizador sobre se
  a busca de facto correu.
- **`opfsIndice` é a única função autorizada a tocar a API OPFS para o índice**, mesmo
  padrão de `opfsWriter` em `features/live-session/chunk-store.ts`: todo o resto passa por
  `persistirIndice`/`restaurarIndice`, que nunca veem `getFileHandle`/`createWritable`
  diretamente.
- **Duplo de OPFS extraído para `apps/app/src/test-support/fake-opfs.ts`.** Esta é a
  terceira vez que um `FakeDirectoryHandle` nasce num teste deste app
  (`chunk-store.test.ts`, depois `reprodutor.test.ts`, agora `indice-store.test.ts` --
  que precisava dos dois lados, leitura e escrita, ao contrário dos outros dois que só
  precisavam de um). Extraído em vez de copiado uma terceira vez; `chunk-store.test.ts` e
  `reprodutor.test.ts` foram atualizados para reusar o mesmo duplo (sem mudança de
  comportamento -- os dois continuam verdes). Ver os READMEs de `features/live-session` e
  `features/nota-audio` para o antes/depois.

## Fora de âmbito (fatias seguintes da spec S08/ticket S08-02)

- UI da biblioteca e do campo de busca (widget/página que chama `agruparPorPaciente`/
  `buscar`, mostra estados de carregamento/vazio) -- fatias 4-5.
- Manter o índice atualizado quando uma nota é assinada/editada (reindexar, persistir de
  novo) -- também fatias seguintes; este módulo só sabe construir/(re)carregar/persistir um
  índice já montado, não decide quando isso deve acontecer.
- Qualquer mudança em `entities/nota`, `nota-fila` ou no router -- fora deste diff por
  instrução explícita do ticket.
