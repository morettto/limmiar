# entities/nota

## Responsabilidade

Domínio puro da nota clínica SOAP (spec S08). Modela a nota como frases distribuídas
pelas quatro secções (`S`, `O`, `A`, `P`), cada uma podendo carregar as âncoras temporais
que a ligam ao instante exato do áudio de origem (`nota.ts`, fatia 1). Desde a fatia 5,
o módulo também sabe **selar** a nota -- assinatura sobre o digest (`nota-crypto.ts`) e o
cliente HTTP do endpoint de assinatura do backend (`api.ts`) -- mas continua sem UI e sem
estado global: tudo entra e sai por parâmetro/retorno, mesmo padrão de `packages/copilot`
e `apps/app/src/entities/patient` (`nota-crypto.ts` é, aliás, o molde literal de
`entities/patient/patient-crypto.ts`; `api.ts` o de `entities/patient/api.ts`). Desde o
ticket S08-06, `Nota` também é dona do seu `estado` (`EstadoNota`, `ESTADO_PENDENTE`/
`ESTADO_ASSINADA`) -- ver "Decisões da fatia S08-06" abaixo.

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
5. `selarAssinatura(dek, noteId, nota)` (fatia 5) — cifra `digestNota(nota)` sob a DEK do
   paciente, com AAD `notaAssinaturaAad(noteId, nota.revisao)`. O blob de 60 bytes
   resultante (`iv(12) || ct(32) || tag(16)`) é o que `assinarNota` envia ao backend.
6. `notaParaEntrada(nota)` (fatia 5) — serializa a nota inteira (não só o digest) para
   virar o `plaintext` de uma entrada de prontuário (`sealEntry`, `entities/patient`).
7. `assinarNota` (fatia 5, `api.ts`) — cliente HTTP de
   `POST /accounts/{accountId}/notes/{noteId}/signature`.

## Pontos de entrada

- `rascunhoParaNota(id: string, patientId: string, porSecao: Record<SecaoSoap, readonly Afirmacao[]>): Nota`
- `editarFrase(nota: Nota, fraseId: string, texto: string): Nota`
- `textoCanonico(nota: Nota): string`
- `serializarFrases(frases: readonly FraseNota[])` (`nota.ts`, ronda 1 de correção) --
  forma comum a `textoCanonico` e a `notaParaEntrada`; não chamar diretamente fora dos
  dois, é detalhe de serialização partilhado, não uma API própria.
- `digestNota(nota: Nota): Promise<Uint8Array<ArrayBuffer>>`
- `ORDEM_SECOES: readonly SecaoSoap[]` -- `['S', 'O', 'A', 'P']`. Exportada desde a fatia 2
  (S08-01) para `apps/app/src/features/nota-editor/EditorSoap.tsx` e
  `apps/app/src/pages/notas/NotaPage.tsx` a reusarem em vez de redeclararem o literal (um
  `.tsx` a repeti-lo dispararia `lingui/no-unlocalized-strings`, que varre todo `.tsx` à
  procura de texto visível não traduzido; este ficheiro, puro `.ts`, está fora do seu
  alcance). Sem mudança de comportamento nem de cobertura -- só a keyword `export`.
  **Este ficheiro é a referência única para esta justificação** -- `ORDEM_SECOES` e
  `ESTADO_PENDENTE`/`ESTADO_ASSINADA` (abaixo) nascem as duas neste `.ts` puro, fora do
  alcance de `lingui/no-unlocalized-strings`. Os READMEs de `features/nota-editor` e
  `features/nota-fila` linkam para aqui em vez de repetirem o parágrafo.
- Tipos: `SecaoSoap`, `FraseNota`, `Nota` (`src/nota.ts`), `EstadoNota`
  (`(typeof ESTADOS_NOTA)[number]`); constantes `ESTADO_PENDENTE`, `ESTADO_ASSINADA` e o
  array `ESTADOS_NOTA` (`[ESTADO_PENDENTE, ESTADO_ASSINADA] as const`) -- as constantes vêm do S08-06,
  `ESTADOS_NOTA`/`EstadoNota` derivado dele do S08-16 (justificação do idioma no comentário
  acima de `ESTADOS_NOTA` em `nota.ts`).
  `Afirmacao`/`Ancora` são importados de `@limmiar/copilot`, não redeclarados.
- `notaAssinaturaAad(noteId: string, revisao: number): Uint8Array<ArrayBuffer>`
  (`nota-crypto.ts`, fatia 5) -- `"limmiar/note-signature/v1|{noteId}|{revisao}"` em UTF-8.
- `selarAssinatura(dek: CryptoKey, noteId: string, nota: Nota): Promise<Uint8Array<ArrayBuffer>>`
  (`nota-crypto.ts`, fatia 5).
- `notaParaEntrada(nota: Nota): Uint8Array<ArrayBuffer>` (`nota-crypto.ts`, fatia 5).
- `assinarNota(baseUrl, accountId, accessToken, noteId, { revision, signature }): Promise<AssinarNotaResult>`
  (`api.ts`, fatia 5) -- `POST /accounts/{accountId}/notes/{noteId}/signature`, 201.
- `obterAssinatura(baseUrl: string, accountId: string, accessToken: string, noteId: string): Promise<ObterAssinaturaResult>`
  (`api.ts`, S08-11) -- `GET /accounts/{accountId}/notes/{noteId}/signature`. Ver "Removido
  (S08-02), reposto no S08-11" abaixo.

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

