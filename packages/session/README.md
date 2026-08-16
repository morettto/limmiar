# @limmiar/session

## Responsabilidade

Statechart da sessão de atendimento (consentimento → aquecimento de modelo → gravação online/offline → pausa → encerramento), sem áudio, sem UI, sem `invoke` — ver [ADR-0008](../../docs/adr/0008-maquina-sessao-nao-invoca-atores.md). Testável em Node: todo efeito do mundo real (microfone, GPU, disco, chunks persistidos) entra como evento explícito enviado por um adapter fora deste package.

## Fluxo principal (`criarMaquinaSessao`)

1. `criarMaquinaSessao` é uma factory: a configuração inteira, `initial` incluído, é montada em runtime — `chunksOrfaos > 0` resolve `initial` para `recuperando`, senão para `aguardandoConsentimento`, sem precisar de estado transiente.
2. `aguardandoConsentimento` → `ativa.aquecendoModelo` em `CONSENTIMENTO_CONCEDIDO` (grava `consentimentoEm` com o relógio local — sinal de UI, não prova de consentimento, ver "Decisão em aberto"); `ENCERRAR` salta direto para `encerrado`.
3. Dentro de `ativa` (`aquecendoModelo` → `gravando.{online,offline}` com histórico raso → `pausado`), as três falhas de hardware/disco (`MICROFONE_REVOGADO`, `GPU_PERDIDA`, `DISCO_CHEIO`) e `ENCERRAR` estão declaradas uma única vez no `on` do estado composto — é o conjunto exato de estados que detém hardware ou escreve em disco.
4. `pausado.RETOMAR` volta a `gravando.historico` (estado history raso), não a `gravando.online` fixo — preserva se a sessão estava online ou offline antes da pausa.
5. `recuperando` (entrada só quando `chunksOrfaos > 0`) resolve em `RECUPERACAO_CONCLUIDA` (para `ativa.pausado`, regista `chunksPersistidos`) ou `RECUPERACAO_FALHOU` (para `interrompido`).
6. `interrompido` é o destino comum das quatro falhas (três de `ativa` mais `RECUPERACAO_FALHOU`); `TENTAR_NOVAMENTE` limpa `ultimaFalha` e volta a `ativa.aquecendoModelo`.
7. `encerrando` aguarda `FILA_DRENADA` para chegar a `encerrado`, estado final que absorve qualquer evento seguinte.

## Pontos de entrada

- `criarMaquinaSessao(opcoes?: CriarMaquinaSessaoOpcoes)` — constrói a máquina XState v5 (`setup` + `createMachine`), pronta para `createActor(...).start()`. `opcoes.consentimentoEm`, se passado, semeia o contexto inicial (ver "Decisão em aberto").
- Tipos: `SessaoContexto`, `SessaoEvento`, `Falha`, `Marco`, `CriarMaquinaSessaoOpcoes` (`src/types.ts`, zero import de `xstate` — regra aplicada por `pnpm lint:arch`, que casa contra o caminho resolvido em `node_modules/`, não contra o especificador bare).

## Decisões recentes relevantes

Nenhum `invoke`: a máquina não possui `MediaRecorder`, Worker de ASR, `navigator.permissions`, `GPUDevice` ou OPFS/Dexie. Esse adapter é trabalho de S05-02 — ver [ADR-0008](../../docs/adr/0008-maquina-sessao-nao-invoca-atores.md) para o porquê e o trade-off.

`machine.paths.test.ts` usa `@xstate/test` com `serializeState` ignorando o contexto (só a topologia de `state.value`) — eventos de transição interna como `CHUNK_PERSISTIDO`/`MARCAR_MOMENTO` mudam contexto sem mudar estado, e incluí-los na serialização faria a travessia nunca terminar.

## Decisão em aberto (precisa de dono de produto/segurança, não decidida nesta ronda)

`recuperando` chega a `ativa` (via `RECUPERACAO_CONCLUIDA` → `ativa.pausado`, ou via `interrompido` → `TENTAR_NOVAMENTE` → `ativa.aquecendoModelo`) sem nunca passar por `CONSENTIMENTO_CONCEDIDO`. Isto é o comportamento exato descrito na tabela de mesa do ticket S05-01 (linhas 16 e 19) e está implementado como tal — não foi alterado nesta ronda porque a tabela é o portão de desenho já fechado antes da implementação.

O que fica em aberto: sem `opcoes.consentimentoEm`, uma sessão recuperada chega a `ativa` com `consentimentoEm: null` — indistinguível, só pelo contexto, de uma sessão que nunca teve consentimento. `opcoes.consentimentoEm` existe para o adapter de S05-02 poder passar o consentimento que já sabia (lido junto ao registo persistido dos chunks órfãos) — mas nada nesta máquina *exige* que seja passado, nem impede `ativa` de ser alcançado sem ele. Se isso deve bloquear a transição (voltar a `aguardandoConsentimento` em vez de `ativa` quando não há consentimento herdado) é uma mudança de comportamento da tabela de mesa, fora do âmbito deste ticket — decisão de produto/legal (consentimento é requisito de base legal para dados de saúde, LGPD art. 11 / GDPR art. 9), não técnica.
