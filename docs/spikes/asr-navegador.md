# Spike: ASR e diarizacao no navegador (2026-10-08)

Contexto: `docs/adr/ADR-0011-inferencia-no-navegador.md`. Harness e dados brutos: `.local/spike-asr/` (README la). Nada em `apps/`, `packages/` ou `mvp-copiloto/` foi alterado.

## Ambiente medido

- Edge 154 (Chromium) no Windows 11, GTX 1660 SUPER 6 GB (Turing), 16 GB RAM, 24 threads. Aberto com `--enable-unsafe-webgpu --enable-features=Vulkan,WebGPU --ignore-gpu-blocklist`. WebGPU funcionou (adaptador nvidia/turing, `shader-f16`, `subgroups`, `maxStorageBuffersPerShaderStage` = 16).
- onnxruntime-web 1.30.0 (ASR); transformers.js 4.3.1 com seu ORT-web 1.31.0-dev (diarizacao).
- Audio: voz TTS do Windows (Maria pt-BR; Zira en-US lendo portugues como segundo falante), 16 kHz mono. Nao ha voz humana nem celular nesta medicao.
- "Download" = tamanho dos arquivos; servidos de `localhost`, entao o tempo de rede NAO foi medido.

## 1. ASR Nemotron 3.5 0,6B INT4 (blocos de 560 ms, pt-BR, lang_id 12)

Pipeline implementado a mao (o model card so remete ao onnxruntime-genai): log-mel NeMo em JS, encoder com cache (65 quadros = 9 de pre-cache + 56 novos; 7 quadros de saida), RNNT guloso com decoder LSTM + joint, 2 blocos de silencio no fim para esvaziar. Mel entra no tempo de cada bloco (2,2 ms/bloco).

| Medida | WebGPU (encoder) + WASM (decoder/joint) | Tudo WASM |
|---|---|---|
| Download (encoder 693 MB, decoder 60 MB, joint 38 MB, vocab) | ~790 MB | ~790 MB |
| Carga do modelo (leitura local + criar sessao) | 3,35 s | 3,13 s |
| 1o bloco (compila shaders) | 1,04 s | 0,73 s |
| Atraso por bloco, p50 (21,5 s de audio) | **151 ms** | 604 ms |
| Atraso por bloco, p95 | **162 ms** | 659 ms |
| Maximo | 169 ms | 661 ms |
| Fator de tempo real (processamento / duracao) | **0,33** (0,36 no 2o audio de 13,9 s: p50 150, p95 164) | **1,17** (mais lento que o tempo real) |
| Encoder p50 / decoder+joint p50 por bloco | 136 / 12 ms | 589 / 13 ms |
| Memoria: processos do Edge (pico, antes 320 MB) | 1,25 GB | 1,59 GB |
| VRAM usada (pico, antes 2,15 GB de outros programas) | +0,78 GB | ~0 |
| Heap JS | 36 MB | 85 MB |

Atraso real da fala ao texto = espera do bloco (560 ms) + processamento (~150 ms) + latencia propria do RNNT, que nao foi medida separadamente.

**Corretude: parcial.** WER 37,8% (14/37) no audio de 21,5 s e 38,5% (10/26) no de 13,9 s, mesmos erros em WebGPU e WASM (numerica da GPU nao e a causa), e com lang_id 13/101 (pt-PT/auto) os erros caem nos mesmos trechos. Exemplo: "dor de cabeca" -> "dor de cabian"; "alteracao na visao" -> "altera an Libra". O modelo tambem emite tags `<pt-PT>` no texto (filtrar). O que NAO sei: se a causa e a voz TTS sintetica de baixa qualidade, a minha extracao de features (sem referencia NeMo para comparar bit a bit) ou o INT4. O numero de WER nao deve ser usado para decidir; precisa de fala humana real e do extrator oficial.

