# Perfil de voz do profissional

**Objetivo:** cadastrar a voz uma vez, cifrar o vetor no navegador e identificar as falas do profissional em sessões presenciais sem guardar áudio.

**Arquitetura:** Nemotron mantém os locutores anônimos e os tempos; TitaNet Large executa em WebAssembly num worker local. `entities/voz` contém extração, validação, cifra e acesso ao perfil. A captura PCM compartilhada permanece sem persistência. A identificação incerta não autoriza análise do paciente.

**Contrato:** `docs/v1-criterios-de-aceite.md`. Execução nesta conversa, autorizada pelo pedido de finalizar a V1.

## Limites

- Vetor TitaNet: 192 números finitos, modelo SHA-256 `d51abcf31717ef28162f26acb9d44dd4127c3d44c9b8624f699f3425daca8e77` vinculado ao AAD.
- Amostra guiada de 15 segundos é uma escolha de produto, não um mínimo publicado pela NVIDIA.
- Similaridade absoluta mínima 0,7, conforme `EncDecSpeakerLabelModel.verify_speakers` da NVIDIA; margem entre candidatos 0,05. Isso não constitui validação em vozes humanas brasileiras.
- Sem voz correspondente, ou com candidatos ambíguos, não inferir o paciente. Havendo mais de duas vozes, apenas o profissional pode ser reconhecido automaticamente.
- Áudio, PCM e vetores abertos apenas em memória; API recebe dois blobs cifrados. Cancelamento encerra worker, microfone e buffers.

## Etapas e arquivos

- [x] Construir `tools/voice-identity/{embedding.cpp,CMakeLists.txt,Dockerfile,worker.js,setup.mjs}` e provar inferência real no navegador com quatro gravações sintéticas independentes.
- [x] Mover cifra e API para `apps/app/src/entities/voz/`, adicionar `modelo.ts`, `extrator.ts`, abertura do perfil, validação de 192 dimensões e testes de conta/modelo incorretos, corrupção, cancelamento e timeout. Interface: `criarExtratorVoz(signal): Promise<ExtratorVoz>`, com `extrair(pcm): Promise<number[]>` e `encerrar(): void`.
- [x] Corrigir `packages/diarization/src/classify.ts`: uma voz sem correspondência nunca é o profissional; uma terceira voz nunca é automaticamente paciente. Testar exemplos, entradas inválidas e propriedades.
- [x] Compartilhar captura PCM em `shared/audio/`; implementar `features/voice-enrollment/VoiceSettings.tsx` e cadastro em memória com consistência entre trechos; adicionar `/settings/voice` protegida e link na página inicial. Testar permissão negada, silêncio, cancelamento, substituição, remoção e resposta tardia após saída.
- [x] Adicionar reconhecimento em memória a `features/live-session/`: janela limitada de PCM, extração só de trechos estáveis de um locutor, associação automática e limpeza no encerramento. Preservar correção manual e bloquear insights para papel incerto.
- [x] Preparar o runtime no comando local `tools/dev.mjs`; executar testes, compilação, lint, dependências e navegação real de cadastro → sessão → saída → recuperação do perfil cifrado.

## Verificação

`pnpm --filter @limmiar/diarization test:unit`; `pnpm --filter app test:unit`; `pnpm --filter app build`; `pnpm --filter app lint`; `pnpm --filter app lint:i18n`; `pnpm --filter app lint:arch`; `pnpm --filter app check:i18n-complete`.

No navegador real: usar somente vozes sintéticas identificadas, confirmar cadastro cifrado de 796 bytes, ausência de upload de áudio do cadastro, separação automática com gravações independentes e limpeza dos recursos. Registrar limites da prova sem anunciar qualificação humana ou clínica.

## Evidência de execução

App: 1.079 testes, 116 arquivos, 100% de statements/branches/functions/lines. Diarização: 80 testes e 100% nas quatro métricas. TypeScript/Vite, lint e arquitetura sem erros; 344 mensagens completas por idioma. E2E real passou em aproximadamente 61 s: zero uploads de áudio do cadastro; perfil recuperado em outro navegador; papeis identificados em 25,4 s sem seleção manual; desktop/375px sem violações axe. Logs em .local/voz-*.log e .local/voz-perfil-v1-prova.json.

A identificação vocal depende do watermark de locutor estável, não de final_word_count (zero até o commit neste runtime). O teste inicial descobriu esse problema e foi corrigido; a prova posterior passou. Amostra inicial de 2 s pode ser substituída por trecho estável maior até 5 s. A qualificação humana da identificação e a qualificação clínica do juiz continuam pendentes no goal geral.

