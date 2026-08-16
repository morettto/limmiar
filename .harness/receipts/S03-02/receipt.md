# Receipt — S03-02 Carteira com AdaptiveTable ordenada por risco

commit: bd91747e69722d5281d1ad48172c0fe00b6fb893
branch: feat/S03-01-modelo-append-only-paciente
spec: S03 Pacientes e prontuário
rondas_review: 1

## Critério × prova × resultado

| Critério de aceite | Prova | Resultado |
|---|---|---|
| Ordenação por risco por omissão, calculada no cliente | `patient-summary.test.ts` (`sortByRisk`: elevado→moderado→baixo, desempate por nome pt-BR, `ok:false` sempre por último, não muta) + `PatientWallet.test.tsx` ("renders ready rows sorted by risk") — servidor devolve `ORDER BY created_at DESC`, não por risco (`PatientRecordStore.cs`) | PASS |
| `AdaptiveTable` verde nos 4 breakpoints, alvo 44px em `pointer:coarse` | `AdaptiveTable.test.tsx` cobre xl/lg/md/sm explicitamente, `pointer-coarse:h-11` citado no nome do teste | PASS |
| Chaveiro travado: a carteira não exibe sequer os nomes | `PatientWallet.test.tsx` ("kek=null: shows the locked state immediately, calls neither fetch nor openSummaries") — nem `fetch` nem `openSummaries` disparam | PASS |
| Carga: 500 pacientes decifrados em Worker sem travar a UI | `worker-client.test.ts` ("decrypts a 500-item batch through a real Worker") — Worker real via `@vitest/web-worker` (worker_threads, não mock), ordem preservada, item com KEK errada isolado sem abortar o lote | PASS |

## Pipeline

1. Turno anterior (`.harness/receipts/S03-02/trace.log`) cortou por limite de sessão do provedor a meio do ticket, sem commit — retomado do zero via `.harness/checkpoint.json` (`ticket_atual: S03-02`) e levantamento completo do diff não commitado antes de tocar em código.
2. Levantamento (subagente Explore, read-only): 3 dos 4 critérios já implementados e testados; gap identificado era cobertura, não lógica — `worker-client.ts`/`patient-summary.worker.ts` sem teste próprio, o que faria o portão de cobertura (100% per-file) falhar no commit. Achados soltos: `CONTRACT.md`/`kill.sh` na raiz (artefactos do turno AFK anterior, nunca no git) — apagados por decisão do humano.
3. Fechado o gap: `@vitest/web-worker@4.1.10` (pacote oficial Vitest, roda o Worker dedicado via `worker_threads`, não um mock) adicionado como devDependency de `apps/app`. Dois ficheiros de teste novos (`worker-client.test.ts`, `patient-summary.worker.test.ts`) mais 4 testes novos em `PatientWallet.test.tsx` (path default sem seam, 3 branches de cancelamento por unmount a meio do fetch/decrypt/rejeição).
4. `dotnet test` (445 testes) revelou 1 branch morta em `PatientRecordStore.ListCreationEntriesAsync`: o ternário `IsDBNull(4) ? null : ...` para `WrappedDek` é logicamente inalcançável ali — a query filtra `WHERE sequence = 1` e a check constraint `wrapped_dek_only_on_sequence_1` (migração 0002) garante `WrappedDek` sempre não-nulo nessas linhas. Corrigido na raiz (cast direto), não com teste artificial para um caminho impossível.
5. Review-chain (2 eixos, paralelo): `reviewer-lang` (C#) sem achados; `reviewer-lang` (TS/React) achado não-bloqueante — `openSummariesInWorker` não tinha forma de cancelar; um unmount a meio da decifra deixava o Worker a correr até terminar sozinho, sem ninguém a ler o resultado. Corrigido: `openSummariesInWorker` aceita `AbortSignal` opcional, `PatientWallet` liga um `AbortController` ao cleanup do `useEffect`. Novo branch coberto por teste dedicado em `worker-client.test.ts`.
6. Verificação final: `dotnet test` (445/445, 100% linha/branch/método) + `tsc -b` limpo + `vitest run --coverage` em `apps/app` (235/235, 100% statements/branches/functions/lines) e `packages/ui` (91/91, 100%).

## Cobertura final

C#: 445/445 testes, 100% linhas/branches/métodos (Api.csproj, coverlet).
TS `apps/app`: 235/235 testes, 100% statements/branches/functions/lines (istanbul, per-file).
TS `packages/ui`: 91/91 testes, 100% (istanbul, per-file).

## Handoff

Nenhum — ticket fechado sem trabalho pendente. Próximo ticket agarrável: `S04-02` (Conflito transacional sob concorrência real, `pronto: frontier`, sem bloqueadores).
