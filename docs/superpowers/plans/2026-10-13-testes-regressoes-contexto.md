# Testes das alterações do contexto Zen

**Goal:** cobrir os comportamentos alterados com regressões reproduzíveis, mantendo os serviços de uso parados.
**Architecture:** aproveitar Playwright com API/Postgres reais e fronteiras simuladas explícitas; integrar gateway/WebSocket/modelos nativos e API/jobs/extração real separadamente. Não duplicar os unitários existentes.
**Tech Stack:** Playwright, Vitest, unittest, FastAPI, sherpa-onnx, Postgres.
**Spec:** docs/handoff-codex.md e planos de ajustes Zen e identidade de voz de 13/10.

## Restrições

- Não alterar dados reais, não fazer commit/deploy nem reiniciar serviços de uso.
- Serviços temporários de teste terminam após a validação; banco isolado na porta 55432.
- Somente fixtures sintéticas; explicitar modelos/juiz simulados e limites humanos.
- Preservar revisão/assinatura explícitas, cifra e autorização por sessão.

## Cobertura a completar

- [x] Acervo E2E: upload inicia preparo antes da autorização, progresso real publicado aparece na tela, autorização/revogação independentes, falha e repetição; armazenamento cifrado.
- [x] Sessão E2E: seleção de uma entre duas obras limita consultas e persiste cifrada após reabrir.
- [x] Voz E2E: abertura atrasada conserva PCM, paciente não renumerado com terceiro, desconhecido não alimenta insights, silêncio excluído do tempo falado, tempos de reprodução preservados.
- [x] Encerramento E2E: captura para mas exige revisão, salva rascunho sem assinatura, falha de persistência não encerra, repetição e reabertura.
- [x] Histórico E2E: espaçamento/linha legível, estado encerrado e acesso por teclado/mobile.
- [x] Gateway integração: WebSocket real + Sessao + modelos nativos com duas vozes na mesma frase e cancelamento/limpeza.
- [x] Copiloto integração: rota multipart/jobs/extração/embedding simulado, progresso, deduplicação, autorização independente e exclusão durante preparo.
- [x] Executar unitários pertinentes já existentes; acrescentar apenas casos faltantes revelados pela integração.
- [x] Registrar evidências e limites por cenário, conferir serviços parados no fim.

## Arquivos

Novos: apps/app/e2e/regressoes-acervo-sessao.spec.ts, apps/app/e2e/regressoes-voz-encerramento.spec.ts, apps/gateway-fala/src/voz-websocket.integration.test.ts, mvp-copiloto/scripts/test_preparo_integracao.py.
Ampliar: apps/app/e2e/referencia-aprovada.spec.ts para seleção/reabertura, se a fixture existente reduzir duplicação.
Unitários existentes: transcrever-ao-vivo, blocos-transcricao, SessionReview, AtendimentoPage, encerrar-atendimento, transcricao, AcervoPage; gateway locutores/atribuicao/sessao/extrator; Python preparo/acervo/embedder.

## Execução

Playwright com E2E_API_PORTA=55259 e E2E_PG_PORTA=55432; subir somente limmiar-codex-e2e e parar em finally. Os processos WebServer do Playwright são temporários. Vitest gateway usa modelos previamente instalados, sem ASR/Docker. Python usa extração real e vetores sintéticos determinísticos; não carrega GPU/juiz.

## Matriz de regressão

| Comportamento | Prova principal | Limite da prova |
| --- | --- | --- |
| Upload e progresso/falha/repetição sem bloquear autorização | regressoes-acervo-sessao.spec.ts; test_preparo_integracao.py | E2E controla estados; integração usa PDF/HTTP/jobs reais e embedding determinístico |
| Seleção de uma entre duas obras e reabertura cifrada | referencia-aprovada.spec.ts | Resposta clínica do juiz simulada |
| Microfone durante abertura atrasada, silêncio e identidade na tela | regressoes-voz-encerramento.spec.ts | ASR/rótulos controlados, microfone/AudioWorklet/PCM reais com voz sintética |
| Separação acústica e perfil pelo WebSocket | voz-websocket.integration.test.ts; titanet.integration.test.ts | Modelos reais; ASR simulado e fixture sintética |
| Encerrar exige revisão, falha bloqueia conclusão, rascunho editável após login | regressoes-voz-encerramento.spec.ts | Armazenamento, cifra e assinatura reais; sem pacientes reais |
| Histórico legível, espaçamento, teclado e mobile | regressoes-voz-encerramento.spec.ts | Chromium 375px e desktop; não comprova Zen/4G |
| Lotes, deduplicação, FP16/FP32, limpeza e cancelamento | Unitários existentes + novas integrações | CPU/modelo de embedding simulado no Python; GPU já medida no contexto anterior |

Os unitários existentes já cobriam os ramos alterados; não foram duplicados. Novos nesta rodada: 3 cenários E2E, ampliação de 1 cenário E2E e 4 integrações. A integração do gateway entra no quality-gates com modelos verificados; o CI Python instala uvicorn e inclui o novo teste. O workflow manual do app prepara runtime/modelo de voz com cache, para os testes de voz não serem ignorados por ausência do modelo.

Validação concluída até aqui: app 1.984 testes com cobertura 100%; gateway 129 testes com cobertura 100%, incluindo modelos nativos; 121 testes leves Python. Cenários focados E2E aprovados após ajuste da fixture de fala e login de reabertura. Suíte E2E completa: 64 testes passaram em 2,6 min, sem ignorados. Serviços temporários encerrados; portas de uso/teste e containers do Limmiar conferidos parados.

CI remoto não foi executado: workflows revisados e YAML validado localmente. Voz humana, Zen real, 4G, carga concorrente e qualidade clínica do juiz continuam fora da prova automatizada desta rodada. Nenhum código de produto mudou nesta rodada; somente testes, fixtures, workflows e documentação. Sem commit/deploy.
