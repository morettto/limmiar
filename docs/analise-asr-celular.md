# Análise: transcrição ao vivo em celular, tablet e PC (2026-10-09)

Pesquisa e análise apenas; nenhum código mudou. Contexto: `docs/adr/ADR-0011-inferencia-no-navegador.md`,
`docs/spikes/asr-navegador.md`, `docs/plano-fechamento-v1.md` (D2, D3, tarefas 13, 16, 17, 22).

**Restrição do dono (2026-10-09):** a transcrição precisa ser fluida e em **tempo real em qualquer aparelho**,
inclusive sem WebGPU. "Captura agora, transcreve depois" foi **descartado pelo dono** e não aparece como reserva.

Legenda usada em todo o documento:
- **[medido]**: número medido neste repositório (spike ou tarefa 16/17), com o aparelho dito.
- **[fonte]**: lido numa fonte externa, citada com URL e data de acesso. Não reproduzido aqui.
- **[opinião]**: inferência minha. Precisa ser medida antes de virar promessa.
- **não verificado**: não achei fonte primária.

Todas as fontes foram acessadas em 2026-10-09; a data de publicação aparece quando a fonte a mostra.

---

## Resumo

1. WebGPU existe hoje em Chrome Android (12+, Adreno/Mali/Intel; PowerVR só Android 16+; Samsung Xclipse "TBD") e
   em Safari iOS/iPadOS 26. Firefox Android não tem. Pela minha conta, ~75% dos celulares no Brasil têm um
   adaptador WebGPU [opinião]. Ter adaptador não quer dizer que roda um encoder de 690 MB em tempo real, e
   ninguém mediu isso.
2. Sem WebGPU, **nenhum ASR local em streaming com pt-BR tem evidência de tempo real em celular e WER usável**. O
   Nemotron em WASM já fica atrás do áudio num PC forte (RTF 1,17 [medido]). Vosk small pt erra demais. Whisper
   não faz streaming. Moonshine não mostra pt. O único candidato é o Kroko PT (156 MB, CC-BY-SA), que não tem WER
   publicado.
3. **ASR no servidor** com o mesmo Nemotron 3.5 streaming é o único caminho com evidência para tempo real em
   qualquer aparelho. A fonte diz que uma H100 atende ~240 streams a 80 ms e ~2.400 a 1.120 ms [fonte], com WER
   pt FLEURS de 5,65% no bloco de 560 ms [fonte]. O custo disso é que **áudio sai do aparelho**, e essa decisão é
   do dono. Voz de sessão clínica é dado de saúde e pode servir de biometria.
4. **Recomendação:** ASR no servidor (Nemotron 3.5 streaming, região Brasil, WebSocket, áudio só em memória) para
   **todos** os aparelhos. Diarização e identificação do profissional (pyannote + TitaNet) **continuam no
   aparelho**, então a impressão de voz nunca sai dele. O motor WebGPU local (tarefa 16) sai do caminho da sessão.
   Tudo isso depende do aval do dono para áudio efêmero no servidor. Sem esse aval, não há hoje como prometer tempo
   real em celular fraco.

---

## 1. WebGPU em celulares e tablets

### 1.1 Suporte por navegador

| Navegador / plataforma | Estado em 2026-10 | Tipo | Fonte |
|---|---|---|---|
| Chrome Android | Ativo por padrão desde o Chrome 121 em **Android 12+** com GPU **Qualcomm (Adreno), ARM (Mali) e Intel**. **Imagination (PowerVR)** só em **Android 16+**, desde o Chrome 139. **Samsung Xclipse: "TBD"**. Demais aparelhos: "TBD". | [fonte] | gpuweb wiki, editada em 2026-10-02: https://github.com/gpuweb/gpuweb/wiki/implementation-status ; Chrome 121 (jan/2024): https://developer.chrome.com/blog/new-in-webgpu-121 |
| Chrome Android, modo compatibilidade (OpenGL ES 3.1) | Experimental no Chrome 127 e com acesso facilitado no Chrome 135. Não achei data de "ativo por padrão". | [fonte] | https://developer.chrome.com/docs/web-platform/webgpu/news |
| Android 11 ou mais antigo | A expansão foi prometida em 2024. Não achei confirmação de que aconteceu. | não verificado | idem Chrome 121 |
| Safari iOS / iPadOS | Ativo por padrão no **iOS/iPadOS 26**. Do 17.4 ao 18.x fica atrás de uma flag. | [fonte] | gpuweb wiki (acima); https://caniuse.com/webgpu |
| Firefox desktop | Windows desde o 141 (jul/2025). macOS 26+ no 145 e todas as versões de macOS no 147. Linux só Nightly. | [fonte] | gpuweb wiki |
| Firefox Android | **Desligado**: só Beta/Nightly com flag. A Mozilla "espera" lançar em 2026. | [fonte] | gpuweb wiki; caniuse |
| Samsung Internet | Suportado a partir da versão 24. | [fonte] | https://caniuse.com/webgpu |

