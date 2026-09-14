# entities/patient

## Responsabilidade

Modelo e cifra de um paciente e do seu prontuário: o cliente HTTP (`api.ts`),
os primitivos de cifra por paciente (`patient-crypto.ts`), o resumo cifrado
usado no painel/carteira (`patient-summary.ts`, `decrypt-summaries.ts`) e o
Web Worker que roda essa decifragem fora da thread principal
(`patient-summary.worker.ts`, `worker-client.ts`). Zero React em qualquer
ficheiro; a única dependência cruzada é `@limmiar/crypto` (`webcrypto`,
`CryptoKey`) e `shared/api`/`shared/lib/base64`.

## Fluxo principal

1. `api.ts` — `createPatient`, `appendPatientEntry`, `getPatientRecord`,
   `listPatients`: cada um `POST`/`GET` num endpoint de
   `/accounts/{accountId}/patients...`, decodifica `wrappedDek`/`ciphertext`
   de base64 para `Uint8Array`. Nenhum campo clínico é propriedade própria do
   corpo — tudo vive dentro de `ciphertext`, opaco end-to-end.
2. `patient-crypto.ts` — `sealNewPatient`/`sealEntry`/`openRecord` envolvem
   `webcrypto` (wrap/unwrap DEK, encrypt/decrypt) com AAD por paciente
   (`patientDekAad`) e por entrada (`patientEntryAad`, inclui `sequence`);
   `openRecord` exige a sequência `1..N` contígua, sem furos.
3. `patient-summary.ts` — `SealedSummary`/`SummaryResult` (tipos) e
   `parseSummaryPlaintext` (falha fechada: JSON malformado, forma errada,
   risco desconhecido ou nome vazio devolvem `null`, nunca lançam);
   `sortByRisk` ordena por risco crescente, empate por nome (`pt-BR`),
   `ok:false` sempre por último.
4. `decrypt-summaries.ts` — `decryptSummaries` decifra um lote de
   `SealedSummary[]`, um resultado por item na mesma ordem; a falha de um
   item (KEK errada, ciphertext adulterado, motivo qualquer) nunca aborta o
   lote nem vaza o motivo — cai em `{ok:false}`.
5. `patient-summary.worker.ts` — andaime fino: `onmessage` chama
   `decryptSummaries` e devolve o resultado por `postMessage`. Roda a lógica
   real fora da thread principal sem duplicá-la (a lógica testável vive só em
   `decrypt-summaries.ts`).
6. `worker-client.ts` — `openSummariesInWorker` cria o `Worker`, envia
   `{kek, items}`, resolve no `onmessage`/rejeita no `onerror` e sempre
   termina o worker (`cleanup`) nos dois casos. Aceita um `AbortSignal`
   opcional: aborta o worker em voo, e — sem isso, o worker subiria para
   decifrar à toa — rejeita imediatamente, sem nunca criar o `Worker`, se o
   `signal` já chegar abortado (ver "Decisões").

## Pontos de entrada

- `createPatient`, `appendPatientEntry`, `getPatientRecord`, `listPatients`
  (`api.ts`).
- `sealNewPatient`, `sealEntry`, `openRecord`, `patientDekAad`,
  `patientEntryAad` (`patient-crypto.ts`).
- `parseSummaryPlaintext`, `sortByRisk`, `RISK_ORDER`, `SealedSummary`,
  `SummaryResult`, `PatientRisk` (`patient-summary.ts`).
- `decryptSummaries(kek, items): Promise<SummaryResult[]>`
  (`decrypt-summaries.ts`).
- `openSummariesInWorker(kek, items, signal?): Promise<SummaryResult[]>`
  (`worker-client.ts`) — consumido por
  `widgets/painel-profissional/PainelProfissional.tsx` (default de
  `openSummaries`, seam de teste) e `widgets/patient-wallet`.

## Decisões desta fatia

- **`openSummariesInWorker` verifica `signal?.aborted` antes de criar o
  `Worker`, além do listener de `'abort'`.** Um `AbortSignal` já abortado
  nunca dispara um novo evento `'abort'` — sem essa guarda de entrada, um
  cancelamento que chegasse tarde (efeito React já desmontado/trocado antes
  do chamador sequer invocar esta função) ainda subiria o worker para
  decifrar um resultado que ninguém vai usar. A guarda de entrada e o
  listener cobrem os dois momentos possíveis do abort: antes e durante.