Achado de compatibilidade: o encoder original **nao roda em WebGPU**: um Concat de 24 entradas (cache por camada) pede 25 buffers de armazenamento e o limite do adaptador e 16 (padrao da especificacao: 8; celulares costumam ficar em 4 a 10). Reescrevi o grafo para arvores de Concat de ate 6 entradas (`split-concat.mjs`, so o `encoder.onnx`; pesos iguais). Sem isso a saida e vazia. Isso precisa virar um export oficial do modelo.

## 2. Diarizacao pyannote-segmentation-3.0 (transformers.js, fp32, 6 MB)

Audio de 42,9 s com 8 turnos de 4 a 6 s alternando duas vozes (pausa 0,3 s). Janelas de 10 s com passo de 5 s (8 janelas); saida de 7 classes de potencia (ate 3 falantes locais por janela).

| Medida | WASM | WebGPU |
|---|---|---|
| Download / carga | 5,9 MB / 0,53 s | 5,9 MB / 0,68 s |
| Latencia por janela de 10 s, p50 / p95 | **42 / 50 ms** | 496 / 512 ms |
| 1a janela | 85 ms | 1,05 s |
| Janelas com 2 falantes em ids locais distintos | 7 de 8 | 7 de 8 |
| Pureza dos quadros (turno dominado por um id) | 0,89 | 0,89 |
| Quadros de fala sobreposta detectados | 0 | 0 |

Separa os dois falantes dentro de cada janela. Em WebGPU fica 12x mais lento que em WASM (modelo pequeno, custo de lancamento e leitura da GPU), entao a diarizacao deve ficar em WASM. **Nao medido:** manter o mesmo falante entre janelas (precisa de embeddings de voz, ex. wespeaker; os ids 1..3 sao locais a cada janela), vozes humanas reais, fala sobreposta, identificar o profissional por perfil de voz, e o custo ASR + diarizacao ao mesmo tempo (a GPU de 6 GB tinha 2,15 GB ocupados por outros programas).

## O que nao foi medido

- Celular e tablet (nao ha aparelho; Edge de PC com GPU de mesa NVIDIA nao representa Adreno/Mali/Apple GPU).
- Download pela rede, cache do navegador (Cache API/OPFS) e carga a frio de 790 MB num aparelho com pouca RAM.
- Modelo em WebGPU com decoder/joint tambem em GPU (so o encoder foi para a GPU; o resto em WASM).
- Threads do WASM em celular (aqui o ORT usou o padrao num PC de 24 threads).
- Latencia do microfone ao vivo (AudioWorklet), VAD (silero_vad.onnx do pacote) e ASR + diarizacao + juiz juntos.

## Recomendacao

- **PC com GPU dedicada: viavel em tempo real.** ASR a ~150 ms por bloco de 560 ms (RTF 0,33) sobra folga de ~3x; diarizacao em WASM a 42 ms por janela de 10 s. Ressalva: depende do grafo do encoder corrigido (Concat) e de validar a qualidade em fala real.
- **WASM puro nao serve para o ASR** (RTF 1,17 mesmo com 24 threads): fica atras do audio. A reserva em WASM so existe para o aparelho transcrever com atraso crescente, ou nao vale a pena; sem WebGPU, o caminho realista e ASR no servico.
- **Celular: nao provado e arriscado.** Faltam: (1) medir num celular intermediario real; (2) 790 MB de download e ~1,2 GB de RAM no navegador e +0,8 GB de VRAM (celulares com navegador limitado a 1 a 2 GB por aba podem falhar); (3) limites de WebGPU menores que 16 buffers/estagio, o que exige o grafo reescrito e talvez mais cortes; (4) validar WER com fala humana; (5) cache persistente do modelo. Proximo passo direto: rodar `run-asr.mjs` equivalente num Android com Chrome (WebGPU) e num iPhone, e decidir entre INT4 maior reduzido, bloco de 1120 ms ou ASR no servico para aparelhos fracos.

## Motor no app (2026-10-08, tarefas 13, 16 e 17 do plano)

