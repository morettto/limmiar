# Pesquisa: Nemotron ASR no servidor, com quem falou, em escala (2026-10-10)

Pesquisa e desenho técnico. Nenhum código de produto mudou e nenhuma GPU foi alugada.

Documentos que este texto continua: `docs/analise-asr-celular.md` (a decisão de levar o ASR ao servidor),
`docs/adr/ADR-0011-inferencia-no-navegador.md`, `docs/spikes/asr-navegador.md`, `tools/juiz/README.md`.

**Legenda (vale para todo o documento):**
- **[fonte Fn]**: lido na fonte n da tabela de fontes no fim do texto, que traz URL, data e versão. Não reproduzido aqui.
- **[medido]**: medido por nós neste repositório, com o aparelho dito.
- **[opinião]**: inferência ou estimativa minha. Só vira promessa depois de medida.
- **não verificado**: não achei fonte primária.

Todas as fontes foram consultadas em 2026-10-10.

---

## Resumo

1. **Modelo.** O ASR mais novo da NVIDIA com pt-BR em streaming continua sendo o **Nemotron 3.5 ASR Streaming 0,6B**,
   lançado em 2026-06-04, o mesmo que já usamos no navegador [fonte F1, F4]. O WER no FLEURS pt é de 5,65% com bloco de
   560 ms [F1]. Pontuação vem embutida [F1]. Uma H100 aguenta **~1.500 streams a 560 ms** pelo gráfico do card (NeMo,
   só ASR) [F2], e a NIM chega a **2.048 streams com p99 de 323 ms** a 160 ms [F13].
2. **Quem falou.** A novidade é o **Nemotron 3 Diarization** (2026-09-23): 100M parâmetros, **até 8 falantes**, streaming
   com 0,32 a 1,04 s de espera, e DER 40% menor que o Sortformer v2.1 em média [F5, F7]. Ele tem receita oficial de
   acoplamento com o Nemotron 3.5 [F6]. A NIM 26.10.0 já serve o Nemotron ASR Streaming **com diarização de 8 falantes**
   e devolve o falante por palavra na API Realtime [F12, F14]. Os rótulos são anônimos (falante 0, 1, ...) e não
   identificam ninguém [F6, F7].
3. **Recomendação, uma arquitetura.**
   - O navegador manda PCM 16 kHz por WebSocket a um **gateway nosso** (.NET, a mesma pilha da API).
   - O gateway fala gRPC com a **NIM de ASR** (Nemotron Streaming multilíngue + diarização), em São Paulo.
   - Cada palavra volta **já com um falante anônimo**, em menos de ~1,1 s [opinião].
   - **O aparelho diz quem é o profissional:** o TitaNet roda no aparelho sobre alguns segundos de cada falante e compara
     com o cadastro cifrado. Isso reaproveita `classificarLocutores` sem mudança, e a impressão de voz do profissional
     nunca sai do aparelho.
   - O pyannote no aparelho sai.
   - Sessão online: uma stream por trilha WebRTC, sem diarização, com o papel dado pela trilha.
   - Local, na GTX 1660 SUPER: a NIM não roda nela (pede capacidade 8.0 e 16 GB [F11]). O teste local usa o
     **NeMo-Speech.cpp**, que roda CUDA em Turing [F21] e tem servidor gRPC compatível com o Riva. Assim o gateway é o
     mesmo no PC do dono e na nuvem.
4. **Escala [opinião].** Com uma meta de planejamento de ~800 streams com diarização por H100, 5.000 streams
   simultâneas pedem **8 H100** (uma `p5.48xlarge` em São Paulo, US$ 92,47/h [F26]). Isso dá ~US$ 0,015 por hora de
   stream, já com a licença da NIM. O número por GPU **com diarização** não foi publicado e precisa ser medido.
5. **Maior risco a verificar primeiro.**
   - O proto gRPC da NIM marca `speaker_tag` como "Not available in this release" [F15], enquanto a API Realtime devolve
     `speaker_tag` por palavra [F14]. A etapa 0 do plano decide qual dos dois o gateway usa.
   - A licença da NIM em produção custa US$ 4.500 por GPU por ano [F19].
   - O WER pt-BR em fala clínica real não foi medido. O FLEURS é fala lida.

---

## 1. Modelos de ASR da NVIDIA em 2026-10

### 1.1 Checkpoints que existem

Listagem da organização `nvidia` no Hugging Face, ordenada por data de criação, consultada em 2026-10-10 [F4]. **Não
há ASR Nemotron mais novo que o 3.5.** Depois dele saíram só o Nemotron 3 Diarization e modelos de LLM/voz-chat [F4].

| Modelo | Criado / lançado | Tamanho | Idiomas | Modo | Licença | Serve para nós? | Fonte |
|---|---|---|---|---|---|---|---|
| **nemotron-3.5-asr-streaming-0.6b** | criado 2026-05-15; lançado 2026-06-04; card atualizado 2026-09-10 | 0,6B | 40 locales: 19 prontos (inclui **pt-BR**), 13 de cobertura ampla, 8 que pedem ajuste fino | streaming cache-aware, blocos de 80/160/320/560/1.120 ms | OpenMDW-1.1, uso comercial | **sim, é o escolhido** | F1, F4 |
| nemotron-speech-streaming-en-0.6b | 2025-12-17; versão v2603 em mar/2026 | 0,6B | só inglês | igual | NVIDIA Open Model License | não (inglês) | F4, F22, F38 |
| multitalker-parakeet-streaming-0.6b-v1 | 2025-10-15 | 0,6B, uma instância por falante | só inglês | streaming, aguenta sobreposição | NVIDIA Open Model License | não (inglês) | F6, F9 |
| parakeet-unified-en-0.6b | 2026-04-07 | 0,6B | inglês | offline + streaming (≥ 160 ms) | NVIDIA Open Model License | não | F22, F38 |
| parakeet_realtime_eou_120m-v1 | 2025-10-10 | 120M | inglês | fim de fala | NVIDIA Open Model License | não | F4, F38 |
| parakeet-tdt-0.6b-v3 | 2025-08-04 | 0,6B | 25 europeus, inclui pt | **offline** | CC-BY-4.0 | não para o ao vivo | F4, F38; WER pt em `analise-asr-celular.md` |
| canary-1b-v2 | 2025-08-04 | 1B | inclui pt | **offline** | CC-BY-4.0 | não para o ao vivo | F4, F38 |
| canary-qwen-2.5b | 2025-06-26 | 2,5B | sem pt | offline | CC-BY-4.0 | não | F38 |
| **Nemotron-3-Diarization** | lançado 2026-09-23 | 100M | treino com várias línguas; avaliação sem pt | streaming e offline, até 8 falantes | OpenMDW-1.1 | **sim (diarização)** | F5, F7 |
| diar_streaming_sortformer_4spk-v2.1 | 2025-10-22 | — | — | streaming, 4 falantes | NVIDIA Open Model License | substituído pelo de cima | F10, F38 |

