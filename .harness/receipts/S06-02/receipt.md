# Receipt — S06-02 Cadastro de voz + classificação binária + passe canônico

commit: 973eeaf
branch: feat/S06-01-merge-diarizacao
spec: S06 Diarização e transcrição canônica
rondas_review: 2

## Critério × prova × resultado

| Critério de aceite | Prova | Resultado |
|---|---|---|
| Teleconsulta com faixas separadas atinge 100% de acerto de atribuição | `packages/diarization/src/integracao.test.ts` — composição real de `atribuirLocutores` + `classificarLocutores` + `montarTranscricaoCanonica`, teleconsulta com 2 faixas bem separadas, 1/1 passed | PASS |
| Embedding de voz cifrado com a KEK, nunca em claro no servidor | `apps/app/src/voice/voice-enrollment.ts` — DEK fresca por `webcrypto.generateWrappedDek(kek, voiceDekAad)`, embedding cifrado via `webcrypto.encrypt(dek, plaintext, voiceEmbeddingAad)` antes do PUT; teste de segurança explícito confirma que o corpo do PUT nunca contém os valores numéricos do embedding; servidor (`VoiceEnrollmentService.cs`) só grava/lê `byte[]` opacos, nunca decifra | PASS |
| Todas as relações metamórficas do corpus sintético passam | `packages/diarization/src/classify.props.test.ts` — M1 permutação, M2 renomeação de id, M3 escala, M4 inversão do cadastrado, M5 empate→null, M6 ruído sub-margem, mais caso de score `NaN` (norma zero) acrescentado na ronda 1 → também `null`, 6/6 + 1 novo passed | PASS |
| Transcrição canónica completa persistida e cifrada, com locutor por trecho | `montarTranscricaoCanonica` colapsa sequências consecutivas por rótulo em `TrechoCanonico[]`; persistência usa `PatientRecordEntry` existente (cifrado, sem endpoint novo) — reuso confirmado em `canonico.test.ts` e no desenho do architect (etapa 4) | PASS |

## Pipeline

1. Handoff anterior (2026-08-20T2245) consumido: 4 fatias (A diarization, B session, C api, D app) já verdes com TDD e cobertura 100%, nenhum commit feito.
2. Etapa 7 — `reviewer-thermo` (thermo-nuclear na íntegra, diff agregado das 4 fatias).
3. **Ronda 1** — não aprovado, 4 bloqueantes:
   - B1 `Account.cs`: dois `byte[]?` soltos (`VoiceWrappedDek`/`VoiceEmbeddingSealed`) com invariante "ambos ou nenhum" só em prosa → colapsados num único `VoiceEnrollment? VoiceEnrollment` (record em `VoiceEnrollmentResult.cs`), compilador passa a garantir o invariante.
   - B2 `VoiceEnrollmentService.GetAsync`: `account!` sem checar null → `NullReferenceException` → 500 em conta desconhecida, inconsistente com `EnrollAsync`/`DeleteAsync` (404). Corrigido para `account?.VoiceEnrollment`, novo teste `GetVoiceEnrollment_WithUnknownAccountId_Returns404WithProblemDetails`.
   - B3 `classify.ts`: score `NaN` (vetor nulo/norma zero) escapava à checagem de ambiguidade e caía por omissão em `'paciente'` — atribuiria falas do profissional ao paciente sem sinal nenhum. Corrigido: `ambiguo = !(maior - segundo >= margemMinima)`, `NaN` passa a cair em ambíguo→`null`.
   - B4 `voice-enrollment.ts`: AAD única sem prefixo nem versão, mesma string para DEK e embedding — divergia de `patient-crypto.ts`/`copilot-crypto.ts`, README afirmava o contrário. Corrigido: `voice-crypto.ts` novo com duas AADs versionadas por contexto.
   - Os 3 pontos de atenção do handoff anterior (403 removido do PUT, DELETE 404 em vez de 204 silencioso, nomes do DTO `wrappedDek`/`sealedEmbedding`) foram confirmados corretos pelo reviewer, sem correção necessária.
   - Correções despachadas em 2 implementers paralelos sem overlap de ficheiros (B1+B2 em `apps/api`; B3+B4 em `packages/diarization`+`apps/app`). Ambas verdes.