O que era spike virou código: `tools/asr-web` (export do encoder com Concat de até 6 entradas, hashes e `verificar.mjs`),
`apps/app/src/shared/audio/asr` (onnxruntime-web num Worker, mel contínuo, RNNT guloso, pyannote) e
`packages/diarization/src/pyannote*.ts` (janelas de 10 s a cada 5 s, identidade entre janelas pelo TitaNet).
O proxy e o caminho `/speech` saíram. O motor entra atrás de `SessaoTranscricao`, sem camada de compatibilidade.

**Medido (mesma máquina do spike: Edge 154, GTX 1660 SUPER 6 GB, 16 GB RAM, 24 threads; modelos servidos de localhost).**

| Medida | Resultado |
|---|---|
| Export do encoder | 2 Concat de 24 entradas viraram árvores de até 6; `encoder.onnx` de 390.583 bytes, idêntico bit a bit ao do spike; roda em WebGPU e em CPU |
| Texto, motor TS no Node (CPU, onnxruntime-node) | WER 37,8% e 38,5% nos dois áudios TTS, o mesmo do spike: o mel contínuo e o RNNT portados reproduzem o spike |
| Texto, Worker de produção no navegador | WebGPU: WER 35,1% (fala 1); só WASM: 38,5% (fala 2). Troca de 1 a 3 palavras entre WebGPU e CPU |
| Janela Hann simétrica; zeros em vez de reflexão nas bordas | WER igual: a causa do erro alto não é nenhuma das duas |
| Carga do modelo no Worker (Cache API de localhost, 3 sessões) | 3,9 s com WebGPU e 3,1 s com WASM |
| Resposta por pedaço de 320 ms de áudio, WebGPU (68 pedaços, fala 1) | p50 80 ms, p95 119 ms, máx 1,38 s (primeiro bloco compila shaders) |
| Resposta por pedaço de 320 ms, sem adaptador WebGPU (o ORT cai para WASM sozinho; 44 pedaços, fala 2) | p50 548 ms, p95 876 ms: mais lento que o áudio, como no spike (fator 1,17) |
| Segmentação pyannote no Worker (WASM) | 590 ms na primeira janela, 41 a 44 ms depois; 97 ms em média no teste de diarização com a página aberta |
| Diarização completa, áudio TTS de 42,9 s com 8 turnos alternados de 2 vozes, pyannote e TitaNet reais | 8 de 8 turnos reais caem no id global certo (`speaker_1`/`speaker_2`) em todas as janelas; 7 com 100% de pureza e 1 com 63%; cobertura de 64 a 84% do tempo de cada turno |
| TitaNet no Worker de voz (WASM), até 5 s de fala por chamada | 386 ms em média (15 chamadas em 8 janelas) |
| Diarização offline do mesmo áudio | 6,6 s para 42,9 s de áudio |
| Diarização ao vivo (áudio enviado em tempo real) | acompanha o relógio; a fronteira estável fica de 4 a 8 s atrás do áudio (miolo de 5 s mais o fim da janela) |

**Não medido (continua pendente e não deve ser prometido).**

- Celular e tablet: RTF p95 e WER (tarefa 22, feita por uma pessoa). Nada do motor foi rodado fora desse PC.
- Voz humana: todo o WER acima é de voz sintética do Windows; a diarização também. Sobreposição real de fala e o limiar 0,7 de mesma voz não foram calibrados.
- Rede: o download de ~790 MB veio de localhost; tempo em rede real, cota do Cache API cheia (a sessão falha, não há reserva) e memória de aparelho com pouca RAM.
- Precisão dos tempos de palavra: vêm do quadro de saída (80 ms) sem corrigir a latência do encoder, e não foram comparados com a diarização em fala corrida.
- ASR, pyannote e TitaNet juntos durante muito tempo: o teste ao vivo durou 43 s. Gravação longa (50 min) offline não foi rodada.
- O fluxo inteiro por `SessionReview` num navegador com API e banco: só os testes unitários (modelos falsos) e as medidas acima. `e2e/referencia-aprovada.spec.ts` foi adaptado (Worker de ASR simulado) mas não foi executado, e os E2E `atendimento*` ainda simulam o `/speech` que saiu.
- Primeiro download sem indicador de progresso na tela.
