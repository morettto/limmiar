# ADR-S18-01: A árvore OPFS da conta é purgada inteira no logout, não módulo a módulo

## Contexto

A spec S18 propôs, e o S08-20 e o S18-12 implementaram, uma regra única para a saída da conta:
*purga de saída por registo explícito, não por varredura do armazenamento da origem*. Cada módulo
que guarda estado local escreve uma entrada em `PURGAS` (`app/providers/purgar-conta.ts`), e o
logout percorre essa lista. O argumento a favor era a assimetria dos erros: um registo esquece uma
purga nova em silêncio, mas uma varredura apaga o que devia sobreviver — a preferência de locale
hoje, uma fila de notas por sincronizar amanhã, que é perda de dado clínico.

Para o registo não se esquecer de ninguém, o S18-12 acrescentou um portão de arquitetura: um teste
que varria `src/`, procurava a string `navigator.storage.getDirectory` em cada módulo de produção e
exigia que o módulo encontrado aparecesse dentro do literal `PURGAS`.

A cadeia de review da spec (bloqueante B1, eixo estrutural) mostrou que o portão não modelava o
invariante que dizia proteger. O padrão dominante do repositório não é abrir a raiz OPFS: é receber
o handle de diretório já aberto — `opfsIndice(dir)` em `nota-biblioteca/indice-store.ts`,
`opfsWriter(dir)` em `live-session/chunk-store.ts`. O `chunk-store.ts` escreve os chunks de áudio
selados da conta e nunca contém aquela string, portanto o portão dava verde exatamente sobre o blob
que o invariante existia para apagar — e usava esse mesmo módulo como fixture do seu caso negativo.
Somando: o portão parseava o literal `PURGAS` e os `import ... from '...'` com duas expressões
regulares, e um `import type`, um `as` ou um reformat do Prettier mudavam o resultado sem mudar uma
linha de lógica.

## Decisão

**Para OPFS, a ADR anterior é revogada.** Toda a árvore `<raiz OPFS>/<accountId>` morre numa
entrada só, `purgarOpfsDaConta` (`entities/account/opfs-conta.ts`), que faz
`raiz.removeEntry(accountId, { recursive: true })` e trata `NotFoundError` como no-op.

**Fora de OPFS, a ADR anterior mantém-se.** A chave BYOK vive em `localStorage`, partilhado com a
preferência de locale e com o que mais lá vier parar; aí não há diretório por conta que delimite o
que é dado da conta, e `clearApiKey` continua a ser uma entrada nomeada em `PURGAS`. O que muda é
o âmbito da regra, não a regra inteira.

O argumento que o `nota-biblioteca/README.md` fazia contra a purga recursiva — "o diretório da
conta pode vir a guardar dados de outros módulos" — está invertido para um logout. Dados de outros
módulos **debaixo do diretório da conta** são precisamente o que tem de ser purgado; num produto
clínico com dever de retirada, "sobrou um blob de outro módulo" é a falha grave, e "apagou-se um
blob a mais de uma conta que acabou de sair" não é. A perda de dado que a ADR anterior temia
continua real para `localStorage`, que é onde a regra antiga fica de pé.

O portão de arquitetura desaparece e não é substituído. O invariante deixa de ser vigiado
(N escritores ↔ N entradas registadas) e passa a ser verdadeiro por construção (um caminho, uma
purga): não há registo para esquecer. Trocar uma regex por outro portão estático seria pagar de
novo por uma proteção que já se provou nominal.

**Alternativa rejeitada: um teste de conteúdo mais simples**, proibindo `navigator.storage
.getDirectory` fora do módulo dono do diretório da conta. É mais barato e menos frágil que o portão
que existia, mas continua a vigiar um registo em vez de o eliminar, e continua cego a quem recebe o
handle já aberto — o caso que originou este ADR.

## Consequências

- **Nada que precise de sobreviver ao logout pode viver debaixo de `<raiz OPFS>/<accountId>`.**
  Esta é a contrapartida direta da decisão e é a única forma de a violar. Está escrita no
  `app/providers/README.md`, que é onde a regra de saída da conta vive.
- `dirIndiceDaConta` e `purgarIndiceBusca` desaparecem de `features/nota-biblioteca/indice-store.ts`:
  ficaram sem chamador de produção. A convenção `<raiz OPFS>/<accountId>` passa a ter uma definição
  só, em `entities/account/opfs-conta.ts` — a slice dona do conceito de conta, que `app` e
  `features` podem importar e que não pode importar nenhuma delas de volta. O escritor real do
  índice, quando existir, pede o diretório a esse módulo.
- Um escritor futuro de OPFS deixa de ter obrigação de registo, desde que escreva debaixo do
  diretório da conta. Os chunks de `live-session` já ficam cobertos sem terem sido registados, e é
  esse o teste que prova a correção: uma conta com blob de índice **e** blob de chunk fica sem os
  dois depois do logout.
- **Risco residual, nomeado e aceite:** um módulo que escreva na raiz OPFS *fora* de
  `<raiz>/<accountId>` continua a escapar, e agora não há nada estático a apanhá-lo. Apanhá-lo
  exigiria regex sobre código-fonte (o que este ADR recusa) ou uma regra ESLint nova;
  `dependency-cruiser` não vê chamadas a globais. O que resta é a convenção documentada e o facto
  de nenhum escritor de produção existir hoje.