### 1.2 Limites que pesam para o encoder do Nemotron

| Limite | Valor | Tipo | Fonte |
|---|---|---|---|
| `maxStorageBuffersPerShaderStage`, Android (relatórios agregados) | 100% ≥ 10; **91% ≥ 16**. Adreno 6xx 89%, 7xx 90%, 8xx 83% ≥ 16; Mali Valhall 92%. Sem data nem tamanho de amostra. | [fonte] | https://web3dsurvey.com/webgpu/limits/maxStorageBuffersPerShaderStage/platform/Android |
| Mesmo limite, Apple (metal-3) | ≥ 10 (100%) e nenhum relato ≥ 16 | [fonte] | idem |
| Mínimo da especificação | 8 | [medido/lido no spike] | `docs/spikes/asr-navegador.md` |
| Encoder exportado (tarefa 13) | Concat de até 6 entradas, cerca de 7 buffers por estágio. Cabe no mínimo de 8 [opinião, pela construção do grafo; não rodado em celular]. | [opinião] | `tools/asr-web` |
| Tamanho de buffer no iOS | Num caso público, o WebLLM falhou no iOS com um buffer de 1 GB e precisou baixar para 256 MB. Não há limite oficial publicado. | [fonte], indireta | https://bugs.webkit.org/show_bug.cgi?id=302711 |
| Memória por aba em celular | Não achei limite documentado para Chrome Android. O Safari iOS é descrito como mais restrito. | não verificado | busca sem fonte primária |

Com o encoder de 6 entradas, a contagem de buffers deixa de ser o bloqueio. O que falta medir é **memória (690 MB
de pesos + ~1,2 GB de processo no PC [medido]) e velocidade em GPU móvel**.

### 1.3 Que fração do parque roda

Não achei dado de aparelhos **de profissionais de saúde** no Brasil (não verificado). O que existe é o tráfego web
geral:

| Dado | Valor | Tipo | Fonte |
|---|---|---|---|
| SO móvel no Brasil, set/2026 | Android 78,78%, iOS 21,21% | [fonte] | https://gs.statcounter.com/os-market-share/mobile/brazil |
| Fabricantes no Brasil, jun/2026 | Apple 21,0%, Samsung 20,7%, Motorola 12,1%, Xiaomi 7,8%, desconhecido 29,8% | [fonte] | https://gs.statcounter.com/vendor-market-share/mobile/brazil |
| Relatos com adaptador WebGPU funcionando (mundo) | Android 73,6%, iOS 85,4%, Windows 87,5%, macOS 90,1% (sem data nem amostra) | [fonte] | https://web3dsurvey.com/webgpu |
| iOS 26 nos iPhones que podem rodá-lo | 79% (Apple, 2026-06-07) | [fonte] via 9to5mac | https://9to5mac.com/2026/02/13/apple-announces-ios-26-usage-numbers-heres-how-they-compare/ (o número de junho veio do resumo da busca; não abri a página da Apple) |

Estimativa [opinião]: 0,788 × 0,736 + 0,212 × 0,854 ≈ **76% dos celulares no Brasil com algum adaptador
WebGPU**. Essa conta mistura dados mundiais com a fatia de mercado brasileira e não diz quantos aparelhos têm
RAM e GPU para o encoder. Dois grupos relevantes ficam de fora: Motorola/Xiaomi de entrada com PowerVR e Android
abaixo de 16, e Galaxy com Exynos/Xclipse, que está como "TBD". Que modelos de Galaxy A usam Xclipse não foi
verificado.

