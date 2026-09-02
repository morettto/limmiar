# features/nota-biblioteca

## Responsabilidade

Biblioteca de notas assinadas/pendentes da spec S08 (ticket S08-02). Três partes puras,
sem UI e sem router: agrupar a fila de assinatura por paciente (`biblioteca.ts`), o índice
de busca full-text sobre o texto das notas (`indice.ts`, via `minisearch`) e a persistência
desse índice cifrado em OPFS (`indice-crypto.ts` + `indice-store.ts`). Mesma disciplina do
resto do monorepo: entra e sai por parâmetro/retorno, zero estado global, zero primitiva de
cifra própria. Desde a fatia 5, tem chamador real: `pages/biblioteca/BibliotecaPage.tsx` é
o único lugar que compõe as três partes com UI (`widgets/biblioteca/BibliotecaNotas.tsx`) --
ver os READMEs dos dois para o fluxo de composição.

## Fluxo principal

1. `agruparPorPaciente(itens: readonly Nota[])` (`biblioteca.ts`) -- agrupa os itens da
   fila de assinatura (`Nota[]`, cada uma já com o seu `estado`) por `patientId`. Grupos
   saem na ordem da primeira ocorrência de cada `patientId` em `itens` (`Map` preserva
   ordem de inserção); dentro de cada grupo, os itens com `estado === ESTADO_PENDENTE`
   (rascunho) vêm primeiro, e a ordem relativa dentro de cada partição (rascunhos entre si,
   assinadas entre si) é a de entrada -- `Array.prototype.filter` é estável, sem
   comparador de sort próprio. É o critério de aceite 3 ("rascunhos em destaque no topo").
2. `notaParaDoc(nota: Nota)` (`indice.ts`) -- concatena o texto de todas as frases da nota
   (`nota.frases.map(f => f.texto).join(' ')`) num único `DocNota` buscável.
3. `construirIndice(docs)` cria um `MiniSearch<DocNota>` configurado por `OPCOES_INDICE`
   (`fields: ['texto']`, `storeFields: ['patientId']`) e indexa `docs`.
4. `impressaoDigital(notas)` (`indice.ts`, ticket S08-09) -- `id:revisao` de cada nota,
   ordenados e unidos por `|`, num único valor que resume "que notas (e que versão de cada
   uma) o índice cobre". A ordem de `notas` não muda a impressão (`sort()` antes do `join`).
5. `serializarIndice(indice, impressao)`/`carregarIndice(json, impressao)` (ticket S08-09)
   fazem o roundtrip por um envelope `{ impressao, indice: indice.toJSON() }` (JSON, bytes
   UTF-8). `carregarIndice` compara `envelope.impressao` com a `impressao` recebida antes de
   reidratar -- se não bater (nota nova/editada/apagada desde a última gravação, **ou** um
   blob antigo sem envelope, `impressao === undefined`), devolve `null` em vez de adotar um
   índice obsoleto; senão `MiniSearch.loadJS(envelope.indice, OPCOES_INDICE)` (`loadJS`, não
   `loadJSON` -- o objeto já foi parseado, não volta a `JSON.stringify`). Ver Decisões,
   "envelope com impressão, não compatibilidade com blobs antigos".
6. `buscar(indice, termo)` devolve um de três estados (`ResultadoBusca`): `a-preparar`
   (`indice === null`, ainda não construído/restaurado), `ocioso` (termo vazio -- mostra a
   biblioteca toda) ou `pronto` com `ids` (pode ser `[]`, sem resultados). Ver Decisões,
   "os três estados não colapsam em dois".
7. `indiceBuscaAad(accountId)`/`selarIndice`/`abrirIndice` (`indice-crypto.ts`) cifram o
   JSON do índice (já o envelope com impressão) sob a DEK da conta
   (`webcrypto.encrypt`/`decrypt` de `@limmiar/crypto`), AAD
   `limmiar/note-index/v1|{accountId}` -- rejeita se `accountId` não bater com o usado
   para selar.
8. `opfsIndice(dir)` (`indice-store.ts`) devolve `{ ler, gravar, apagar }`, o único trio
   autorizado a tocar a API OPFS para o índice de busca (um ficheiro fixo, `indice-busca`,
   por diretório já escopado à conta pelo chamador). `ler` devolve `null` quando o ficheiro
   ainda não existe (apanha só `NotFoundError`; qualquer outro erro propaga). `apagar`
   (ticket S08-09) faz `dir.removeEntry(ARQUIVO_INDICE)`.