### 1.2 Nemotron 3.5 ASR em detalhe

| Item | Valor | Tipo |
|---|---|---|
| Arquitetura | FastConformer cache-aware, 24 camadas, decoder RNNT, prompt de idioma de 128 dimensões. Guarda cache de toda camada de atenção e convolução; cada quadro é processado uma vez, sem sobreposição | [F1] |
| WER FLEURS pt (pt-BR e pt-PT juntos), idioma fixo | 80 ms 6,29% · 160 ms 6,10% · 320 ms 5,81% · **560 ms 5,65%** · 1.120 ms 5,48% | [F1] |
| WER FLEURS pt, idioma automático | 6,41 / 6,19 / 5,82 / 5,57 / 5,47% | [F1] |
| WER pt-BR em fala conversacional ou clínica | não publicado | não verificado |
| WER com voz TTS no nosso motor ONNX INT4 | 35 a 38% (suspeita: voz sintética, mel caseiro ou INT4) | [medido, F36] |
| Bloco e contexto | `att_context_size = [56, R]` em quadros de 80 ms; R ∈ {0, 1, 3, 6, 13} → blocos de 1, 2, 4, 7 e 14 quadros; blocos sem sobreposição | [F1] |
| Pontuação e maiúsculas | nativas no modelo | [F1] |
| Pontuação na NIM | desligada por padrão; ligar com `enable_automatic_punctuation=true` | [F11, F15] |
| Etiqueta de idioma | o modelo acrescenta `<pt-BR>` no fim; `strip_lang_tags` no NeMo remove | [F1] |
| Tempos por palavra | o card não fala disso [F1]. O pipeline de streaming do NeMo tem "Word-level output" [F24]; a NIM tem `enable_word_time_offsets` [F15] e `words_info` com `start_time`/`end_time` na API Realtime [F14]; o NeMo-Speech.cpp tem `word_timestamps` [F21]. Em RNNT o início e o fim de uma palavra podem coincidir [F15]. No nosso motor a resolução é o quadro de 80 ms [medido, F36] | [F14, F15, F21, F24] |
| Hotwords / contexto | não está no card [F1]. NIM: `speech_contexts` com `phrases` e `boost` (0 a 20 recomendado) [F15]. NeMo: viés por stream no pipeline cache-aware [F23]. NeMo-Speech.cpp: `speech_contexts` [F21] | [F15, F21, F23] |
| VAD / fim de fala | NIM: `endpointing_config` e probabilidades de VAD no resultado [F15]; `force_eou` só em RNNT cache-aware [F15]. NeMo-Speech.cpp: máscara Silero VAD e fim de fala por silêncio (800 ms por padrão) [F21]. NeMo: detecção de fim de fala no pipeline [F24] | [F15, F21, F24] |
| GPUs (modelo) | Volta, Turing, Ampere, Ada, Hopper, Blackwell, Jetson; SO Linux | [F1] |
| GPUs (NIM) | capacidade ≥ 8.0 e ≥ 16 GB de VRAM; lista A10, A100, L4, L40, H100, RTX 40xx/50xx, DGX Spark; Nemotron sem suporte em WSL2 | [F11] |
| Formatos | `.nemo` 2.368 MB, `model.safetensors` 2.552 MB (F32), GGUF q8_0 742 MB (NeMo-Speech.cpp), Transformers ≥ 5.13; runtime NeMo 26.06 | [F1, F4 via API] |
| ONNX | só o export da comunidade, INT4 para WebGPU (o que usamos hoje); nenhum export oficial NVIDIA | [F36]; export oficial não verificado |
| TensorRT / Riva / NIM | a NIM empacota Triton + TensorRT [F16]; contêiner `nemotron-asr-streaming:1.4.0`, tipos `en-US` e `multi` (40 locales) [F11, F12]. O SDK Riva x86 foi descontinuado em favor da NIM [F20] | [F11, F12, F16, F20] |
| Duração máxima | "específica da memória da GPU" | [F1] |

Observação [opinião]: a NIM não diz em nenhum lugar que o tipo `multi` é exatamente o checkpoint
`nemotron-3.5-asr-streaming-0.6b`. A lista de 40 locales é a mesma [F1, F11], mas isso **não foi verificado**.

---

## 2. Quem falou: diarização e identificação

### 2.1 O que a NVIDIA oferece

| Componente | O que faz | Números publicados | Limites | Fonte |
|---|---|---|---|---|
| **Nemotron 3 Diarization** | diz quem falou quando: 8 canais de probabilidade por quadro de 10 ms; canais em ordem de chegada; cache de falantes (AOSC) mantém a identidade ao longo da sessão | espera de entrada de 0,32 / 0,64 / 1,04 / 30,4 s. CALLHOME-Part2, 2 falantes: DER 6,98% a 1,04 s, 7,75% a 0,32 s, 5,98% offline. DIHARD III completo: 13,18% a 1,04 s. RTFx, lote 32 compilado, RTX PRO 5000: 865 (1,04 s) e 292 (0,32 s) | até 8 falantes; rótulos anônimos; precisão cai acima de 4 falantes (problema conhecido na NIM [F12]); nenhum DER em pt | F5, F7, F12 |
| Sortformer streaming v2.1 (anterior) | igual, com 4 falantes | CALLHOME 2 falantes: 6,83% a 1,04 s | 4 falantes | F5, F10 |
| **ASR + diarização acoplados** (`SpeakerTaggedASR`, `speech_to_text_multitalker_streaming_infer.py`) | uma stream de ASR por falante ativo; com o Nemotron 3.5, `masked_asr=true` mascara a atividade de cada falante e "reconhece fala sobreposta até certo grau" | contexto recomendado `[56,13]`, ou seja, blocos de **1,12 s**. Nenhum cpWER publicado para o Nemotron 3.5 | memória e cálculo crescem com o número de falantes; `cache_gating` só roda ASR para quem está falando; o script de exemplo é replay de arquivo, e um serviço precisa de uma sessão persistente por cliente | F6 |
| Multitalker Parakeet | ASR com "speaker kernels", uma instância por falante, feito para sobreposição forte | cpWER, Sortformer v2, latência 1,12 s: CH109 (2 falantes) 15,81%; Mixer 6 23,81% | **só inglês** | F9 |
| NIM 26.10.0 | Nemotron ASR Streaming com diarizador Sortformer de 8 falantes; `max_speaker_count` de 1 a 8 | sem números de DER nem de capacidade com diarização | não diz qual checkpoint é o diarizador; precisão cai acima de 4 falantes | F12, F14, F15 |
| Estudo de arquiteturas (Park et al., Interspeech 2026) | compara 4 formas de juntar ASR e diarização em streaming | o resumo não traz números | — | F34 |

**Identificação de pessoas:** nenhum desses modelos diz quem é o profissional. O guia diz que os números de falante
"não identificam nomes reais" e que a aplicação precisa fazer a ligação, por exemplo com cadastro de voz [F6]. O blog
sugere "modelos de verificação de falante" [F7].