---

## 2. ASR local em streaming sem WebGPU, com pt-BR

Critério da restrição: primeira palavra rápida, RTF p95 < 1 no celular e WER pt-BR usável.

| Opção | Streaming? | pt-BR | Download | RAM | RTF/latência em celular | WER pt reportado | Licença | Maturidade | Veredito |
|---|---|---|---|---|---|---|---|---|---|
| **Nemotron 3.5 0,6B INT4 em WASM** (o motor atual sem GPU) | sim (560 ms) | sim | ~790 MB [medido] | 1,59 GB de processo no PC [medido] | **RTF 1,17 num PC de 24 threads** [medido]; o ORT-web usa no máximo 4 threads por padrão [fonte: https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html]. Celular não medido. | FLEURS 5,65% (560 ms) [fonte: model card]; 8,52% Q8 [fonte: Handy]; 38% em TTS [medido] | OpenMDW-1.1 | modelo de jun/2026 | **Descartado** para celular. Num PC já fica atrás do áudio. |
| **Kroko PT Community** (Banafo, sobre sherpa-onnx) | sim | sim (arquivos `Kroko-PT-Community-64/128-L-Streaming-001`) | 156 MB por arquivo [fonte] | não verificado | não verificado (a demo WASM do sherpa-onnx roda em **1 thread**) | **não publicado** | modelos community **CC-BY-SA** (fontes divergem: uma diz "não comercial") | pequeno (repo kroko-onnx ~142 estrelas, último push out/2025 [fonte secundária]) | **Único candidato local**, mas sem nenhum número. Só vale se o dono recusar áudio no servidor. |
| **Vosk small pt 0.3** | sim | sim | 31 MB | ~300 MB (para modelos small em geral) | não verificado | **32,6% Common Voice; 68,9% CORAA** [fonte] | Apache-2.0 | Kaldi, antigo | **Descartado**: erra demais em fala espontânea (CORAA). |
| Vosk pt grande (FalaBrasil) | sim | sim | 1,6 GB | alta | não roda em navegador de celular [opinião] | 27,7% CV; 54,3% CORAA [fonte] | GPLv3 | antigo | **Descartado.** |
| **sherpa-onnx streaming oficial** | sim | **não há modelo pt** entre os 19 online | n/a | n/a | n/a | n/a | Apache-2.0 | alta | **Descartado**: falta o modelo. |
| **Moonshine streaming** | sim | os cards streaming são **só inglês**; a lista de idiomas não inclui pt [fonte]. Uma fonte terceira cita "Portuguese (Brazil)", mas não verifiquei. | n/a | n/a | n/a | não verificado | MIT (streaming) | alta para inglês | **Descartado** até aparecer um modelo pt. |
| **Whisper tiny / base / small** (transformers.js, whisper.cpp WASM) | **não** (janela de 30 s; "streaming" só redecodificando) | sim | 40 / 80 / 250 MB (Q8) | não verificado | não verificado em celular; o `stream.wasm` não publica números | FLEURS pt: **24,1 / 13,9 / 7,65%** (Q8) [fonte: Handy] | MIT/Apache | alta | **Descartado**: não é streaming, e tiny/base erram demais. O small seria pesado no celular sem GPU [opinião]. |
| **Parakeet TDT 0,6B v3** | não (offline) | sim | ~600 MB | não verificado | n/a | FLEURS pt 4,76% [fonte: arXiv 2509.14128, tabela 11, lida por posição] | CC-BY-4.0 (não verificado) | alta | **Descartado** para o ao vivo. |

Fontes do item 2:
- Vosk: https://alphacephei.com/vosk/models
- Kroko: https://huggingface.co/Banafo/Kroko-ASR e https://huggingface.co/Banafo/Kroko-ASR/tree/main
- sherpa-onnx online: https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/index.html
- Moonshine: https://github.com/moonshine-ai/moonshine (README e LICENSE) e https://huggingface.co/moonshine-ai/moonshine-streaming-medium/discussions
- WER pt (FLEURS, Q8, Ryzen 4750U): https://models.handy.computer/languages/pt
- Nemotron: https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b (publicado em 2026-06-04)
- Parakeet: https://arxiv.org/pdf/2509.14128