## Decisões da fatia 5 (`nota-crypto.ts`/`api.ts`)

- **Molde literal de `entities/patient`, não uma forma nova.** `nota-crypto.ts` espelha
  `patient-crypto.ts` campo a campo (prefixo de AAD próprio, `selarAssinatura` chamando
  `webcrypto.encrypt` tal como `sealEntry` chama); `api.ts` espelha
  `entities/patient/api.ts` (`request` de `shared/api`, bytes em base64 via
  `shared/lib/base64`, `ProblemResult` no caminho não-2xx). Zero primitiva nova em
  `packages/crypto`: `selarAssinatura` reusa `webcrypto.encrypt`, que já existia.
- **`selarAssinatura` cifra o *digest*, não o texto canónico nem a nota inteira.** A AAD
  (`noteId`+`revisao`) já ata a assinatura a uma nota e revisão específicas; cifrar
  `digestNota(nota)` (32 bytes) em vez do texto completo mantém o blob de assinatura pequeno
  e fixo (60 bytes) -- o conteúdo integral da nota vive só na entrada de prontuário
  (`notaParaEntrada`), nunca duplicado dentro do próprio blob de assinatura.
- **`notaParaEntrada` não é `textoCanonico`, e são dois serializadores por escolha, não
  por descuido.** `textoCanonico` omite `noteId` de propósito -- é exatamente a
  superfície que a assinatura cobre. A entrada de prontuário precisa de saber a que nota
  pertence, então carrega `noteId` também. Fundir os dois obrigaria a assinatura a cobrir
  um campo (o id da nota) que não é conteúdo clínico.
- **`serializarFrases(frases)` (`nota.ts`, ronda 1 de correção) é a única parte comum aos
  dois.** O `frases.map(f => ({ secao, texto, ancoras: ... }))` estava copiado byte a byte
  entre `textoCanonico` e `notaParaEntrada` -- um campo novo em `FraseNota` atualizado só
  num dos dois divergiria em silêncio, sem teste a apanhar. Extraído para `nota.ts` (onde
  `FraseNota` já vive) e chamado dos dois lados; a saída de nenhum dos dois serializadores
  mudou um único byte -- assinaturas já produzidas dependem disso, e os testes existentes
  de `textoCanonico`/`nota-crypto` continuam verdes sem alteração.

## Decisões da fatia S08-06 (fundir `ItemFila` em `Nota`)

- **`EstadoNota`/`ESTADO_PENDENTE`/`ESTADO_ASSINADA` mudaram-se para aqui, vindos de
  `features/nota-fila/FilaAssinatura.tsx` (onde viviam como `EstadoNotaFila`/`ItemFila`).**
  `ItemFila { id, patientId, estado }` era a mesma entidade que `Nota` partida em duas
  coleções paralelas, com o mesmo `id` a servir de chave implícita entre elas e nada a
  garantir que concordassem -- ver a origem completa do defeito em
  `[[S08-06 Fundir ItemFila em Nota e eliminar as listas paralelas]]`. `estado` passou a
  campo de `Nota`; `ItemFila` deixou de existir. `FilaAssinatura`/`agruparPorPaciente`
  (`features/nota-fila`, `features/nota-biblioteca`) importam `EstadoNota`/
  `ESTADO_PENDENTE`/`ESTADO_ASSINADA` daqui, em vez de os redeclararem.
- **`rascunhoParaNota` agora devolve `estado: ESTADO_PENDENTE`.** Um rascunho recém-criado
  nasce sempre pendente -- a única mudança de comportamento desta fatia neste ficheiro
  (`digestNota`/`textoCanonico` continuam a ignorar `estado`, não faz parte da superfície
  assinada).

## Fora de âmbito

- UI de edição da nota, e a captura/transcrição de áudio — nenhuma delas é tocada aqui.
- Ligar `selarAssinatura`/`assinarNota` ao ecrã (gravar no prontuário antes de assinar,
  reagir a 409/falha de rede, marcar a nota como assinada na fila) -- isso é
  `pages/notas/NotaPage.tsx` (fatia 5), ver o README desse módulo.

## Removido (S08-02), reposto no S08-11

- **`obterAssinatura`/`ObterAssinaturaResult`** (`api.ts`) foram apagados no S08-02: nasceram
  na fatia 5 do S08-01 sem chamador ("fica pronto para..."), e continuaram sem nenhum até
  esse ticket -- reabrir uma nota já assinada era fluxo que ainda não existia em lado nenhum
  da app. O S08-11 repôs a função **com chamador**: `pages/notas/NotaPage.tsx` pergunta ao
  servidor no mount se a nota já está assinada, para o editor abrir em leitura apenas sem
  depender só do estado local (ver README de `pages/notas`). `GET
  /accounts/{accountId}/notes/{noteId}/signature` -- 404 `notes.signature_not_found` é o caso
  normal (nota por assinar).
  - `obterAssinatura(baseUrl: string, accountId: string, accessToken: string, noteId: string): Promise<ObterAssinaturaResult>`
    -- `ObterAssinaturaResult = { ok: true; noteId: string; revision: number; signedAt: string } | ProblemResult`.
    O blob `signature` do body é lido e descartado de propósito: decodificá-lo só serviria a
    uma verificação client-side que nenhum critério pede e nenhum chamador faz. Molde literal
    de `assinarNota`, logo acima no mesmo ficheiro.