**Privacidade [fonte + opinião]:** o cache AOSC guarda "speaker information from earlier chunks" [F5], ou seja, o
servidor mantém representações acústicas dos falantes **em RAM durante a sessão**. O guia trata os rótulos como "not
biometric identities", locais à sessão [F6]. Isso não é a impressão de voz cadastrada, mas é processamento de voz no
servidor. Precisa entrar no parecer jurídico já pedido em `analise-asr-celular.md` §3.4 [opinião].

### 2.2 Comparação para a sessão PRESENCIAL (um microfone, 2 ou mais pessoas)

| Opção | Rótulo em tempo real | Celular fraco | Privacidade da voz do profissional | Evidência | Veredito |
|---|---|---|---|---|---|
| A. **pyannote + TitaNet no aparelho** (hoje) | borda estável **4 a 8 s** atrás do áudio [medido, F36] | não medido; TitaNet levou 386 ms por chamada em WASM no PC [medido, F36]; pyannote em WebGPU é 12× mais lento que em WASM [medido, F36] | ótima: nada sai | voz TTS; 8 de 8 turnos certos em 42,9 s [medido, F36] | **sai**: lento demais para "tempo real", pesado em aparelho fraco e sem medida com voz humana |
| B. **Diarização no servidor (Nemotron 3 Diarization) + identificação no aparelho (TitaNet contra o cadastro)** | falante anônimo por palavra em ~0,3 a 1,1 s de espera de entrada [F5]; papel definido depois de ~2 a 5 s de fala de cada pessoa [opinião] | o aparelho só roda **algumas** chamadas de TitaNet por falante, não uma por janela de 5 s [opinião] | o cadastro cifrado e o perfil continuam só no aparelho; o servidor vê só falantes anônimos | DER publicado [F5]; a combinação não foi medida | **recomendada** |
| C. Mandar o embedding do profissional ao servidor (falante-alvo / verificação lá) | rótulo de papel direto do servidor | leve | **viola** a decisão de que a impressão de voz fica cifrada no aparelho | — | descartada |
| D. Só ASR no servidor e diarização inteira no aparelho | igual a A | igual a A | ótima | igual a A | descartada pelos mesmos motivos de A |

**Desenho recomendado para o presencial [opinião, apoiado em F5, F6, F14]:**

1. O servidor devolve cada palavra com `falante: "s0".."s7"` (anônimo, estável na sessão pelo AOSC [F5]). Uma palavra
   pode chegar com `falante: null` por até ~1 s, até a diarização cobrir aquele trecho.
2. O aparelho guarda, só em memória, os últimos ~30 s de PCM. Quando um falante novo junta ≥ 2 s de fala sozinho (a
   mesma regra de `AMOSTRAS_MINIMAS_DE_VOZ` em `packages/diarization`), o aparelho recorta até 5 s desse falante usando
   os tempos de palavra, roda o TitaNet (o `criarExtratorVoz` atual) e guarda o centróide em `vozes[sN]`.
3. `classificarLocutores(perfil, vozes)` dá `voce` / `paciente` / `null` sem mudança (`identificar-vozes.ts`).
4. A tela mostra o papel por palavra. Antes da identificação aparece "Falante A/B", que vira "Profissional/Paciente"
   sem reescrever texto, porque o papel é uma tabela `falante → papel` à parte.
5. **Correção:**
   - (a) O servidor pode mandar `revisao_falante` para palavras já emitidas (o pipeline acoplado do NeMo tem
     `fix_prev_words_count` / `update_prev_words_sentence` [F6]).
   - (b) O profissional troca o papel de um falante inteiro (um clique muda a tabela).
   - (c) O profissional corrige palavra a palavra, como já faz em "Corrigir texto e voz por palavra" (guia, S8).
   - (d) A cada ~30 s o aparelho confere de novo o centróide; se o falante `sN` ficar ambíguo, o papel volta a `null` e
     pede revisão.

### 2.3 Sessão ONLINE (WebRTC)

| Opção | Rótulo | Custo | Veredito |
|---|---|---|---|
| **Uma stream de ASR por trilha** (microfone local = profissional; trilha remota = paciente), sem diarização | **exato por construção**: o papel vem da trilha autenticada, como já faz `transcrever-online.ts` | 2 streams por sessão | **recomendada** [opinião] |
| Mixar as trilhas e diarizar | sujeito ao erro do diarizador | 1 stream + diarização | descartada: troca uma certeza por uma estimativa |

Detalhes [opinião]:
- Quem envia as duas trilhas é o **navegador do profissional**, que já recebe a trilha remota. O paciente não precisa
  de credencial no serviço de ASR.
- Se o profissional usa alto-falante, o microfone local pode captar o paciente. O `echoCancellation` do getUserMedia
  reduz isso. Uma palavra igual nas duas trilhas com sobreposição de tempo pode ser descartada da trilha local. Isso
  precisa ser medido.
- Mais de uma pessoa do lado do paciente: ligar a diarização só na trilha remota (`max_speaker_count` [F15]) e rotular
  "Paciente", "Paciente · 2". Fica como camada posterior.

---

## 3. Servir em escala

### 3.1 Opções de runtime

| Opção | O que entrega | O que falta | Custo de licença | Fonte |
|---|---|---|---|---|
| **NIM de ASR** (`nemotron-asr-streaming:1.4.0`) | Triton + TensorRT com batching dinâmico [F16]; perfis de lote 32/128/512 [F11, F18]; diarização de 8 falantes [F12]; gRPC bidirecional (LINEAR_PCM, OGGOPUS...) [F15]; API Realtime WebSocket (só `pcm16` em base64) [F14]; métricas Prometheus em `/v1/metrics` [F17]; Helm na documentação [F16] | não roda em capacidade < 8.0 nem com < 16 GB [F11]; `speaker_tag` no gRPC marcado como indisponível [F15]; log de payload não documentado [F17]; nenhuma métrica de fila nem histograma de latência [F17] | produção exige NVIDIA AI Enterprise: "a partir de US$ 4.500 por GPU por ano ou ~US$ 1 por GPU-hora na nuvem"; o Developer Program cobre testes em até 16 GPUs | F11–F19 |
| NeMo puro (Python, Apache-2.0) | `CacheAwareRNNTPipeline` com `ContinuousBatchedRequestStreamer` e pool de estados (`num_slots ≥ batch_size`) [F23]; `SpeakerTaggedASR` para o acoplamento com diarização [F6] | não vem um servidor pronto; o guia mostra uma sessão por cliente, sem dizer como juntar sessões de clientes diferentes num lote com diarização [F6] | nenhum (Apache-2.0 [F22]; modelo OpenMDW [F1]) | F6, F22, F23 |
| **NeMo-Speech.cpp** (C++, Apache-2.0) | CUDA (Turing 7.5+), Vulkan, CPU; `nemo-speech serve` com WebSocket realtime (PCM16 binário, `word_timestamps`, `speaker_diarization`, `speech_contexts`) e `riva_server` gRPC compatível; batching entre streams (`max_queue_delay_us` 5.000, `ingress_cohort_delay_us` 20.000, `state_arena_slots` 16, fila máxima 2.048 por estágio); presets do Nemotron 3 Diarization | o próprio projeto diz que "NVIDIA NIM is the supported production deployment path; this server is intended for local use and direct integration"; nenhum número de capacidade publicado | nenhum | F21 |
| Triton/TensorRT direto | é o que a NIM já faz por dentro [F16] | teríamos de refazer o pipeline de streaming e de diarização | nenhum | F16; [opinião] |
| TensorRT-LLM / Dynamo | voltados a LLM; não achei documentação de ASR | — | — | não verificado |