Observação [opinião, não medido]: o Handy mede o Nemotron Q8 **nativo em CPU a 7,5× tempo real** num Ryzen
4750U, enquanto o WASM INT4 deste repo fica a 0,85× num PC mais forte. Essa diferença sugere que o gargalo está no
caminho WASM/INT4 com até 4 threads, não no modelo. Um export INT8 com threads explícitas poderia ficar em tempo
real em **PC sem GPU**. Para celular, não há dado que permita supor o mesmo.

Achado local: `apps/app/public/models/` tem um build `sherpa-onnx-wasm-main-asr` (682 MB de `.data`, 2025-08-24),
que está no `.gitignore` e não é usado por `apps/app/src`. É resto de um experimento anterior.

---

## 3. ASR no servidor

### 3.1 Modelos e capacidade

| Modelo | Streaming | Latência | WER pt | Capacidade por GPU | Licença | Fonte |
|---|---|---|---|---|---|---|
| **Nemotron 3.5 ASR streaming 0,6B** | sim, blocos de 80, 160, 320, **560** e 1.120 ms | definida pelo bloco | FLEURS: 6,29% (80 ms), 5,81% (320), **5,65% (560)**, 5,48% (1.120) | **H100: ~240 streams a 80 ms; ~2.400 a 1.120 ms.** 560 ms não publicado; fica entre os dois [opinião]. | OpenMDW-1.1 | https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b |
| Whisper large-v3-turbo | não nativo; whisper_streaming dá **3,3 s** de latência e foi marcado como "becoming outdated" em favor de SimulStreaming | ~3 s | FLEURS 4,17% (Q8) | não verificado | MIT | https://github.com/ufal/whisper_streaming ; Handy |
| Parakeet RNNT 1,1B (referência) | sim | — | — | H100: 14 streams a 80 ms, 400 a 1.120 ms | — | model card do Nemotron |

**Escolha para o servidor: Nemotron 3.5 streaming.** É o mesmo modelo que o ADR-0011 escolheu, tem o melhor
equilíbrio entre latência e WER pt entre as opções com streaming nativo, e roda nativo em GPU NVIDIA (o card
lista Turing até Blackwell) [fonte].

### 3.2 Custo [fonte para preço; opinião para a divisão]

| Item | Valor | Tipo |
|---|---|---|
| 1× L4, AWS `sa-east-1` (São Paulo), `g6.xlarge` sob demanda | US$ 1,368/h (us-east-1: US$ 0,80/h) | [fonte] https://www.doit.com/compute/spot/sa-east-1/g6.xlarge ; https://calculator.holori.com/aws/ec2/g6.xlarge/us-east-1 (jul/2026) |
| Mesma, spot | US$ 0,26 a 0,33/h; risco de interrupção > 20% (ruim para sessão ao vivo) | [fonte] idem |
| Streams por L4 a 560 ms | **não verificado.** Se for ≥ 20 (bem abaixo da escala H100 ÷ 4), sai a ~US$ 0,07 por sessão-hora. | [opinião] |
| GPU sempre ligada em SP | ~US$ 1.000/mês sob demanda (1,368 × 730 h) | [opinião, conta] |
| Dividir a GPU com o juiz | O ADR-0011 mediu o juiz numa 3090 Ti; ASR e juiz na mesma GPU **não foi medido** | [medido/pendente] |

Ligar a GPU só quando há sessão (escala a zero) não serve para o ao vivo, porque a primeira sessão do dia
esperaria a carga do modelo. É preciso ao menos uma réplica quente durante o horário de atendimento [opinião].

### 3.3 Latência e arquitetura

- **Primeira palavra** = bloco de 560 ms + ida e volta na rede + inferência na GPU (dezenas de ms [opinião]) ≈
  **0,7 a 0,9 s** [opinião, não medido]. No WebGPU local do PC deu 560 + ~150 ms [medido].
- **Rede:** PCM 16 kHz/16 bits = 256 kbit/s, ~96 MB numa sessão de 50 min. Com Opus a 32 kbit/s, ~12 MB [conta].
  Ida e volta celular → São Paulo: não verificado.
