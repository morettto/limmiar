# api

## Responsabilidade

Cliente HTTP puro para `apps/api`: uma função por endpoint (`register`, `login`, `createPatient`, `cadastrarVoz` em `../voice/voice-enrollment.ts`, etc.), sempre devolvendo `{ ok: true; ... }` ou `{ ok: false; code; params }` -- nunca lança para uma resposta HTTP não-2xx esperada (erro de rede/parse continua lançando). Nenhuma tradução de mensagem acontece aqui -- `code`/`params` crus são repassados para a camada de UI, que os traduz via `errors/problem-messages.ts` (`translateProblemCode`).

## Fluxo principal

1. `postJson` (privada, só usada dentro deste arquivo) e `putJson`/`getJson`/`deleteRequest` (exportadas) são os únicos pontos que chamam `fetch()` -- anexam `Content-Type: application/json` e, quando há token, `Authorization: Bearer {token}`. Toda função de endpoint monta o corpo/path e delega a um destes.
2. `readProblem(response)` (exportado) faz o parse do corpo `problem+json` de uma resposta não-2xx e devolve `{ ok: false, code, params }` -- o formato do `ProblemDetails` do lado .NET. O tipo `ProblemResult` (`{ ok: false; code; params }`) também é exportado para que outros módulos tipem seus resultados sobre o mesmo formato em vez de reinventar um subconjunto sem `params`.
3. Bytes opacos (chaves embrulhadas, ciphertext) trafegam sempre em base64 (`../devices/base64.ts`) -- nenhum campo clínico ou segredo é uma propriedade de request/response por si só, só dentro do blob cifrado.
4. Outros módulos com sua própria chamada de API (ex.: `../voice/voice-enrollment.ts`) reusam `putJson`/`getJson`/`deleteRequest`/`readProblem`/`ProblemResult` em vez de reimplementar fetch/parsing de erro -- este módulo é o único lugar que fala `fetch()` diretamente com `apps/api`.

## Pontos de entrada

- `putJson`, `getJson`, `deleteRequest`, `readProblem`, tipo `ProblemResult` -- wrappers de fetch/erro reusáveis por outros módulos. `postJson` não é exportada: só `register`/`login`/`continueWithGoogle`/etc. (POST) a chamam, todos definidos neste mesmo arquivo.
- Uma função por endpoint: `getHealthDb`, `register`, `login`, `continueWithGoogle`, `beginTotpEnrollment`, `confirmTotpEnrollment`, `verifyTotpChallenge`, `createPairingSession`, `claimPairingSession`, `getPairingClaimStatus`, `submitPairingPayload`, `fetchPairingPayload`, `requestMagicLink`, `verifyMagicLink`, `recoverAccess`, `createPatient`, `appendPatientEntry`, `getPatientRecord`, `listPatients`, `registerRecoveryPhrase`, `completeWebAuthnCeremony`.
- `client.pact.test.ts` -- contrato Pact consumer/provider com `apps/api` sobre `getHealthDb`/`login`/`register` (grava/lê `pacts/limmiar-app-limmiar-api.json`, verificado do lado .NET separadamente).

## Decisões relevantes

`getJson`/`readProblem` eram funções privadas do módulo até a fatia S06-02-D acrescentar `putJson`/`deleteRequest`; as quatro passaram a ser exportadas (junto do tipo `ProblemResult`) na mesma fatia para que `../voice/voice-enrollment.ts` (o primeiro consumidor fora deste arquivo a precisar de PUT/DELETE) reusasse a mesma lógica de fetch/erro e o mesmo formato de resultado em vez de duplicá-los. `postJson` ficou privada -- nenhum consumidor externo faz POST através deste cliente ainda; se um precisar, exportar então.

**Correção B5 (ronda 2)**: `ProblemResult` não era exportado, então `voice-enrollment.ts` tinha inventado um tipo local `{ ok: false; code: string }` sem `params` e descartava `problem.params` nos três `return` de erro -- a UI nunca poderia montar `translateProblemCode(code, params, i18n)` para o `validation.invalid_field` que o endpoint de voz devolve. Corrigido exportando `ProblemResult` e trocando os três `return { ok: false, code: problem.code }` por `return readProblem(response)` em `voice-enrollment.ts`.