**Escolha [opinião]:**
- **Produção: NIM.** É o único caminho que já junta streaming, diarização de 8 falantes, palavra com tempo, batching
  entre sessões e números de capacidade publicados, com suporte da NVIDIA. O NeMo puro pediria escrever o servidor de
  batching com diarização, que é o trabalho mais difícil e o menos documentado.
- **Local e testes: NeMo-Speech.cpp.** Roda na GTX 1660 e expõe o mesmo gRPC do Riva. O gateway fica igual nos dois.
- Isso segue o AGENTS.md: preferir a biblioteca mantida e não reimplementar.

### 3.2 Streams simultâneas por GPU

| GPU | Streams | Condição | Tipo | Fonte |
|---|---|---|---|---|
| H100 | 240 / 480 / 960 / **1.500** / 2.400 | NeMo, só ASR, blocos de 80 / 160 / 320 / **560** / 1.120 ms | [fonte] | F2 |
| H100 | latência mediana do último token ~200 ms com ~1.000 pedidos paralelos (560 ms) e ~515 ms com 1.500 | NeMo, só ASR | [fonte] (lido no gráfico) | F3 |
| H100 | 560 streams a 320 ms | Nemotron Speech EN, jan/2026 | [fonte] | F8 |
| H100 | 127 clientes WebSocket, 560 ms: atraso mediano estável de 182 ms em 3 min | teste da Modal citado pela NVIDIA | [fonte] | F8 |
| H100 | **2.048 streams: p50 30 ms, p99 323 ms**; 2.900: p50 54 ms, p99 648 ms | NIM en-US, lote 512, bloco 160 ms, sem diarização, `riva_streaming_asr_client --simulate_realtime` | [fonte] | F13 |
| B200 | 3.200 streams: p99 882 ms | NIM en-US, lote 512, 160 ms | [fonte] | F13 |
| RTX PRO 6000 | 64 streams: p99 16,5 ms (multi, lote 32; a tabela só vai até 64) | NIM | [fonte] | F13 |
| L40S | a página tem seção de L40S, mas os números do Nemotron nela não estavam atribuídos a uma GPU | NIM | não verificado | F13 |
| **L4** | **não publicado.** Estimativa: 1.500 ÷ (8,2 a 11) ≈ **135 a 185** streams só de ASR a 560 ms. A razão vem do FP16 com esparsidade (1.979 contra 242 TFLOPS) e da banda de memória (3,35 TB/s contra 300 GB/s) | — | [opinião] | F31, F32 |
| A10G | não publicado; a NIM lista A10 com FP16 | — | não verificado | F11 |
| Qualquer GPU **com diarização** | não publicado. O diarizador sozinho tem RTFx 865 (1,04 s) ou 292 (0,32 s) num lote de 32 numa RTX PRO 5000 [F5]. No modo acoplado há uma stream de ASR por falante ativo [F6], então em sessão de 2 pessoas o ASR pode custar até ~2× [opinião] | — | não verificado | F5, F6 |

Memória da NIM (GPU): perfil `multi` com lote 32 = 4 GB, lote 128 = 12 GB, lote 512 = 21 GB (pede GPU de 48 GB) [F11].
Uma L4 (24 GB [F31]) leva até o perfil de lote 128 [opinião].

**Cache por stream [cálculo]:** pelos formatos do nosso export (`fluxo-asr.ts`): `cache_last_channel` 1×24×56×1024 e
`cache_last_time` 1×24×1024×8 em float32 dão ~6,3 MB por stream, ~3,2 MB em FP16. 1.500 streams ocupam ~9,4 GB em FP32.
O estado do decoder (2×640×2) é desprezível. Isso bate com a "linear memory scaling" do blog [F8].

### 3.3 Batching, sessões grudadas, reconexão, pressão de volta

Tudo nesta subseção é **[opinião]**, a não ser onde há fonte.

- **Batching:** fica na NIM (Triton [F16]). O gateway só mantém uma stream gRPC por sessão e não faz lote.
- **Afinidade:**
  - Uma conexão WebSocket já é grudada no pod por ser uma conexão TCP.
  - Para a **reconexão** cair no mesmo pod do gateway, o balanceador usa hash consistente pelo `streamId` (por exemplo
    `ring_hash` do Envoy ou `upstream-hash-by` do ingress-nginx).
  - O gateway mantém a stream gRPC aberta com a NIM por uma **janela de graça de 30 s**, com o estado do modelo e o
    cache de falantes vivos.
- **Reconexão sem perder palavras:**
  - Toda moldura de áudio leva o índice da sua primeira amostra.
  - O servidor confirma (`ack`) até a amostra cujo resultado final já saiu.
  - O cliente guarda em memória tudo que ainda não foi confirmado e reenvia a partir do `ack` ao reconectar.
  - Se o pod morreu, a sessão nova recomeça o estado do modelo, recebe o áudio a partir do último `ack` e desloca os
    tempos pelo índice da amostra. Nenhuma palavra se perde.
  - Nesse caso os falantes recomeçam do zero (o AOSC morreu), e o aparelho reidentifica com o TitaNet (§2.2).
- **Pressão de volta (backpressure):**
  - Cliente: olha `WebSocket.bufferedAmount`. Acima de 2 s mostra "rede lenta" e continua guardando em memória até
    120 s (3,8 MB de PCM16). Passando disso, encerra com aviso. O código atual já tem esse padrão de limite
    (`MAX_BLOCOS_EM_FILA`).
  - Servidor: limite de fila por stream. O gateway manda `estado.atrasoMs`.
  - **Controle de admissão:** sessão nova recebe `erro: capacidade` quando o pool passa da capacidade medida, em vez de
    deixar todo mundo atrasar. O NeMo-Speech.cpp faz o mesmo com `max_queue_depth` [F21].
- **Autoscaling:**
  - Métrica: streams ativas por GPU (`num_requests_asr_running` [F17]) dividida pela capacidade medida no teste de
    carga, com alvo de 60 a 70%.
  - Subir uma GPU leva minutos (máquina + carga do modelo). Por isso: piso fixo no horário de atendimento, escala por
    agenda e folga de uma GPU.
  - Descer: o pod para de aceitar sessões e espera as abertas acabarem (sessões de até ~60 min). O
    `terminationGracePeriodSeconds` precisa ser longo.
