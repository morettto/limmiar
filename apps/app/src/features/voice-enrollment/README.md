# voice

## Responsabilidade

Cliente puro (sem UI) do cadastro de voz: sela o embedding de voz do profissional sob uma DEK própria envelopada pela KEK, e fala com `/accounts/{accountId}/voice-enrollment` na `apps/api`. O embedding nunca trafega em claro -- mesma disciplina de `patients/patient-crypto.ts` e `copilot/copilot-crypto.ts` (DEK fresca por segredo, embrulhada pela KEK, AAD versionado por contexto, num ficheiro `*-crypto.ts` irmão separado do módulo HTTP).

Esta fatia (S06-02, fatia D) é deliberadamente só o cliente: o `.tsx` de captura/cadastro de voz depende de captura de áudio (S05-02, ainda não pronta) e fica fora de âmbito -- decisão já tomada no portão de forma, não redecidida aqui.

## Fluxo principal

1. `cadastrarVoz(baseUrl, accountId, token, kek, embedding)` -- gera uma DEK nova (`webcrypto.generateWrappedDek(kek, voiceDekAad(accountId))`), serializa `embedding: readonly number[]` como `Float32Array` e cifra (`webcrypto.encrypt(dek, plaintext, voiceEmbeddingAad(accountId))`), depois `PUT /accounts/{accountId}/voice-enrollment` com `{ wrappedDek, sealedEmbedding }` (ambos base64, mesma convenção de `createPatient`). As duas AADs vêm de `voice-crypto.ts`, cada uma com o seu prefixo versionado (`limmiar/voice-dek/v1|` e `limmiar/voice-embedding/v1|`) -- mesmo padrão de `patient-crypto.ts`/`copilot-crypto.ts`: o wrap da DEK e o encrypt do embedding nunca partilham a mesma AAD, então um envelope e um embedding cifrado não são intercambiáveis entre si mesmo dentro da mesma conta, e um blob trocado ou reproduzido de outra conta falha ao decifrar em vez de abrir silenciosamente.
2. `obterCadastroVoz(baseUrl, accountId, token)` -- `GET` no mesmo endpoint, devolve `{ ok: true, wrappedDek, sealedEmbedding }` (bytes decodificados de base64) ou o `ProblemResult` (`{ ok: false, code, params }`) vindo do corpo `problem+json` (ex.: 404 quando ainda não há cadastro).
3. `removerCadastroVoz(baseUrl, accountId, token)` -- `DELETE`, mapeia `204` para `{ ok: true }`.
4. As três funções reusam `getJson`/`putJson`/`deleteRequest`/`readProblem`/`ProblemResult` exportados de `../api/client.ts` -- nenhuma lógica de fetch/erro é duplicada aqui, e os três `return` de erro devolvem `readProblem(response)` inteiro (com `params`), não um subconjunto `{ ok: false, code }` local.

## Pontos de entrada

- `cadastrarVoz`, `obterCadastroVoz`, `removerCadastroVoz`, tipo `ObterCadastroVozResult` (`voice-enrollment.ts`).
- `voiceDekAad`, `voiceEmbeddingAad` (`voice-crypto.ts`).

## Decisões relevantes

`putJson`/`deleteRequest` foram acrescentados a `api/client.ts` (junto de `getJson`/`readProblem`, agora exportados) em vez de reimplementados aqui -- o repo já centraliza o wrapper de fetch/erro em `client.ts`; nenhum outro módulo do app faz sua própria chamada de rede com parsing de `problem+json`. `postJson` continua privada de `client.ts`: este módulo nunca faz POST.

**Nomes de campo do DTO confirmados**: os nomes `wrappedDek`/`sealedEmbedding` batem com `VoiceEnrollmentRequest(WrappedDek, SealedEmbedding)` do lado `apps/api` -- a fatia C já fechou, sem divergência. O `code` de "sem cadastro" no `GET` 404 é apenas repassado do corpo `problem+json` do servidor (mesmo padrão de todo o resto de `client.ts`), sem tradução/hardcode de `'nao-encontrado'`.

**Correção B5 (ronda 2)**: os três `return` de erro descartavam `problem.params` ao devolver `{ ok: false, code: problem.code }` sobre um tipo local `VoiceEnrollmentResult`/`ObterCadastroVozResult` que nem incluía `params` -- quebrando `translateProblemCode(code, params, i18n)` para o `validation.invalid_field` que o endpoint devolve com `params.field`. Corrigido reusando o `ProblemResult` exportado de `../api/client.ts` e devolvendo `readProblem(response)` diretamente, em vez de reconstruir um subconjunto do resultado.

A KAT (known-answer-test) de `cadastrarVoz` pina o IV via `crypto.getRandomValues` (o único ponto de injeção alcançável a partir de `apps/app` -- o seam `__setIvSourceForTests` de `packages/crypto/src/webcrypto.ts` não é reexportado do barrel do pacote) e o comprimento exato dos dois blobs cifrados; o material da própria DEK é gerado por `crypto.subtle.generateKey` (CSPRNG, sem hook de injeção), então um KAT byte-a-byte do `wrappedDek` inteiro não é alcançável deste nível -- o teste completa a prova com um round-trip de decifragem pelas primitivas de produção.

**Correção ronda 2 (B4)**: a versão original usava `voice-enrollment:${accountId}` como AAD única para o wrap da DEK *e* para o encrypt do embedding -- sem prefixo `limmiar/`, sem versão, e a mesma string nos dois usos, divergindo de `patient-crypto.ts`/`copilot-crypto.ts`. Extraído para `voice-crypto.ts` (`voiceDekAad`/`voiceEmbeddingAad`), à imagem exata dos dois precedentes, para alinhar com o padrão do repo e para que o README deixasse de descrever um comportamento ("AAD versionado por contexto") que o código ainda não tinha.
