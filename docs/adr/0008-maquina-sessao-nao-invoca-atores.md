# ADR-0008 · Máquina de sessão não invoca atores

- Status: aceite
- Data: 2026-08-15
- Ticket: S05-01

## Contexto

A spec S05 exige uma máquina XState explícita para o ciclo de vida de uma sessão de atendimento com transcrição ao vivo, testável sem DOM (`packages/session`, framework-free, no padrão de `packages/agenda`). A topologia real da spec é AudioWorklet → Worker de ASR → main thread; a máquina de estados só coordena, não possui hardware nem IO.

O idioma habitual do XState para efeitos assíncronos (chamadas a APIs do browser, workers) é `invoke`: a máquina possui o ator, gere o seu ciclo de vida, e reage ao seu resultado.

## Decisão

A máquina de `packages/session` não usa `invoke`. Nenhum ator interno fala com `MediaRecorder`, o Worker de ASR, `navigator.permissions`, `GPUDevice` ou OPFS/Dexie. Todo efeito do mundo real entra como evento explícito enviado por um adapter que vive fora do package (`MICROFONE_REVOGADO`, `GPU_PERDIDA`, `DISCO_CHEIO`, `CHUNK_PERSISTIDO`, `RECUPERACAO_CONCLUIDA`, `RECUPERACAO_FALHOU`, etc.).

## Porquê

- **Difícil de reverter.** Todo consumidor da máquina, a suíte `@xstate/test` inteira (que percorre estados alcançáveis via eventos), e o pipeline de S05-02 (AudioWorklet + Worker ASR) ficam amarrados a esta forma. Trocar para `invoke` mais tarde obriga a reescrever a superfície de eventos e os testes de caminho.
- **Contra-intuitivo sem este registo.** Um leitor familiar com XState espera `invoke` para efeitos assíncronos; a ausência dele aqui é deliberada, não esquecimento.
- **Trade-off real, não gratuito.** Ganha-se testabilidade total em Node — sem DOM, sem mocks de `MediaRecorder`/`GPUDevice`/OPFS — que é o requisito explícito do ticket S05-01 ("statechart testável sem DOM — coração do TDD desta spec"). Paga-se com um adapter fora do package que traduz `navigator.permissions`, `GPUDevice.lost`, `StorageManager.estimate()` e as mensagens do Worker de ASR em eventos da máquina. Esse adapter é trabalho de S05-02, não deste ticket.

## Consequências

- `packages/session` não depende de nenhuma API de browser — pode rodar e ser testado em qualquer ambiente Node.
- S05-02 tem de entregar o adapter (host) que observa hardware/disco e envia os eventos correspondentes à máquina.
- Qualquer novo modo de falha de hardware/disco no futuro entra como mais um evento no `on` do estado composto `ativa`, não como um novo `invoke`.
