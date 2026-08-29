# @limmiar/session

## Responsabilidade

Statechart da sessão de atendimento (consentimento → aquecimento de modelo → gravação online/offline → pausa → encerramento), sem áudio, sem UI, sem `invoke` — ver [ADR-0008](../../docs/adr/0008-maquina-sessao-nao-invoca-atores.md). Testável em Node: todo efeito do mundo real (microfone, GPU, disco, chunks persistidos) entra como evento explícito enviado por um adapter fora deste package.

## Fluxo principal (`criarMaquinaSessao`)

1. `criarMaquinaSessao` é uma factory: a configuração inteira, `initial` incluído, é montada em runtime — `chunksOrfaos > 0` resolve `initial` para `recuperando`, senão para `aguardandoConsentimento`, sem precisar de estado transiente.
2. `aguardandoConsentimento` → `ativa.aquecendoModelo` em `CONSENTIMENTO_CONCEDIDO` (grava `consentimentoEm` com o instante do servidor, vindo do próprio evento — ver "Decisão fechada — guard `temConsentimento`"); `ENCERRAR` salta direto para `encerrado`.
3. Dentro de `ativa` (`aquecendoModelo` → `gravando.{online,offline}` com histórico raso → `pausado`), as três falhas de hardware/disco (`MICROFONE_REVOGADO`, `GPU_PERDIDA`, `DISCO_CHEIO`) e `ENCERRAR` estão declaradas uma única vez no `on` do estado composto — é o conjunto exato de estados que detém hardware ou escreve em disco.
4. `pausado.RETOMAR` volta a `gravando.historico` (estado history raso), não a `gravando.online` fixo — preserva se a sessão estava online ou offline antes da pausa.
5. `recuperando` (entrada só quando `chunksOrfaos > 0`) resolve em `RECUPERACAO_CONCLUIDA` (regista `chunksPersistidos` sempre; com consentimento herdado no contexto vai a `ativa.pausado`, senão a `aguardandoConsentimento` — guard `temConsentimento`) ou `RECUPERACAO_FALHOU` (para `interrompido`).
6. `interrompido` é o destino comum das quatro falhas (três de `ativa` mais `RECUPERACAO_FALHOU`); `TENTAR_NOVAMENTE` limpa `ultimaFalha` sempre, e volta a `ativa.aquecendoModelo` só com consentimento herdado no contexto (guard `temConsentimento`), senão a `aguardandoConsentimento`.
7. `encerrando` é composto: `drenandoFila` aguarda `FILA_DRENADA` e passa a `passeCanonico`, que aguarda o passe canónico (merge de diarização + timestamps, corre fora da máquina) via `PASSE_CANONICO_CONCLUIDO` ou `PASSE_CANONICO_FALHOU` (regista `ultimaFalha: { tipo: 'passe-canonico-falhou', motivo }`) — ambos os ramos chegam a `encerrado`, estado final que absorve qualquer evento seguinte. Falha do passe não volta a `interrompido`: a gravação já está em disco e `TENTAR_NOVAMENTE` reabriria `ativa.aquecendoModelo` (e o microfone) à toa — decisão do ticket S06-02.

## Pontos de entrada

- `criarMaquinaSessao(opcoes?: CriarMaquinaSessaoOpcoes)` — constrói a máquina XState v5 (`setup` + `createMachine`), pronta para `createActor(...).start()`. `opcoes.consentimentoEm`, se passado, semeia o contexto inicial e é o que faz o guard `temConsentimento` deixar uma sessão recuperada chegar a `ativa` (ver "Decisão fechada — guard `temConsentimento`").
- Tipos: `SessaoContexto`, `SessaoEvento`, `Falha`, `Marco`, `CriarMaquinaSessaoOpcoes` (`src/types.ts`, zero import de `xstate` — regra aplicada por `pnpm lint:arch`, que casa contra o caminho resolvido em `node_modules/`, não contra o especificador bare).
- `state.matches('encerrando')` continua a valer nos dois sub-estados (`drenandoFila`, `passeCanonico`) — usar `matches`, não igualdade direta com `snapshot.value`, para código que só precisa saber que a sessão está a encerrar sem se importar em que sub-estado.

## Decisões recentes relevantes

Nenhum `invoke`: a máquina não possui `MediaRecorder`, Worker de ASR, `navigator.permissions`, `GPUDevice` ou OPFS/Dexie. Esse adapter é trabalho de S05-02 — ver [ADR-0008](../../docs/adr/0008-maquina-sessao-nao-invoca-atores.md) para o porquê e o trade-off.

`machine.paths.test.ts` usa `@xstate/test` com `serializeState` ignorando o contexto (só a topologia de `state.value`) — eventos de transição interna como `CHUNK_PERSISTIDO`/`MARCAR_MOMENTO` mudam contexto sem mudar estado, e incluí-los na serialização faria a travessia nunca terminar.

## Decisão fechada — guard `temConsentimento` (S10-02, fatia 5)

`recuperando.RECUPERACAO_CONCLUIDA` e `interrompido.TENTAR_NOVAMENTE` já não alcançam `ativa` sem prova de consentimento no contexto. O guard `temConsentimento` (`context.consentimentoEm !== null`) decide entre dois ramos em cada uma dessas transições: com consentimento herdado, o alvo é o mesmo de sempre (`ativa.pausado` / `ativa.aquecendoModelo`); sem ele, o alvo passa a ser `aguardandoConsentimento`. Em ambos os ramos a `assign` de dados (`chunksPersistidos`, `ultimaFalha: null`) mantém-se — o desvio para `aguardandoConsentimento` não apaga o que já estava em disco nem reabre a falha anterior.

`CONSENTIMENTO_CONCEDIDO` deixou de carimbar `consentimentoEm` com `new Date().toISOString()` (relógio local, sinal de UI); o evento passa a exigir `concedidoEm: string`, o instante devolvido pelo servidor (`RecordConsentResponse.recordedAt`, ver `ConsentEventStore.InsertAsync` em `Api.Consent`) — é essa string que a `assign` grava no contexto.

Isto fecha o buraco descrito na decisão 3 do desenho de S10-02: sem essa mudança, uma sessão recuperada ou reaberta após falha chegava a `ativa` com `consentimentoEm: null`, indistinguível de uma sessão que nunca teve consentimento algum. O ADR da decisão irmã (consentimento em claro no servidor, por finalidade) é [ADR-S10-02](../../docs/adr/ADR-S10-02-consentimento-em-claro-por-finalidade.md); o portão do microfone em si (`abrirMicrofone`, `features/live-session/microfone.ts`) é a outra metade, fora deste package.

O que continua fora daqui, por não ser desta máquina: uma revogação a meio de uma gravação em curso não a mata (sem push/polling — o seam `MICROFONE_REVOGADO` já existe, o produtor é do S05-02); e o portão do copiloto para a finalidade `AnaliseIa` é da S07.