- **Sem log de conteúdo:**
  - Gateway sem log de corpo, raiz do sistema de arquivos só leitura, sem disco. É o mesmo contrato do juiz
    (`tools/juiz/README.md`).
  - Na NIM, o log de payload **não é documentado** [F17]. O teste de carga inclui uma palavra-sentinela e um grep nos
    logs, que precisa dar 0.

### 3.4 Regiões no Brasil

| Provedor | GPUs em São Paulo | Preço sob demanda | Tipo | Fonte |
|---|---|---|---|---|
| AWS `sa-east-1` | G4dn (T4), G5 (A10G), **G6 (L4)**, G6f, Gr6, P4d (A100), **P5 / P5e (H100 / H200)**, P6-B300. **Não há G6e (L40S).** | `g6.xlarge` (1×L4) US$ 1,368/h · `g5.xlarge` (1×A10G) US$ 1,71/h · `g4dn.xlarge` (1×T4) US$ 0,894/h · `p5.4xlarge` (1×H100) US$ 11,558/h · `p5.48xlarge` (8×H100) US$ 92,467/h | [fonte] | F25, F26 (preços publicados em 2026-10-09) |
| Google Cloud `southamerica-east1` | **G4 (RTX PRO 6000)** nas zonas a e b; N1+T4 nas zonas a, b e c; **sem L4** | não consultado | [fonte] | F27, F28 |
| Magalu Cloud | L40 e L40S, segundo o resumo da busca; a página da documentação deu 404 ao abrir | não verificado | não verificado | F29 |
| Oracle São Paulo | L40S, H100 e A10, segundo listagem de terceiro | não verificado | não verificado | F30 |

T4 não serve para a NIM: é Turing, capacidade 7.5, abaixo do mínimo de 8.0 [F11].

### 3.5 O que "milhares de sessões" quer dizer em GPUs [opinião]

Premissas:
- Sessão presencial = 1 stream com diarização. Sessão online = 2 streams sem diarização.
- **Meta de planejamento: 800 streams com diarização por H100 e 100 por L4.** É ~metade do só-ASR publicado [F2, F13]
  e da estimativa da L4, para cobrir a diarização e o pico. **Não medido.**
- Licença da NIM a US$ 4.500 por GPU por ano ≈ US$ 0,51 por GPU-hora [F19]. Preços da AWS em São Paulo [F26].

| Streams simultâneas no pico | H100 (+1 de folga) | US$/h (EC2 + licença) | L4 (+10%) | US$/h (EC2 + licença) |
|---|---|---|---|---|
| 500 | 2 | ~24 | 6 | ~11 |
| 2.000 | 4 | ~48 | 22 | ~41 |
| 5.000 | 8 (uma `p5.48xlarge`) | ~97 | 55 | ~103 |
| 10.000 | 14 | ~169 | 110 | ~207 |

- Por hora de stream com a GPU cheia [opinião]: H100 ≈ (11,56 + 0,51) / 800 ≈ **US$ 0,015**; L4 ≈ (1,368 + 0,51) / 100
  ≈ **US$ 0,019**.
- **A licença é cobrada por GPU**, o que favorece GPUs grandes quando há escala.
- Para começar (dezenas de sessões), 1 L4 + 1 de folga é o degrau certo.

---

## 4. Protocolo e código performático

### 4.1 Áudio do cliente

| Opção | Banda | CPU no aparelho | Disponibilidade | Veredito |
|---|---|---|---|---|
| **PCM s16le 16 kHz mono** | 256 kbit/s, ~96 MB em 50 min [cálculo, F36] | quase nenhuma: o AudioWorklet atual já reduz para 16 kHz | todo navegador com AudioWorklet | **v1** |
| Opus via WebCodecs `AudioEncoder` | ~24 a 32 kbit/s | baixa | Chrome 94+, Firefox desktop 130+, **Safari 26+, mas não no Firefox Android** [F33] | não é universal; exigiria um segundo caminho |
| Opus em WASM (libopus) | ~24 a 32 kbit/s | média | universal | camada posterior, só se o teste de dados móveis reprovar [opinião] |

- A NIM aceita `LINEAR_PCM` e `OGGOPUS` no gRPC [F15]; a API Realtime aceita só `pcm16` [F14].
- **Moldura:** 80 ms = 1.280 amostras = 2.560 bytes + 8 de cabeçalho, 12,5 mensagens por segundo [opinião]. Hoje o
  worklet junta **5.120 amostras (320 ms)** antes de enviar (`realtime-pcm.processor.ts`). Isso soma até 240 ms de
  atraso desnecessário e deve virar 1.280.

### 4.2 Transporte

| Opção | Prós | Contras | Veredito |
|---|---|---|---|
| **WebSocket (TLS)** | universal; entrega confiável e em ordem (nenhuma palavra perdida); grudado por conexão; binário | bloqueio na cabeça da fila em rede com perda (atraso, não perda) | **escolhido** [opinião] |
| Canal de dados WebRTC | baixa latência, modo não confiável possível | exige ICE/TURN e SFU em escala; em modo não confiável perde áudio | descartado [opinião] |
| Trilha de áudio WebRTC | Opus, FEC, jitter buffer | a ocultação de perda inventa áudio → palavras erradas ou perdidas | descartado [opinião] |
| gRPC-Web | — | não tem streaming do cliente para o servidor no navegador | descartado (não verificado em fonte nesta pesquisa) |
| WebTransport | sem bloqueio na cabeça da fila | Safari só a partir de 26.4 [F33]; aparelho antigo fica de fora | rever depois |

### 4.3 Contrato proposto (gateway ⇄ navegador)

Autenticação [opinião]:
- A API emite um **tíquete de uso único e curta duração** (60 s, como faz a NIM [F14]), ligado à sessão clínica.
- O tíquete vai na primeira mensagem, nunca na URL.
- Endpoint: `wss://asr.<domínio>/v1/stream`.

Cliente → servidor:

```json
{"tipo":"iniciar","ticket":"tk_…","modo":"presencial","idioma":"pt-BR","palavrasChave":["sertralina","TCC"],
 "retomar":null}
```

```json
{"tipo":"iniciar","ticket":"tk_…","modo":"trilha","papel":"paciente","idioma":"pt-BR",
 "retomar":{"streamId":"st_9f2","aPartirDaAmostra":1843200}}
```

- Áudio: **binário**, `uint32 LE` com o índice da primeira amostra, seguido de `int16 LE[1280]`.
- `{"tipo":"pausar","pausada":true}`
- `{"tipo":"fim"}`: drena e fecha.

Servidor → cliente:

