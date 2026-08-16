# Receipt — S03-01 Modelo append-only cifrado + criar/ler paciente

commit: 148809d208db2663a4c67bc03a1cbdf48b1d14b0
branch: feat/S03-01-modelo-append-only-paciente
spec: S03 Pacientes e prontuário
rondas_review: 1

## Critério × prova × resultado

| Critério de aceite | Prova | Resultado |
|---|---|---|
| Criar paciente gera DEK e nenhum campo clínico trafega em claro | `apps/app/src/patients/patient-crypto.test.ts` (seal/open real via WebCrypto, ciphertext não contém plaintext) + `PatientEndpointsTests.PostPatient_ThenGet_RoundTripsCiphertext_WithNoPlaintextInAnyResponseBody` (AES-256-GCM real gerado no teste C#, corpo da resposta sem o marcador, decifrado de volta fora do processo do servidor) | PASS |
| Nenhuma operação consegue sobrescrever entrada de prontuário, nem por API direta | 3 camadas: rotas só `MapPost`/`MapGet` (nunca PUT/PATCH/DELETE); `REVOKE UPDATE, DELETE` do `app_role` na migração 0002, provado em `PatientRecordEntriesRlsTests.AsAppRole_Direct{Update,Delete}_FailsWithPermissionDenied`; `UNIQUE(tenant_id, patient_id, sequence)` + validação de sequência estrita (`sequence == last+1`, senão 409/400) em `PatientService.AppendEntryAsync` | PASS |
| Testcontainers: RLS impede o profissional A de ler a ficha do profissional B | `PatientRecordEntriesRlsTests.ProfessionalB_ReadsProfessionalAsPatient_SeesNoRows` (nível store) + `PatientEndpointsTests.GetPatient_ForAnotherProfissionalsPatient_Returns404WithProblemDetails` (nível HTTP, adicionado na review) | PASS |
| Golden master da projeção append-only sobre um conjunto fixo de entradas | `PatientRecordProjectionGoldenTests` — conjunto fixo, fora de ordem, sem sequence 1, sequence 1 sem DEK | PASS |

## Pipeline

1. Forma aprovada por `architect` antes de código (show-me) — schema event-sourced de uma tabela só, sem `patients` separada, sem coluna `aad`.
2. Duas decisões de arquitetura levadas ao humano antes de construir: usar `webcrypto.ts` (CryptoKey não-extraível) em vez de `keychain.ts` (bytes crus, gap conhecido, não religado); `tenant_id` = id da conta do profissional (não `clinic_id`, prematuro).
3. Construção `lean-build` + TDD via `implementer` (2 sessões — a 1ª bateu limite de sessão do provedor após só a migração, retomada do zero com contexto explícito do que já existia).
4. Ambiente sem .NET SDK e sem Docker — instalados nesta sessão (winget: SDK 10.0.400, Docker Desktop + WSL2, com o humano a executar os passos que exigiam elevação).
5. Cadeia de review (6 eixos, paralelo): `review-dotnet-csharp`, `review-typescript-react`, `review-sql-data`, `reviewer-thermo`, `reviewer-spec`, `reviewer-lean`, `reviewer-security`.
   - **Ronda 1** — bloqueantes convergentes de múltiplos eixos: `sequence` do cliente sem validação (paciente ficava 404 permanente e irrecuperável, ou 500 genérico em sequence=1 — achado por C#, thermo, spec E security independentemente); `AppendEntryAsync`/`GetPatientAsync` sem o guard de autorização que `CreatePatientAsync` tem (security); custo O(n) no append só para checar existência (thermo); `base64` duplicado em `client.ts` depois do import do canónico (thermo + TS); padrão `set_config`/transação copiado 3x, README institucionalizando a cópia (thermo); teste do critério 1 não provava cripto real, só ausência de substring (spec); "listar" pacientes citado na descrição da spec mas fora dos 4 critérios formais — resolvido como âmbito do S03-02 (Carteira), não deste ticket. Corrigidos: `CHECK (sequence >= 1)` na migração + validação estrita `sequence == last+1` no serviço (409 se reutiliza/anterior, 400 se abre buraco); guard adicionado ao append, decisão documentada de NÃO exigir no read; `GetLastSequenceAsync` (MAX, não lista as linhas); `passwordVerifierToBase64` apagado, callers em `encodeBase64`; `OpenTenantScopedTransactionAsync` extraído para `Api/Data`, README aponta para o helper; teste de round-trip C# reescrito com AES-256-GCM real via `System.Security.Cryptography.AesGcm`, decifrado fora do servidor.
   - Não-bloqueantes corrigidos de brinde (baratos, no mesmo diff): validação de tamanho mínimo (28 bytes, piso do AES-GCM) em `wrappedDek`/`ciphertext`; `openRecord` valida contiguidade 1..N antes de decifrar (trunca/buraco no meio vira erro, não registo incompleto silencioso); testes de rejeição de AAD cross-patient/cross-sequence; `Buffer.from` (global Node) trocado por hex manual no teste TS; `NpgsqlDataSource` não descartado no teste de RLS; `byte[]` sem igualdade estrutural em record documentado.
   - Não-bloqueantes adiados (não corrigidos neste ticket): cadeia de integridade completa entre entradas (hash da anterior no AAD, provaria omissão no *fim*, não só no meio) — precisa de decisão de ADR, fica para ticket próprio; `IsAuthorizedForAccount`/`ProblemJson` continua duplicado pela 4ª vez entre ficheiros de endpoint.
   - Sem ronda 2 — nenhum achado novo introduzido pela ronda 1 (reverificado com suite completa + cobertura 100% depois de cada lote de correções).
6. Verificação final: `dotnet build`/`dotnet test` (440/440, 100% linha/branch/método, incluindo Testcontainers real) + `tsc -b`/`oxlint`/`vitest run --coverage` (206/206, 100% em statements/branches/functions/lines).

## Bug de causa-raiz corrigido de passagem

Migração `0003`: a política RLS de `health_check_probe` (ticket S00-04, já fechado) usava `current_setting('app.tenant_id', true)::uuid` sem guarda — sob reuso de ligação do pool do Npgsql, uma transação que já chamou `set_config` localmente deixa a GUC resetar para `''` (não `NULL`) para a transação seguinte que não a define, e o cast `::uuid` rebenta com `22P02` em vez de filtrar para zero linhas. Reproduzido de forma determinística assim que os testes deste ticket aumentaram o número de testes `[Collection("Database")]` a partilhar o mesmo pool. Corrigido com `NULLIF(current_setting(...), '')::uuid` — nova migração aditiva, não edita a `0001` já aplicada.

## Exclusões de cobertura

3 métodos `[ExcludeFromCodeCoverage]` em `PatientEndpoints.cs`, todos com justificação inline citando os testes que cobrem cada ramo nomeado: `TryValidateSealedBlobShape` (artefacto de merge do coverlet sob múltiplas instâncias de `WebApplicationFactory` na suite completa — comportamento confirmado correto em execução isolada), `MapCreateFailureToProblem` e `MapAppendFailureToProblem` (fallback de switch expression gerado pelo compilador, inalcançável dado que os enums só têm os valores nomeados, todos cobertos por teste dedicado).

## Cobertura final

C#: 440/440 testes, 100% linhas/branches/métodos (per-file, Api.csproj). TS: 206/206 testes, 100% statements/branches/functions/lines.

## Documentação

`apps/api/README.md` (criado — primeiro README do módulo), `ARCHITECTURE.md` (linha de `apps/api` apontada para o README novo).

## Handoff

Nenhum — ticket fechado sem trabalho pendente. `packages/crypto/src/keychain.ts` continua como gap arquitetural conhecido (não escopo deste ticket, registado no S01-05/S01-06 originalmente).

## Nota de processo

Sessão longa e com fricção de ambiente real (limite de sessão do implementer, .NET SDK e Docker Desktop ausentes na máquina, WSL2 sem virtualização habilitada) — candidato a `/build:friction` pelo tempo perdido em setup, não pela dificuldade do ticket em si.