- **Arquitetura proposta:**
  - O navegador captura com AudioWorklet, roda VAD e manda os blocos por **WebSocket TLS autenticado pela sessão**
    ao serviço de ASR.
  - O serviço é sem estado, como o juiz. Mantém o cache do encoder **só em memória** durante o stream, devolve
    texto parcial e final com tempos de palavra, e descarta tudo ao fechar.
  - Sem disco, sem log de payload (o mesmo padrão da tarefa 20 para o juiz), mesma imagem imutável e versionada,
    réplicas atrás de um balanceador com afinidade por conexão.
- **Queda de rede:** o navegador guarda alguns segundos de áudio em memória e reenvia ao reconectar. Isso é
  resiliência, não "transcrever depois" [opinião].

### 3.4 Privacidade e LGPD: áudio é uma decisão diferente de texto

| Ponto | Texto (já autorizado no ADR-0011) | Áudio (decisão pendente do dono) | Tipo |
|---|---|---|---|
| Conteúdo de saúde | sim: a fala do paciente é dado de saúde, sensível (LGPD art. 5º II, art. 11) | sim, o mesmo | [fonte] LGPD; leitura minha |
| Biometria | não | a voz permite identificar a pessoa. A LGPD lista "dado biométrico" como sensível, mas não define se a voz bruta entra. A ANPD abriu tomada de subsídios sobre biometria (jun–ago/2025); não verifiquei se há norma final. | [fonte] https://www.gov.br/participamaisbrasil/ts-dados-biometricos ; resto não verificado |
| Reidentificação sem metadados | possível pelo conteúdo | **mais fácil**: a voz identifica a pessoa mesmo sem nome | [opinião] |
| GPU fora do Brasil | transferência internacional (D3) | idem, e com dado mais sensível | [fonte] Res. CD/ANPD 19/2024 (comentário: https://www.conjur.com.br/2024-set-01/regulamento-sobre-transferencia-internacional-de-dados/) |

Mitigações [opinião]: região Brasil (`sa-east-1`); áudio só em RAM, sem log; **nenhuma identificação de locutor
no servidor** (o servidor não sabe quem fala); termo de consentimento explícito que diga "o áudio passa pelo
servidor e não é guardado"; e parecer jurídico escrito antes de pacientes reais. Isso é análise técnica, não
parecer jurídico.

### 3.5 Diarização e identificação do profissional

- **Recomendo manter no aparelho:** pyannote-segmentation (6 MB, 42 ms por janela de 10 s em WASM no PC
  [medido]) e TitaNet (386 ms por chamada de até 5 s em WASM no PC [medido]). O servidor nunca processa a
  impressão de voz, e o perfil de voz do profissional não sai do aparelho.
- O texto do servidor traz tempos de palavra, e o app junta palavra e falante pelo tempo, como já faz com o motor
  local (tarefa 16/17).
- Alternativa no servidor: Streaming Sortformer (até 4 falantes, 1,04 s de latência, RTF 0,093 numa RTX 6000 Ada,
  CC-BY-4.0) [fonte: https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2]. Ela separa vozes, mas não
  diz quem é o profissional, e levar TitaNet ao servidor seria biometria no servidor. **Não recomendo.**
- Risco: pyannote + TitaNet em celular fraco **não foram medidos**. Os ~400 ms por chamada do TitaNet no PC
  podem virar 1 a 2 s no celular [opinião]. Ainda caberia no passo de 5 s, mas isso precisa de medição.

---

## 4. Híbrido por capacidade do aparelho

**"Captura agora, transcreve depois": descartado pelo dono (2026-10-09). Fora de análise.**

Híbrido = o app detecta WebGPU + memória e, se der, roda o motor local; senão, usa o ASR do servidor.

| | Prós | Contras |
|---|---|---|
| Híbrido (local forte + servidor) | Em PC com GPU, o áudio não sai do aparelho e a GPU do servidor é usada menos. | Dois motores para manter (WebGPU/ORT-web + serviço) e duas superfícies de teste. A detecção de capacidade é frágil: ter adaptador não quer dizer que roda (§1.3). Download de 790 MB. A promessa de privacidade passa a depender do aparelho ("seu áudio às vezes sai"), o que complica o consentimento. O trabalho jurídico e de infraestrutura do servidor tem de ser feito de qualquer jeito. |
| Servidor para todos | Uma única forma de transcrever, mesma qualidade e latência em qualquer aparelho, sem download de 790 MB e com o primeiro uso imediato. A detecção de capacidade não é necessária. | O áudio sempre sai (decisão do dono). Precisa de rede durante a sessão e de GPU sempre quente. |

Efeito na UX ao vivo e nos cartões [opinião]: com o servidor, o texto aparece ~0,7 a 0,9 s depois da fala em
qualquer aparelho. Os cartões do juiz dependem do texto fechado da fala do paciente, então ficam iguais nos dois
casos. A primeira sessão num celular local exigiria baixar 790 MB, o que em 4G é inviável como "primeira
experiência".

---

## 5. Recomendação

### 5.1 Arquitetura única

**ASR no servidor para todos os aparelhos. Diarização e identificação no aparelho.**

- **Aparelho (PC, tablet, celular, só navegador):**
  - microfone (AudioWorklet), VAD;
  - WebSocket de áudio para o serviço de ASR;
  - pyannote + TitaNet em WASM para dizer quem fala;
  - a fala do paciente, já com o falante, vai em texto ao juiz como hoje.
- **Serviço de ASR:**
  - Nemotron 3.5 streaming, bloco de 560 ms, NeMo/Riva nativo em GPU NVIDIA, região São Paulo;
  - sem estado, áudio só em RAM, sem log de payload, imagem imutável versionada (o mesmo molde do juiz);
  - pode dividir a GPU com o juiz se a medição permitir.
- **Cobertura:** qualquer navegador com microfone, AudioWorklet, WebSocket e WASM. Isso inclui Chrome/Samsung
  Internet Android, Safari iOS/iPadOS e Firefox, com ou sem WebGPU. Não depende de GPU, de RAM grande nem de
  download grande. O modelo de voz (pyannote 6 MB + TitaNet) ainda precisa de medição em celular fraco.

### 5.2 O que o profissional vê

| Aparelho | O que vê |
|---|---|
| PC (com ou sem GPU) | Transcrição ao vivo ~0,7 a 0,9 s atrás da fala; falante marcado em 4 a 8 s (borda estável da diarização [medido]); cartões como hoje. |
| Tablet | Igual ao PC. |
| Celular | Igual ao PC. Sem tela de "baixando modelo"; aviso fixo de que a sessão precisa de rede. |
| Sem rede no meio da sessão | Aviso "reconectando"; o áudio dos últimos segundos é reenviado ao voltar. A transcrição para enquanto a rede está fora. |

### 5.3 O que precisa ser medido (mínimo, em aparelhos reais, com voz humana)

Aparelhos: um Android de entrada (Motorola linha G ou Galaxy A de entrada), um Android intermediário (Galaxy A5x),
um iPhone com iOS 26 (12 ou 13), um iPad base e um notebook sem GPU dedicada. Áudio: 3 sessões simuladas de
10 min, terapeuta + paciente, pt-BR, com termos clínicos e transcrição de referência feita por gente.

| # | Teste | Métrica | Critério de aprovação [opinião, para o dono confirmar] |
|---|---|---|---|
| 1 | WER do Nemotron 560 ms no servidor, voz humana conversacional | WER por sessão | **≤ 15%** no geral e ≤ 10% nas falas do paciente sem sobreposição |
| 2 | Latência da primeira palavra, aparelho → servidor (4G e Wi-Fi) | p50 / p95 do fim da palavra até o texto na tela | p95 **≤ 1,5 s** em 4G, ≤ 1,0 s em Wi-Fi |
| 3 | Servidor acompanha o áudio | RTF p95 por stream com N streams simultâneos | **RTF p95 < 1** com N = alvo de pico; registrar o N máximo por L4 (e por GPU dividida com o juiz) |
| 4 | Diarização + TitaNet no aparelho | tempo por janela de 10 s e por chamada do TitaNet | p95 **< 5 s** (o passo da janela), sem fila crescente em 50 min |
| 5 | Acerto do falante | % de palavras com o falante certo | ≥ 90% sem sobreposição |
| 6 | Memória da aba | pico de RAM do processo/aba | **≤ 400 MB** no Android de entrada; sem a aba ser morta em 50 min |
| 7 | Bateria | % gasto em 50 min, tela ligada | **≤ 15%** no Android de entrada |
| 8 | Dados móveis | MB enviados em 50 min | ≤ 20 MB (Opus) |
| 9 | Queda de rede de 10 s | palavras perdidas | 0 palavras perdidas depois de reconectar |

### 5.4 Custo estimado [opinião, a medir no teste 3]

- 1 L4 em São Paulo sob demanda: ~US$ 1,37/h, ~US$ 1.000/mês sempre ligada. Ligada só em horário comercial
  (~250 h/mês): ~US$ 340/mês.
- Por sessão de 50 min: centavos de dólar se uma L4 atender ≥ 20 streams. Esse número não foi verificado.
- Dividir a GPU com o juiz pode tirar uma GPU inteira da conta. Isso não foi medido.

### 5.5 Impacto nas tarefas já feitas

| Tarefa | Impacto |
|---|---|
| **13** (export do encoder com Concat ≤ 6, `tools/asr-web`) | Sai do caminho da sessão: o servidor roda o modelo nativo, não ONNX-web. Pela regra do AGENTS.md (sem caminhos obsoletos), deve ser removida quando o ASR do servidor passar no teste. Pode ficar como evidência no spike. |
| **16** (motor ORT-web no Worker, mel, RNNT) | É trocada por um cliente WebSocket atrás da mesma interface `SessaoTranscricao` (`transcrever-ao-vivo.ts`). `apps/app/src/shared/audio/asr/{motor,mel,fluxo-asr,modelo}.ts` e o download de 790 MB saem. A CSP `connect-src` ganha a origem `wss://` do ASR. |
| **17** (pyannote + TitaNet no navegador) | **Fica e ganha peso**: é o que mantém a biometria no aparelho. Precisa dos testes 4 a 6 em celular. |
| **22** (medir em celular) | Muda de escopo: mede o servidor (testes 1 a 3, 8, 9) e a diarização local (4 a 7). |
| D2 / ADR-0011 | A D2 diz "nada de ASR hospedado; o áudio não sai do aparelho". **Isso se inverte**, e é preciso um ADR novo que substitua a parte de ASR do ADR-0011. |

### 5.6 O que o dono precisa decidir

1. **Aceitar áudio efêmero no servidor** (em RAM, sem gravação nem log, região Brasil) para **todos** os
   aparelhos. Sem isso, não há hoje caminho com evidência para tempo real em celular sem WebGPU. O plano B seria
   medir o Kroko PT (WER desconhecido, licença CC-BY-SA a confirmar) e, sem resultado, aceitar que celular fraco
   não transcreve ao vivo.
2. **Região:** só Brasil (~1,7× mais cara) ou exterior com cláusulas-padrão (D3). Para áudio, recomendo só Brasil.
3. **Texto do consentimento** ao profissional e ao paciente dizendo que o áudio passa pelo servidor, e **parecer
   jurídico escrito** antes de pacientes reais. O ADR-0011 tem só o aval do dono para texto.
4. **GPU quente no horário de atendimento** e o teto de custo mensal.
5. **Critérios do §5.3** (WER ≤ 15%, latência ≤ 1,5 s, bateria ≤ 15%): confirmar ou trocar.
6. Se o modo local em PC com GPU volta um dia como "áudio não sai do aparelho". Recomendo **não agora**: crescer em
   camadas sobre o servidor que funciona.

---

## Não verificado (resumo)

- Desempenho de qualquer ASR em navegador de celular, inclusive o Nemotron WebGPU em Adreno/Mali/Apple.
- Limite de memória por aba no Chrome Android e no Safari iOS.
- Parque de aparelhos dos profissionais de saúde no Brasil; quais modelos Galaxy usam Xclipse; a expansão do
  WebGPU para Android 11.
- WER do Kroko PT; se o Moonshine tem pt.
- Streams por L4 com o Nemotron a 560 ms; ida e volta 4G → São Paulo; ASR e juiz na mesma GPU.
- Se a ANPD já publicou norma sobre biometria/voz.