```json
{"tipo":"pronto","streamId":"st_9f2","retomadoDe":0,"blocoMs":560}
{"tipo":"ack","ateAmostra":1843200}
{"tipo":"parcial","palavras":[{"id":"w812","t":"dor","i":115200,"f":115520,"s":null},
                              {"id":"w813","t":"de","i":115520,"f":115600,"s":null}]}
{"tipo":"final","palavras":[{"id":"w812","t":"dor","i":115200,"f":115520,"s":"s1"},
                            {"id":"w813","t":"de","i":115520,"f":115600,"s":"s1"},
                            {"id":"w814","t":"cabeça.","i":115600,"f":116160,"s":"s1"}]}
{"tipo":"revisao_falante","palavras":[{"id":"w809","s":"s0"}]}
{"tipo":"estado","atrasoMs":240}
{"tipo":"erro","codigo":"capacidade","repetirEmMs":5000}
```

Regras:
- `i` e `f` são milissegundos desde o início da stream.
- `parcial` substitui o rabo não final anterior; `final` nunca muda o texto.
- `s` é o falante anônimo, `null` enquanto pendente. No modo `trilha` o servidor não diariza e o cliente aplica o papel.
- Mapeamento para o código atual: `{texto: t, inicioMs: i, fimMs: f, locutor: s}` = `PalavraAtribuida`. `finais` =
  número de palavras finais.

### 4.4 Rede ruim / 4G [opinião]

- O `ack` e o buffer do cliente cobrem quedas (§3.3).
- Reconexão com espera crescente: 0,5, 1, 2, 4 s, até 30 s.
- Aviso fixo "reconectando, o áudio está guardado só neste aparelho".
- Os 256 kbit/s de subida em 4G são uma premissa: a ida e volta celular → São Paulo e a banda real **não foram
  verificadas**. O teste 8 do plano (§5.6) decide se o Opus entra.

### 4.5 Latência alvo e como medir

Orçamento [opinião]: moldura de 80 ms + rede de ida (não verificado) + espera do bloco de 560 ms + inferência
(p50 30 ms numa H100 carregada pela NIM [F13]; ~200 ms no NeMo com 1.000 streams [F3]) + rede de volta ≈ **0,75 a 1,0 s**
até a primeira palavra parcial.

No modo acoplado da receita oficial, o bloco é de 1,12 s [F6], e o atraso sobe para ~1,3 a 1,6 s [opinião]. A etapa 0
mede os dois modos:
- (a) ASR a 560 ms com o falante preenchido depois (`s:null` → `revisao_falante`);
- (b) acoplado a 1,12 s.

Fica o modo (b) se ele passar o critério de latência.

Como medir [opinião]:
- Cliente: o worklet marca `performance.now()` por moldura. Cada palavra que volta traz `f` (amostras), então o atraso
  = hora de exibição − hora de captura da amostra `f`.
- Servidor: tempo entre a chegada da moldura que completa o bloco e o envio do resultado.
- Os dois viram histogramas sem conteúdo (só números).
- Áudio de teste reproduzível: Chrome com `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>`,
  com alinhamento de referência feito por gente.

---

## 5. Desenho recomendado

### 5.1 Diagrama

```
 Aparelho (qualquer navegador: PC, tablet, celular; Firefox/Zen sem WebGPU incluído)
 ┌───────────────────────────────────────────────────────────────────────────────────┐
 │ microfone ─► AudioWorklet (16 kHz, int16, 80 ms) ─┬─► WebSocket TLS ───────────┐  │
 │                                                   └─► anel de 30 s em RAM      │  │
 │                                                        │ (zerado ao fechar)    │  │
 │   palavras {t,i,f,s} ◄─────────────────────────────────┼───────────────────────┘  │
 │        │                                               ▼                          │
 │        │          TitaNet (WASM, Worker, já existe) ─► vozes[sN]                  │
 │        ▼                                               ▼                          │
 │   tabela falante→papel ◄── classificarLocutores(perfil cifrado no aparelho)       │
 │        ▼                                                                          │
 │   tela palavra-a-palavra com papel; fala do paciente (texto) ─► copiloto/juiz     │
 └───────────────────────────────────────────────────────────────────────────────────┘
                     │ wss (tíquete de uso único)
                     ▼
 Região São Paulo (AWS sa-east-1)
 ┌───────────────────────────────────────────────────────────────────────────────────┐
 │ Balanceador L7 (hash consistente por streamId)                                    │
 │      ▼                                                                            │
 │ Gateway ASR (.NET, sem estado em disco, sem log de conteúdo, N réplicas em CPU)   │
 │   - valida o tíquete com a API; ack/reenvio; janela de graça de 30 s;             │
 │     admissão por capacidade; métricas só numéricas                                │
 │      │ gRPC bidi StreamingRecognize (LINEAR_PCM 16 kHz; diarização no presencial) │
 │      ▼                                                                            │
 │ NIM ASR nemotron-asr-streaming (type=multi, pt-BR, diarizador de 8 falantes)      │
 │   em GPUs L4 (início) → H100 (escala); Triton + TensorRT com batching dinâmico    │
 └───────────────────────────────────────────────────────────────────────────────────┘
 Local (PC do dono): mesmo gateway → riva_server do NeMo-Speech.cpp (CUDA, GTX 1660)
```

### 5.2 Componentes

| Componente | Responsabilidade | Novo ou reaproveitado |
|---|---|---|
| `shared/audio/asr/cliente.ts` | mantém a interface `Motor`/`SessaoAsr` (`abrirSessao`, `enviar`, `concluir`, `descartar`), mas fala WebSocket em vez do Worker ONNX; buffer não confirmado, reconexão, `bufferedAmount` | **reescrito por dentro, mesma interface** |
| `capturar-pcm.ts` + `realtime-pcm.processor.ts` | captura e redução a 16 kHz | reaproveitado; moldura de 5.120 → 1.280 amostras; int16 no worklet |
| `features/live-session/transcrever-ao-vivo.ts` | `SessaoTranscricao` intacta; o `DiarizadorAoVivo` sai; as palavras já chegam com `locutor`; `vozes` passa a vir do TitaNet por falante do servidor | ajustado |
| `transcrever-online.ts` | duas sessões no modo `trilha`, papel fixo | quase igual |
| `identificar-vozes.ts`, `classificarLocutores`, `montarTranscricaoCanonica`, `entities/voz/*` | identificação no aparelho, perfil cifrado | **reaproveitados sem mudança** |
| Gateway ASR (novo serviço em `apps/`) | tíquete, WebSocket ⇄ gRPC, ack, admissão, métricas | **novo** (.NET, como `apps/api`) |
| NIM ASR (produção) / NeMo-Speech.cpp (local) | inferência | externo |

**O que sai** (regra do AGENTS.md: sem caminho obsoleto), quando a etapa 2 passar:
- `shared/audio/asr/{motor,mel,fluxo-asr,modelo,asr.worker}.ts` e seus testes;
- `tools/asr-web` e `public/models/asr` (os ~790 MB);
- `packages/diarization/src/{pyannote,pyannote-fluxo}.ts` e o `segmentar` do motor.

O caminho "carregar áudio" passa pelo mesmo WebSocket, com o arquivo enviado em ritmo acelerado. Assim o pyannote sai
por inteiro. O `atribuirLocutores` (merge por tempo) só fica se algum caminho ainda precisar dele [opinião].