9. `persistirIndice(gravar, dek, accountId, indice, impressao)` (parâmetro solto, `gravar`
   sozinho -- só usa esse campo) e `restaurarIndice(store, dek, accountId, impressao)`
   (`store: { ler, apagar }` inteiro -- os dois precisam de andar juntos) compõem os passos
   5+7+8: serializar (com a impressão) → selar → gravar, e ler → abrir → carregar (com a
   impressão). `gravar` nunca recebe o JSON em claro, só o blob selado. `restaurarIndice`:
   sem blob (`ler()` devolve `null`) devolve `null` sem chamar `apagar` -- não há o que
   apagar; blob presente mas `carregarIndice` devolve `null` (impressão não bate) chama
   `store.apagar()` antes de devolver `null` -- o blob obsoleto é apagado, não só ignorado (o
   texto em claro de uma nota corrigida/apagada não sobrevive no disco). Uma rejeição desse
   `apagar` é ignorada de propósito (ver Decisões, "blob obsoleto é apagado, não só
   ignorado").

## Pontos de entrada

- `agruparPorPaciente(itens: readonly Nota[]): GrupoPaciente[]` (`biblioteca.ts`); `Nota`
  vem de `entities/nota/nota.ts` (desde o ticket S08-06, `agruparPorPaciente` recebe
  `Nota[]` em vez de `ItemFila[]` -- `GrupoPaciente.itens` mantém o nome, muda o tipo).
- `DocNota`, `OPCOES_INDICE`, `notaParaDoc(nota: Nota): DocNota`,
  `construirIndice(docs: readonly DocNota[]): MiniSearch<DocNota>`,
  `impressaoDigital(notas: readonly Nota[]): string`,
  `serializarIndice(indice, impressao: string): Uint8Array<ArrayBuffer>`,
  `carregarIndice(json, impressao: string): MiniSearch<DocNota> | null`,
  `ResultadoBusca`, `buscar(indice: MiniSearch<DocNota> | null, termo: string): ResultadoBusca`
  (`indice.ts`).
- `indiceBuscaAad(accountId): Uint8Array<ArrayBuffer>`,
  `selarIndice(dek, accountId, json): Promise<Uint8Array<ArrayBuffer>>`,
  `abrirIndice(dek, accountId, selado): Promise<Uint8Array<ArrayBuffer>>` (`indice-crypto.ts`).
- `LerSelado`, `GravarSelado`, `ApagarSelado`, `opfsIndice(dir): { ler, gravar, apagar }`,
  `persistirIndice(gravar: GravarSelado, dek, accountId, indice, impressao): Promise<void>`,
  `restaurarIndice(store: { ler, apagar }, dek, accountId, impressao): Promise<MiniSearch<DocNota> | null>`
  (`indice-store.ts`).
- Chamador (fatias 4-5): `widgets/biblioteca/BibliotecaNotas.tsx` renderiza `GrupoPaciente[]`
  e `ResultadoBusca`; `pages/biblioteca/BibliotecaPage.tsx` é quem chama
  `agruparPorPaciente`/`buscar`/`persistirIndice`/`restaurarIndice` de facto, na rota
  `/biblioteca`.

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
- **Envelope com impressão, não compatibilidade com blobs antigos (ticket S08-09).** O blob
  selado não guardava nada sobre que notas cobria -- depois da primeira gravação, uma nota
  nova ou editada nunca entrava no índice, e a busca ficava presa num "nenhuma nota
  encontrada" indistinguível de uma busca legitimamente vazia. `impressaoDigital(notas)`
  (`id:revisao` de cada nota, ordenados) resolve isso sem hash, sem async e sem dependência
  nova -- o valor vive dentro do próprio blob selado (`{ impressao, indice }`), nunca vaza.
  Um blob já persistido antes desta fatia não tem campo `impressao` (`undefined`); em vez de
  um ramo especial para "formato antigo", o `!==` entre `undefined` e a impressão atual já
  cai no mesmo caminho de `null` -- por instrução explícita (`AGENTS.md`: "Do not preserve
  backward compatibility"), não há tentativa de ler esse formato.
- **Blob obsoleto é apagado, não só ignorado.** Detetar a impressão errada e devolver `null`
  sem apagar deixaria o texto em claro de uma nota corrigida ou apagada sobreviver no disco
  do profissional por tempo indefinido -- não é só UX, é retenção de dado num produto
  clínico com dever de retirada. `restaurarIndice` chama `store.apagar()` antes de devolver
  `null` nesse caso; `opfsIndice(dir).apagar` é `dir.removeEntry(ARQUIVO_INDICE)`, mesmo
  ficheiro fixo que `ler`/`gravar` já usam. Uma rejeição desse `apagar` (OPFS negada, cheia,
  disco corrompido) é ignorada, não propagada -- `restaurarIndice` já está no caminho de
  recuperação de um índice obsoleto, e propagar mataria a página exatamente no passo que a
  resolveria: `null` faz `BibliotecaPage` reconstruir e chamar `persistirIndice`, cujo
  `gravar` (via `createWritable()`) trunca e sobrescreve o mesmo ficheiro de qualquer forma.
  Só a rejeição de `apagar` é engolida -- `ler` e `abrirIndice` continuam a propagar como
  antes; um erro nesses dois passos não tem um passo seguinte que o corrija sozinho.

## Fora de âmbito

- Manter o índice atualizado quando uma nota é assinada/editada fora do ciclo de vida de
  `BibliotecaPage` (reindexar, persistir de novo a partir de outra tela, ex.:
  `pages/notas/NotaPage.tsx`) -- este módulo só sabe construir/(re)carregar/persistir um
  índice já montado, não decide quando isso deve acontecer; ver `pages/biblioteca/README.md`,
  "Fora de âmbito".
- Qualquer mudança em `entities/nota`, `nota-fila` -- fora deste diff por instrução
  explícita do ticket.