4. **Ronda 2** — não aprovado, 1 bloqueante novo (B5, pré-existente da fatia D original, não introduzido pelas correções B1-B4): tipo local em `voice-enrollment.ts` descartava `problem.params` em 3 sítios, perdendo `params.field` que `translateProblemCode` precisa e que o próprio endpoint devolve em `validation.invalid_field`. `ProblemResult` de `client.ts` já tinha `params` mas não estava exportado — causa raiz do tipo substituto. B1-B4 confirmados de facto resolvidos por leitura do código; nenhuma correção introduziu problema novo; auditoria estrutural do diff total limpa.
5. Decisão do utilizador: corrigir B5 direto (remédio mecânico indicado pelo próprio reviewer, ~5 linhas: exportar `ProblemResult`, trocar 3 `return`s por `readProblem(response)`, `postJson` devolvido a privado) sem nova ronda-thermo — não conta como ronda 3, é fecho do último ponto verde (achado pré-existente que a ronda 1 não apanhou, não regressão da correção).
6. Sem ronda 3.

## Cobertura final

- `packages/diarization`: 40 testes, 100%/100%/100%/100%, mutação 97.56% (piso 95, 2 mutantes equivalentes documentados).
- `packages/session`: 35 testes, 100%/100%/100%/100%, mutação 96.26% (piso 95).
- `apps/api`: 485 testes, 100% linha/branch/método (piso do projeto).
- `apps/app`: 280 testes (36 ficheiros), 100%/100%/100%/100%.

## Não-bloqueantes registados (não corrigidos neste ticket)

- `VoiceEnrollment` (record de domínio) vive em `VoiceEnrollmentResult.cs` em vez de ficheiro próprio `VoiceEnrollment.cs` — descoberta pior, sem ganho.
- `EnrollAsync` devolve `VoiceEnrollmentResult` (`Succeeded`/`FailureReason`) que o chamador ignora e fixa em `AuthAccountNotFound` — `Task<bool>` bastaria, mas a forma é idêntica a `SubmitPairingPayloadResult`/`RegisterRecoveryVerifierResult` já existentes no repo; divergir aqui seria pior que a inconsistência.
- `classify.ts`: `sort` com comparador que pode devolver `NaN` — inofensivo com 2 candidatos (verificado), mas com ≥3 o resultado depende da engine. Judo sugerido: passagem única top-2 em vez de `sort`. Não aplicado — comportamento observável não muda para entradas reais (property-test exclui vetores nulos por construção).
- Comentário-lápide em `PatientEndpoints.cs` ("TryValidateSealedBlobShape moved to EndpointHelpers.cs…") — git já é dono dessa história, cosmético.
- `EndpointHelpers.cs`: justificação do `[ExcludeFromCodeCoverage]` enumera nomes de testes de dois ficheiros — vai apodrecer ao terceiro chamador, cortar para as 3 linhas que interessam.

## Achado fora de âmbito (não bloqueia este ticket)

`apps/app/src/devices/PairPrimaryDevice.test.tsx` — 2-3 testes intermitentes (role "status"/"alert" não encontrado). Confirmado via `git stash`/`stash pop` que já falhavam isoladamente no `HEAD` do branch antes de qualquer edição desta sessão, e passam na corrida completa — flakiness de ordem/paralelismo pré-existente, não relacionada a nenhuma das 4 fatias. Recomendação: `/plan:triage` ou ticket de bug separado.

## Handoff

Ticket S06-02 fechado sem trabalho pendente nele próprio — último ticket aberto de S06, fecha a spec. Próximo passo: cadeia de review por spec (linguagem + spec + excesso + segurança, 4 eixos paralelos sobre o diff agregado de toda a S06) antes de `/build:mr`. Ronda 2 atingida → `/build:friction` agendável.