### 5.3 A GPU local do dono: cabe tudo nos 6 GB?

| Item | VRAM | Tipo |
|---|---|---|
| Nemotron 3.5 q8_0 (GGUF) | 742 MB de pesos | [fonte F1] |
| Nemotron 3 Diarization q8_0 | 107 MB de pesos | [fonte F5] |
| Contexto CUDA, buffers e estado do NeMo-Speech.cpp | ~0,5 a 0,8 GB | [opinião] |
| Juiz Gemma 4 E4B Q4_K_M (llama-server, contexto 3.072, uma vaga) | ~3,2 GB de pesos + contexto CUDA e KV ~0,4 a 0,6 GB | dado do pedido + `tools/juiz/README.md` [F36]; resto [opinião] |
| **Soma** | **~5,0 a 5,5 GB** | [opinião] |
| Já ocupado por outros programas no dia do spike | 2,15 GB | [medido, F36] |

- **Veredito [opinião]:** cabe **só com a GPU livre** de outros programas (navegador com aceleração, etc.), e com
  pouca folga. Com os 2,15 GB do spike ocupados, **não cabe**.
- Plano B, já suportado: baixar `-Ngl` do juiz [F36]. O preço é deixar o juiz mais lento.
- A medida com `nvidia-smi` é o passo 0.4 do plano.
- **A NIM não roda nessa GPU:** Turing tem capacidade 7.5 (precisa de ≥ 8.0) e 6 GB (precisa de ≥ 16 GB), e a NIM não
  suporta WSL2 [F11].
- O NeMo Python é suportado em Linux [F1]. No Windows ficaria em WSL2, o que não foi verificado.
- O NeMo-Speech.cpp tem build CUDA para Windows a partir do código-fonte, e o pacote CUDA Linux suporta Turing 7.5 [F21].

### 5.4 Plano em etapas pequenas, cada uma funcionando de ponta a ponta

| # | Etapa | Termina quando | Onde |
|---|---|---|---|
| 0 | **Spike local** com NeMo-Speech.cpp CUDA (`riva_server` e `serve`), Nemotron 3.5 q8_0 + Nemotron 3 Diarization q8_0. 0.1: o gRPC devolve `speaker_tag` por palavra? (senão, usar o WebSocket realtime). 0.2: WER e acerto de falante em 3 gravações humanas pt-BR de 10 min (com consentimento). 0.3: RTF e máximo de streams na 1660. 0.4: VRAM com o juiz carregado. 0.5: modo (a) 560 ms contra modo (b) acoplado 1,12 s | números escritos no spike | PC do dono |
| 1 | Gateway mínimo + `cliente.ts` por WebSocket, **só texto** (presencial, sem falante) atrás de `SessaoTranscricao` | Firefox/Zen sem WebGPU transcreve em tempo real a fala de 21,5 s que ontem atrasou 158 s; celular na mesma rede via HTTPS | PC do dono |
| 2 | Diarização ligada; palavras com `s`; TitaNet por falante no aparelho; tabela falante→papel; remoção do pyannote e do motor ONNX | teste S4/S8 do guia passa com voz humana | PC do dono |
| 3 | Sessão online: duas streams `trilha` | teste O7 do guia passa | PC do dono |
| 4 | Robustez: `ack`, reenvio, janela de graça, `bufferedAmount`, admissão | queda de 10 s no meio = 0 palavras perdidas | PC do dono |
| 5 | Nuvem de teste: NIM em 1×L4 `sa-east-1` (licença do Developer Program, que vale para testes [F19]) + gateway; teste de carga | capacidade por L4 medida | AWS São Paulo |
| 6 | Produção: AI Enterprise, 2 GPUs mínimas, autoscaling, drenagem, painel sem conteúdo; **ADR novo** substituindo a parte de ASR do ADR-0011; parecer jurídico (áudio + cache de falantes em RAM) | critérios do §5.6 aprovados | AWS São Paulo |

### 5.5 Plano de teste de carga [opinião]

1. **Capacidade crua da NIM:** `riva_streaming_asr_client --simulate_realtime=true` com N paralelos, como na metodologia
   da NVIDIA [F13]. Subir N em degraus (25, 50, 100, 200...) com e sem diarização. Usar áudio pt-BR de 10 min.
2. **Sistema inteiro:** cliente sintético (k6 com WebSocket, ou um script Node) mandando molduras de 80 ms no ritmo
   real pelo gateway. Medir atraso por palavra (§4.5), erros, reconexões, CPU do gateway e GPU (`gpu_utilization`,
   `gpu_memory_used_bytes` [F17]).
3. **Patologias:** 10% dos clientes com perda e atraso de rede (tc/netem); quedas de 10 s; derrubar um pod do gateway
   e um da NIM no meio do teste.
4. **Privacidade:** frase-sentinela nos áudios; depois do teste, `grep` nos logs de gateway, NIM, balanceador e nó: 0
   ocorrências. Sistema de arquivos só leitura confirmado.

### 5.6 Critérios de aceite numéricos [opinião, para o dono confirmar]

| # | Critério | Alvo |
|---|---|---|
| 1 | Primeira palavra parcial (fim da palavra dita → tela), Wi-Fi | p50 ≤ 0,7 s; p95 ≤ 1,0 s |
| 2 | Idem, 4G | p95 ≤ 1,5 s |
| 3 | Palavra final | p95 ≤ 1,5 s depois do fim da palavra |
| 4 | Toda palavra final tem falante (ou `null` explícito em sobreposição) | 100% |
| 5 | Papel (profissional/paciente) definido depois dos primeiros 2 s de fala sozinha de cada pessoa | p95 ≤ 5 s |
| 6 | Acerto de falante por palavra, 2 pessoas, pt-BR, sem sobreposição / com sobreposição | ≥ 95% / ≥ 85% |
| 7 | WER pt-BR conversacional (voz humana, referência humana) | ≤ 15% no geral (mesmo alvo de `analise-asr-celular.md`) |
| 8 | Dados móveis em 50 min | registrar; se > 100 MB pesar no 4G, entra o Opus |
| 9 | Servidor na capacidade-alvo por GPU | p99 do servidor ≤ 300 ms; RTF < 1 em 100% das streams; 0 molduras descartadas |
| 10 | Queda de rede de 10 s | 0 palavras perdidas; falantes mantidos se voltar em ≤ 30 s |
| 11 | Pod do gateway morto | 0 palavras perdidas; reidentificação de papel ≤ 10 s |
| 12 | Privacidade | 0 ocorrências da sentinela em qualquer log ou disco |
| 13 | Aparelho fraco (Android de entrada, Firefox Android, iPhone com iOS 26) | sessão de 50 min sem a aba morrer; TitaNet p95 ≤ 2 s por chamada |

---

## Não verificado (resumo)

