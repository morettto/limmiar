# entities/nota

## Responsabilidade

Domínio puro da nota clínica SOAP (spec S08, fatia 1 de 5). Modela a nota como frases
distribuídas pelas quatro secções (`S`, `O`, `A`, `P`), cada uma podendo carregar as
âncoras temporais que a ligam ao instante exato do áudio de origem. Sem UI, sem
backend, sem chamada a áudio — só funções puras, testáveis em Node, seguindo o mesmo
padrão de `packages/copilot` e `apps/app/src/entities/patient`: nenhuma classe, nenhum
estado global, tudo entra e sai por parâmetro/retorno.

## Fluxo principal

1. `rascunhoParaNota(id, patientId, porSecao)` — converte o rascunho aprovado do copiloto
   (uma `Afirmacao[]` por secção, vindo de `@limmiar/copilot`) numa `Nota` nova, com
   `revisao: 0`. As frases saem ordenadas por `S`, `O`, `A`, `P` e, dentro de cada secção,
   pela ordem do array de entrada. Cada `Afirmacao` vira uma `FraseNota` que preserva as
   suas `ancoras` sem as alterar.
2. `editarFrase(nota, fraseId, texto)` — devolve uma **nota nova** (nunca muta a entrada),
   com `revisao` incrementada em 1 e só o `texto` da frase indicada trocado. As `ancoras`
   dessa frase sobrevivem intactas: é o que garante que editar o texto do profissional não
   quebra a ligação ao áudio.
3. `textoCanonico(nota)` — serialização determinística da nota (mesma nota → mesma
   string sempre), usada como entrada do digest/assinatura.
4. `digestNota(nota)` — SHA-256 de `textoCanonico(nota)`, via `webcrypto.sha256` de
   `@limmiar/crypto`.

## Pontos de entrada

- `rascunhoParaNota(id: string, patientId: string, porSecao: Record<SecaoSoap, readonly Afirmacao[]>): Nota`
- `editarFrase(nota: Nota, fraseId: string, texto: string): Nota`
- `textoCanonico(nota: Nota): string`
- `digestNota(nota: Nota): Promise<Uint8Array<ArrayBuffer>>`
- `ORDEM_SECOES: readonly SecaoSoap[]` -- `['S', 'O', 'A', 'P']`. Exportada desde a fatia 2
  (S08-01) para `apps/app/src/features/nota-editor/EditorSoap.tsx` e
  `apps/app/src/pages/notas/NotaPage.tsx` a reusarem em vez de redeclararem o literal (um
  `.tsx` a repeti-lo dispararia `lingui/no-unlocalized-strings`, que varre todo `.tsx` à
  procura de texto visível não traduzido; este ficheiro, puro `.ts`, está fora do seu
  alcance). Sem mudança de comportamento nem de cobertura -- só a keyword `export`.
  **Este ficheiro é a referência única para esta justificação** -- `ORDEM_SECOES` reexportada
  de um `.ts` puro, e o mesmo raciocínio aplicado via convenção `SCREAMING_SNAKE_CASE` (em
  vez de reexportação, já que essas constantes nascem dentro de um `.tsx`) às constantes
  `ESTADO_PENDENTE`/`ESTADO_ASSINADA` de `features/nota-fila/FilaAssinatura.tsx`. Os
  READMEs de `features/nota-editor` e `features/nota-fila` linkam para aqui em vez de
  repetirem o parágrafo.
- Tipos: `SecaoSoap`, `FraseNota`, `Nota` (`src/nota.ts`). `Afirmacao`/`Ancora` são
  importados de `@limmiar/copilot`, não redeclarados.

## Decisões desta fatia

- **Campos escalares de `FraseNota`/`Nota` são `readonly`.** `editarFrase` promete nunca
  mutar a entrada (devolve sempre uma nota nova); `readonly` deixa o compilador garantir
  essa promessa em vez de depender só do comentário e da disciplina de quem escreve um
  novo chamador.
- **Id de frase determinístico (`${secao}-${indice}`), não `crypto.randomUUID()`.** Um id
  aleatório tornaria `textoCanonico`/`digestNota` irreprodutíveis entre carregamentos da
  mesma nota — e a assinatura da fatia 4 depende do digest ser reprodutível. O id não
  entra em `textoCanonico` (ver abaixo), mas continuar a derivá-lo de forma estável evita
  que `editarFrase` (que procura por `fraseId`) dependa de identidade que muda a cada
  render.
- **`fraseId` inexistente lança, em vez de devolver a nota inalterada.** Um id que já não
  bate certo (secção reordenada, nota errada, bug do chamador) é um bug que deve falhar no
  ponto onde foi cometido — devolver a nota como se nada tivesse acontecido esconderia uma
  edição perdida em silêncio. Ver `editarFrase` em `src/nota.ts` e o teste correspondente
  em `src/nota.test.ts`.
- **`textoCanonico` cobre secção, texto e âncoras de cada frase, e `revisao` — não cobre
  `id` da frase nem `id`/`patientId` da nota.** Isto é a superfície acordada no portão da
  forma do ticket S08-01. Se a serialização não cobrisse as âncoras, alguém poderia trocar
  a citação (o instante do áudio) sem invalidar a assinatura — ver o teste que prova que
  trocar só uma âncora muda o texto canónico. `patientId` ficar de fora é uma decisão
  restrita a esta fatia: se um requisito futuro precisar que a assinatura também vincule
  a nota ao paciente (evitar cópia para paciente errado), isso é extensão da assinatura na
  fatia 4, não deste ficheiro.
- **`digestNota` reusa `webcrypto.sha256` de `@limmiar/crypto`, que nasceu nesta fatia.**
  `packages/crypto` não tinha wrapper de hash (só cifra/decifra, wrap/unwrap de chave,
  KDF); em vez de chamar `crypto.subtle.digest` diretamente aqui, a função nasceu no
  pacote dono de toda primitiva criptográfica do monorepo (`packages/crypto/src/webcrypto.ts`,
  exportada como `webcrypto.sha256`), testada com os vetores conhecidos NIST FIPS 180-4
  (`sha256("")` e `sha256("abc")`) em `packages/crypto/src/webcrypto.test.ts`.

## Fora de âmbito (fatias seguintes da spec S08)

- UI de edição da nota, backend/persistência, e a captura/transcrição de áudio — nenhuma
  delas é tocada aqui.
- Assinatura sobre `digestNota` (fatia 4) — este módulo só produz o digest; assinar,
  verificar e guardar a assinatura é responsabilidade de um módulo futuro.