- Capacidade **com diarização** por GPU; capacidade em L4, L40S e A10G (só há estimativa).
- Se a NIM devolve `speaker_tag` por palavra no gRPC (o proto diz que não [F15]; a API Realtime mostra o campo [F14]).
- Se o tipo `multi` da NIM é o checkpoint `nemotron-3.5-asr-streaming-0.6b`, e qual checkpoint é o diarizador de 8
  falantes da NIM.
- WER pt-BR em fala clínica real; DER em pt-BR; comportamento com fala sobreposta em pt.
- Se a NIM registra transcrição em log; como o modo acoplado com bloco de 1,12 s se comporta na NIM.
- Ida e volta e banda de subida 4G → São Paulo.
- GPUs e preços da Magalu Cloud e da Oracle São Paulo.
- NeMo Python em WSL2; VRAM real na GTX 1660 com o juiz carregado.
- Suporte do Dynamo a ASR.
- A medida de 2026-10-09 no Firefox/Zen (158 s de atraso em 21,5 s de fala) foi relatada pelo dono e não tem registro
  no repositório.

---

## Fontes (todas consultadas em 2026-10-10)

| Id | Fonte | Data / versão |
|---|---|---|
| F1 | https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b (card; arquivos via `https://huggingface.co/api/models/nvidia/nemotron-3.5-asr-streaming-0.6b?blobs=true`) | lançado 2026-06-04; card modificado 2026-09-10; versão `nemotron-3.5-asr-streaming-0.6b-v1` |
| F2 | https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/main/throughput_vs_chunk.png | mesma revisão do F1 |
| F3 | https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/main/latency_vs_parallel.png | mesma revisão do F1 |
| F4 | https://huggingface.co/api/models?author=nvidia&pipeline_tag=automatic-speech-recognition&sort=createdAt&direction=-1 e buscas `search=nemotron/parakeet/canary/sortformer/diar` | consulta 2026-10-10 |
| F5 | https://huggingface.co/nvidia/Nemotron-3-Diarization (card; arquivos via API) | lançado 2026-09-23; modificado 2026-09-24 |
| F6 | https://huggingface.co/nvidia/Nemotron-3-Diarization/blob/main/ASR_INTEGRATION_GUIDE.md | revisão de 2026-09-24 |
| F7 | https://huggingface.co/blog/nvidia/nemotron-diarization | 2026-09-23 |
| F8 | https://huggingface.co/blog/nvidia/nemotron-speech-asr-scaling-voice-agents | 2026-01-05 |
| F9 | https://huggingface.co/nvidia/multitalker-parakeet-streaming-0.6b-v1 | modificado 2026-01-28 |
| F10 | https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2.1 | modificado 2026-09-23 |
| F11 | https://docs.nvidia.com/nim/speech/latest/reference/support-matrix/asr.html | atualizado 2026-10-07 |
| F12 | https://docs.nvidia.com/nim/speech/latest/about/release-notes.html | release 26.10.0; atualizado 2026-10-07 |
| F13 | https://docs.nvidia.com/nim/speech/latest/reference/performances/asr/performance.html | versão `latest` em 2026-10-10 |
| F14 | https://docs.nvidia.com/nim/speech/latest/reference/api-references/asr/realtime-asr.html | versão `latest` em 2026-10-10 |
| F15 | https://docs.nvidia.com/nim/speech/latest/reference/api-references/asr/protos.html | versão `latest` em 2026-10-10 |
| F16 | https://docs.nvidia.com/nim/speech/latest/about/how-it-works.html | versão `latest` em 2026-10-10 |
| F17 | https://docs.nvidia.com/nim/speech/latest/reference/observability.html | versão `latest` em 2026-10-10 |
| F18 | https://docs.nvidia.com/nim/speech/latest/asr/deploy-asr-models/nemotron-asr-streaming.html | versão `latest` em 2026-10-10 |
| F19 | https://docs.api.nvidia.com/nim/docs/product (FAQ da NIM: licença) | consulta 2026-10-10 |
| F20 | https://docs.nvidia.com/deeplearning/riva/user-guide/docs/release-notes.html | Riva 2.26.0 |
| F21 | https://github.com/NVIDIA/NeMo-Speech.cpp (README, `docs/server.md`, `docs/api.md`, `docs/install.md`, `docs/asr/configuration.md`) | ramo `main` em 2026-10-10 |
| F22 | https://github.com/NVIDIA-NeMo/Speech (README) | v3.0.0 / contêiner 26.07.00 |
| F23 | https://github.com/NVIDIA-NeMo/Speech/blob/main/nemo/collections/asr/inference/pipelines/cache_aware_rnnt_pipeline.py | ramo `main` em 2026-10-10 |
| F24 | https://github.com/NVIDIA-NeMo/Speech/blob/main/examples/asr/asr_streaming_inference/README.md | ramo `main` em 2026-10-10 |
| F25 | https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html | consulta 2026-10-10 |
| F26 | https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/South%20America%20(Sao%20Paulo)/Linux/index.json (Linux, sob demanda) | publicado 2026-10-09T20:31Z |
| F27 | https://cloud.google.com/compute/docs/gpus/gpu-regions-zones | atualizado 2026-10-08 |
| F28 | https://cloud.google.com/compute/docs/gpus (G4 = NVIDIA RTX PRO 6000) | consulta 2026-10-10 |
| F29 | https://docs.magalu.cloud/docs/computing/virtual-machine/offers/offer-instances-type/ (resumo da busca; a página deu 404 ao abrir) | não verificado |
| F30 | https://northflank.com/cloud/oci/regions/sa-saopaulo-1 (terceiro) | não verificado |
| F31 | https://www.nvidia.com/en-us/data-center/l4/ | consulta 2026-10-10 |
| F32 | https://www.nvidia.com/en-us/data-center/h100/ | consulta 2026-10-10 |
| F33 | https://github.com/mdn/browser-compat-data (`api/AudioEncoder.json`, `api/WebTransport.json`) | último commit 2026-10-09 |
| F34 | https://arxiv.org/abs/2609.10265 | v2, 2026-09-24 |
| F35 | https://arxiv.org/abs/2507.18446 (Streaming Sortformer) | — |
| F36 | Repositório: `docs/analise-asr-celular.md`, `docs/spikes/asr-navegador.md`, `docs/adr/ADR-0011-inferencia-no-navegador.md`, `tools/juiz/README.md`, `apps/app/src/shared/audio/**`, `packages/diarization/**` | ramo `codex/copiloto-mvp` em 2026-10-10 |
| F37 | Relato do dono: Firefox/Zen sem WebGPU, 158 s de atraso numa fala de 21,5 s | 2026-10-09; sem registro no repo |
| F38 | Licença e idiomas pela API do Hugging Face: `https://huggingface.co/api/models/nvidia/<modelo>` (canary-1b-v2, parakeet-tdt-0.6b-v3, canary-qwen-2.5b, parakeet_realtime_eou_120m-v1, parakeet-unified-en-0.6b, multitalker…, sortformer v2.1, nemotron-speech-streaming-en) | consulta 2026-10-10 |
