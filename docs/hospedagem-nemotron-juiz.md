# Hospedagem da transcrição (Nemotron) e do juiz: onde, quanto, como escalar (2026-10-10)

Pesquisa e desenho. Nenhum código de produto mudou, nada foi contratado nem ligado.

Continua: `docs/pesquisa-nemotron-asr-escala.md` (modelo, NIM, capacidade por GPU), `docs/ambiente-de-teste.md`
(Cloudflare + Fly), `tools/nemotron/README.md` (servidor atual, medições em CPU), `tools/juiz/README.md` (imagem vLLM e
llama-server), `docs/analise-asr-celular.md` (decisão de levar o ASR ao servidor).

**Legenda (vale para o documento inteiro):**
- **[fonte Hn]**: lido na fonte n da tabela do fim (URL, data da página, data da consulta).
- **[medido]**: medido por nós neste repositório (máquina dita).
- **[estimativa]**: conta ou inferência minha. Só vira número de projeto depois de medida.
- **não verificado**: não achei fonte primária, ou a fonte não abriu.

Todas as fontes foram consultadas em 2026-10-10.

---

## Resumo

1. **Cloudflare não roda nenhum dos dois serviços como estão.** Containers não têm GPU ("coming soon") [H5], vão até
   4 vCPU por instância [H2] e não deixam escolher região [H3, H5]. Os Durable Objects, que fariam a ponta do WebSocket,
   **não nascem na América do Sul**: um objeto pedido para `sam` vai para o leste da América do Norte [H14]. O Workers
   AI não tem Nemotron nem diarização própria, e LoRA só existe em Gemma 1 (2B/7B, beta) [H6, H8]. Não dá para servir o
   nosso adaptador do Gemma 4 E4B lá. A Cloudflare continua boa para o que já faz: o app (Workers) e, se quisermos, o
   proxy TLS na frente.
2. **A GPU da Fly acabou.** A documentação de GPU da Fly hoje redireciona para um post do blog [H17], e um aviso enviado
   aos clientes marca o fim em 2026-07-31 [H18]. O plano do juiz de teste em `tools/juiz/deploy/fly.toml` **não funciona
   mais** e precisa de outro lugar.
3. **LGPD decide a região.** A transcrição recebe voz de paciente e o juiz recebe o texto da fala. Fora do Brasil é
   transferência internacional (já é a regra D3 citada em `tools/juiz/README.md`). Têm GPU em São Paulo: **AWS**
   (T4, A10G, L4) [H30], **Azure** (T4, A10 fracionada, A100) [H34] e **Google** (T4 e RTX PRO 6000, **sem L4**) [H31].
   Modal, RunPod, Vast, Lambda e Koyeb não têm região de datacenter no Brasil que eu tenha achado [H20, H23, H26–H29].
4. **Latência também pede São Paulo.** Ida e volta São Paulo ↔ Virgínia ≈ 115 ms [H38]. Com a meta de < 350 ms para o
   parcial, isso gasta um terço do orçamento antes de o modelo rodar [estimativa]. Hoje, em CPU, a primeira palavra
   aparece em ~1,1 a 1,3 s [medido, `tools/nemotron/README.md`]. A meta de 350 ms ainda não foi atingida em lugar nenhum.
5. **Recomendação [estimativa]:** começar com **uma `g6.xlarge` (1×L4) em `sa-east-1`**, US$ 1,368/h [H30], ligada só
   no horário (176 h/mês ≈ **US$ 241/mês**). Transcrição (NeMo-Speech.cpp CUDA) e juiz (vLLM) ficam em contêineres
   separados na mesma máquina, cada um com a sua URL. Separar em máquinas diferentes é mudar um DNS, não o código.
   Depois disso, dois grupos de autoescala separados.
6. **Os dois maiores riscos de custo não são a GPU da transcrição:**
   - **O juiz:** com 40 candidatos por fala, ele pode precisar de mais GPU que a transcrição (§4.4) [estimativa].
   - **A saída de rede da transcrição:** cada evento reenvia todas as palavras desde o início (~800 KB por evento aos
     50 min [medido, `tools/nemotron/README.md`]). Isso pode dar ~3 GB por sessão-hora, e na AWS São Paulo a saída
     custa ~US$ 0,15/GB (não verificado) [H39]. Precisa virar delta antes da internet.

---

## 1. Cloudflare

### 1.1 Workers AI

| Pergunta | Resposta | Tipo |
|---|---|---|
| Modelos de ASR no catálogo | `flux` e `nova-3` (Deepgram), `whisper`, `whisper-large-v3-turbo`, `whisper-tiny-en` (OpenAI) | [H6], página de 2026-08-12 |
| Nemotron ou qualquer modelo NVIDIA de ASR | não aparece no catálogo | [H6] |
| Modelo próprio (subir o NeMo-Speech.cpp ou um GGUF nosso) | o catálogo e a página de LoRA só tratam de modelos da Cloudflare | [H6, H8]; "bring your own model" **não verificado** |
| Whisper em streaming | não: `whisper-large-v3-turbo` é marcado "Batch", sem falante na saída | [H11] |
| Diarização | não há modelo de diarização. O `nova-3` aceita `diarize` (número do falante por palavra) | [H6, H9] |
| `nova-3` em português | sim: `pt`, `pt-BR`, `pt-PT` e `multi` (Deepgram) | [H12] |
| `nova-3` em tempo real | sim, por WebSocket; `interim_results` só no WebSocket | [H9] |
| Preço do ASR | `whisper` e `whisper-large-v3-turbo`: US$ 0,0005/min. `nova-3`: US$ 0,0052/min (HTTP) e **US$ 0,0092/min (WebSocket)**. `flux` WebSocket: US$ 0,0077/min | [H7] (2026-10-09), [H9] |
| Por sessão-hora de 1 stream (`nova-3` WebSocket) | 0,0092 × 60 = **US$ 0,55** | [estimativa] |
| LoRA própria | sim, em beta e grátis durante o beta; rank ≤ 8 (aceita até 32), arquivo < 300 MB, base sem quantização, até 100 adaptadores por conta | [H8], página de 2026-04-21 |
| LoRA em Gemma | só em `gemma-2b-it-lora` e `gemma-7b-it-lora` (Gemma 1, beta) | [H6, H8] |
| Gemma 4 | só `gemma-4-26b-a4b-it`, sem LoRA na lista de capacidades; US$ 0,10 por M de tokens de entrada e US$ 0,30 por M de saída. **Não há Gemma 4 E4B** | [H10] |
| Franquia e preço base | 10.000 neurons por dia grátis; US$ 0,011 por 1.000 neurons | [H7] |

**O que dá [estimativa]:**
- Trocar a transcrição pelo `nova-3` WebSocket com `diarize`. Isso troca o modelo, o protocolo e o cliente (o app hoje
  fala o protocolo do NeMo-Speech.cpp), e custa ~US$ 0,55 por sessão-hora. O WER do `nova-3` em pt-BR clínico não foi
  medido por nós. Onde a inferência roda também não foi verificado (§1.3).

**O que não dá:**
- Servir o juiz atual: o adaptador é de Gemma 4 E4B e não existe base compatível [H6, H8, H10].
- Rodar o Nemotron 3.5 ou o Nemotron 3 Diarization no Workers AI [H6].

### 1.2 Cloudflare Containers

| Item | Valor | Tipo |
|---|---|---|
| GPU | **não**: "GPU support (coming soon)" | [H5]; a página de preço não fala de GPU [H1] |
| Maior instância | `standard-4`: 4 vCPU, 12 GiB, 20 GB de disco. Tipo próprio: até 4 vCPU, 12 GiB, ≥ 3 GiB por vCPU | [H2], 2026-09-30 |
| Limites da conta | 1.500 vCPU, 6 TiB de RAM e 30 TB de disco simultâneos; 50 GB de imagens | [H2] |
| Preço | CPU US$ 0,000020 por vCPU-s **ativo**; memória US$ 0,0000025 por GiB-s provisionado; disco US$ 0,00000007 por GB-s; cobrança em passos de 10 ms. Franquia mensal: 375 vCPU-min, 25 GiB-h, 200 GB-h | [H1], 2026-10-05 |
| Saída de rede | US$ 0,025/GB (América do Norte e Europa, 1 TB grátis); US$ 0,04/GB no "resto do mundo" (500 GB grátis) | [H1] |
| `standard-4` cheio por hora | 4 × 0,072 + 12 × 0,009 = US$ 0,396/h → **US$ 0,099 por vCPU-hora** | [estimativa, conta sobre H1] |
| Partida a frio | "often in the 1-3 second range", depende da imagem | [H3] |
| Duração máxima | não documentada | [H3] |
| Desligamento | `SIGTERM`, espera até 15 min, depois `SIGKILL`; parada também por inatividade (`sleepAfter`, padrão 10 min) ou novo deploy | [H3] |
| WebSocket | passa: o Worker manda o pedido ao Durable Object, que sobe o contêiner e devolve o upgrade. Um WebSocket aberto mantém o objeto ativo | [H4], 2026-10-02 |
| Região | não se escolhe: "No Kubernetes, no regions"; a Cloudflare põe a instância onde achar melhor e pode pô-la longe do usuário | [H3, H5] |
| Brasil | a página não cita Brasil; os únicos exemplos de local são na Argentina | [H3] |

**O que dá [estimativa]:** rodar o NeMo-Speech.cpp em CPU, uma ou poucas sessões por contêiner (no máximo 4 vCPU por
instância). Custo ≈ `núcleos_por_sessão × 0,099` US$/h, mais saída de rede.

**O que não dá:**
- GPU, então nada de diarização `v3-streaming` em tempo real (em CPU ela fica para trás [medido, `tools/nemotron/README.md`]).
- Garantir que o áudio fica no Brasil [H3, H5], o que é um problema de LGPD.
- Juiz em vLLM.

### 1.3 Durable Objects como dono da sessão WebSocket

| Item | Valor | Tipo |
|---|---|---|
| Preço | 1 M de pedidos por mês incluídos, depois US$ 0,15/M; duração 400.000 GB-s por mês incluídos, depois US$ 12,50 por M de GB-s, contada a 128 MB por objeto | [H13], 2026-09-30 |
| Mensagens WebSocket | entrada cobrada a 20:1 (100 mensagens = 5 pedidos); saída e pings não cobram | [H13] |
| Hibernação | objeto ocioso não paga duração. Com áudio chegando a cada 80 ms o objeto nunca fica ocioso | [H13]; [estimativa] para o nosso caso |
| Custo de uma sessão-hora | 0,125 GB × 3.600 s = 450 GB-s ≈ US$ 0,0056; 12,5 mensagens/s × 3.600 ÷ 20 = 2.250 pedidos ≈ US$ 0,0003. Total **< US$ 0,01** | [estimativa, conta sobre H13] |
| Onde roda | `sam` é só uma dica: "Durable Objects currently do not spawn in this location". Vai para um lugar próximo suportado, por exemplo o leste da América do Norte. Jurisdição forçada só existe para `eu`, `us` e `fedramp` | [H14], 2026-06-26 |
| Deploy | "Code updates disconnect all WebSockets" | [H15], 2026-09-30 |

**Veredito [estimativa]:** é barato, mas põe um salto até a América do Norte no caminho de todo quadro de áudio, além de
a transferência internacional. Também derruba as sessões de 50 min a cada deploy. **Não usar para a transcrição.**
O proxy comum da Cloudflare (DNS laranja), que termina TLS no ponto de presença e repassa o WebSocket para uma origem em
São Paulo, é outra coisa. Não avaliei o ponto de presença de São Paulo nem a política de TLS dele: **não verificado**.

---

## 2. Alternativas com GPU

### 2.1 Tabela geral

Preço por GPU-hora, sob demanda, em US$. Quando o preço é de uma máquina inteira, a máquina está dita.

| Provedor | Região no Brasil | T4 | L4 | A10 / A10G | Outras baratas | Escala a zero | Partida a frio | WebSocket de 50 min | Fonte |
|---|---|---|---|---|---|---|---|---|---|
| **AWS `sa-east-1`** | **sim** | `g4dn.xlarge` 0,894 | `g6.xlarge` **1,368** | `g5.xlarge` 1,71 | — | sim, com grupo de autoescala (EC2) | minutos (máquina + carga do modelo) [estimativa] | sim (é uma VM) | [H30] (preços de 2026-10-09) |
| **Azure Brazil South** | **sim** | `NC4as_T4_v3` 0,894 | — | `NV6ads_A10_v5` 0,908 (1/6 de A10); `NV36ads_A10_v5` 6,40 (A10 inteira) | `NC24ads_A100_v4` 7,346 | sim (VMSS) [estimativa] | minutos [estimativa] | sim (VM) | [H34] |
| **Google `southamerica-east1`** | **sim** | N1 + T4 nas zonas a, b, c | **não tem** | — | G4 (RTX PRO 6000) nas zonas a e b | sim (MIG) [estimativa] | minutos [estimativa] | sim (VM) | [H31]; preço da T4 em SP **não verificado** (US$ 0,35 aparece sem região [H40]) |
| Google Cloud Run GPU | **não** (L4 só em EUA, Europa e Ásia) | — | sim, fora do Brasil | — | RTX PRO 6000 | sim | "approximately 5 seconds" sem carregar o modelo | até 60 min por pedido (**não verificado**) | [H32], 2026-10-07 |
| Oracle São Paulo | GPUs na região **não verificadas** | — | — | A10 2,00 (preço da lista) | L40S 3,50 | — | — | VM | [H35, H36] |
| Magalu Cloud | sim (empresa brasileira) | — | — | — | L40/L40S segundo resumo de busca | — | — | — | **não verificado**: o simulador de preço carrega dinamicamente [H37] |
| Fly.io | `gru` só CPU | — | — | — | — | — | — | — | **GPU encerrada** [H17, H18] |
| Modal | só `sa` ("South America"), sem dizer o país | 0,59 | **0,80** | 0,80 (A10, 1,10) | L40S 1,95 | sim | "a few seconds" para subir o contêiner, mais o modelo | sim, uma conexão = uma chamada; chamada de até 24 h; mensagem ≤ 2 MiB | [H19–H22] |
| RunPod pods | não achei | — | 0,44 a 0,59 | — | RTX 3090 0,22 a 0,50; RTX 4090 0,34 a 0,89 | não (pod é VM) | — | sim (pod) | [H23]; a própria página se contradiz em alguns preços |
| RunPod serverless | não achei | — | 0,69 | — | grupo 16 GB 0,58 | sim (ociosidade padrão de 5 s) | FlashBoot reduz, sem número | **não**: o endpoint com balanceador tem tempo limite de 5,5 min por pedido | [H23–H25] |
| Vast | **19 ofertas no Brasil**, todas de anfitrião particular (RTX 4090 0,39 a 1,78; RTX 3090 0,26 a 0,51) | mediana 0,18 | mediana 0,33 | 0,24 (1 oferta) | RTX 3090 mediana 0,22; RTX 4090 mediana 0,46 | não | — | sim (máquina) | [H26], consulta à API |
| Lambda | não diz regiões | — | — | A10 1,29 | A6000 1,09 | não | — | sim (VM) | [H27] |
| Koyeb | **não** (EUA, Europa, Ásia) | — | 0,70 | — | RTX 4000 SFF Ada 0,50 | sim | — | sim | [H28, H29] (regiões: 2026-05-27) |

Notas:
- **Modal com região e sem preempção:** escolher região multiplica o preço por 1,15 a 1,75. Execução sem preempção
  custa **3×** [H19, H20]. Uma sessão de 50 min não deve ser interrompida, então o preço real da L4 seria de US$ 0,80
  × 1,15 × 3 ≈ **US$ 2,76/h** [estimativa]. Se a preempção for aceita (com reconexão no cliente), fica em ~US$ 0,92/h.
- **Vast com anfitrião particular** não serve para dado de saúde [estimativa]: não há contrato de operador nem controle
  físico. Serve para teste com dado sintético e para treino (`tools/juiz/README.md` já diz isso).
- **T4 e o juiz:** a T4 é Turing, sem bfloat16 [estimativa, arquitetura conhecida; não verificado nesta pesquisa]. O vLLM com
  Gemma 4 em bf16 precisaria rodar em fp16 ou cair no llama.cpp Q4. A NIM também não aceita T4 (capacidade 7.5, mínimo
  8.0) [`pesquisa-nemotron-asr-escala.md` F11]. O NeMo-Speech.cpp roda CUDA em Turing [mesmo doc, F21].

### 2.2 Latência até São Paulo

| Trajeto | Ida e volta | Tipo |
|---|---|---|
| `sa-east-1` ↔ `us-east-1` | ~115 ms | [H38] (terceiro; não diz se é ida e volta) |
| `sa-east-1` ↔ `us-east-2` | ~125 ms | [H38] |
| Usuário em SP ↔ servidor em SP | não medido | não verificado |

**Leitura [estimativa]:** para o juiz, que tem tempo limite de 20 s no orquestrador (`tools/juiz/README.md`), 115 ms não
importa. Para o parcial da transcrição com meta < 350 ms, importa muito.

---

## 3. Transcrição só em CPU: vale a pena?

### 3.1 O que já medimos

| Configuração (Ryzen 9 5900X, pilha de dev no ar) | Resultado | Tipo |
|---|---|---|
| `v3-streaming`, 8 ou 20 threads | o atraso cresce até 9 s em 70 s de áudio: não acompanha | [medido, `tools/nemotron/README.md`] |
| Geometria ajustada (blocos de 4,8 s, `--threads 12`) | final 0,9 a 1,4 s, estável por 5 min 10 s; 96,8% das palavras com o falante certo (voz TTS) | [medido, idem] |
| Primeira palavra visível | ~1,1 a 1,3 s | [medido, idem] |
| Núcleos realmente usados por sessão | **o dono vai mandar** | — |

### 3.2 Fórmula

```
custo_por_hora_de_sessão (US$) = núcleos_por_sessão × preço_por_vCPU_hora × (1 + folga)
custo_mensal (US$)             = sessões_simultâneas × custo_por_hora_de_sessão × 176     # 8 h × 22 dias
```

**Cuidado com a unidade de "núcleo" [estimativa]:**
- Na AWS x86 (c7i, c6a), no Azure e no Google, 1 vCPU = 1 thread (meio núcleo físico com SMT).
- Na AWS Graviton (c7g, c8g), 1 vCPU = 1 núcleo físico.
- Na Oracle, 1 OCPU = 1 núcleo físico = 2 vCPU no x86. No Modal, 1 núcleo físico = 2 vCPU [H19].
- Se a medição no Ryzen contar **threads**, use 1:1 em vCPU x86. Se contar **núcleos físicos**, multiplique por 2 em vCPU x86.
- Build ARM do NeMo-Speech.cpp: **não verificado**. A imagem atual é x86 (`tools/nemotron/README.md`).

### 3.3 Preço por vCPU-hora

| Provedor e máquina | Região | US$/h da máquina | **US$ por vCPU-hora** | Tipo |
|---|---|---|---|---|
| AWS `c7g.2xlarge` (Graviton3, 8 vCPU, 16 GiB) | `sa-east-1` | 0,4443 | **0,0555** (núcleo físico) | [H30] |
| AWS `c8g.2xlarge` (Graviton4) | `sa-east-1` | 0,4887 | 0,0611 | [H30] |
| AWS `c6a.2xlarge` (AMD) | `sa-east-1` | 0,4716 | 0,0590 | [H30] |
| AWS `c7i.2xlarge` (Intel) | `sa-east-1` | 0,5502 | 0,0688 | [H30] |
| Google `n2d-highcpu-8` | `southamerica-east1` | 0,3961 | 0,0495 | [H33] (terceiro, 2026-10-04) |
| Google `c4-highcpu-8` | `southamerica-east1` | 0,5402 | 0,0675 | [H33] |
| Azure `F8s_v2` | Brazil South | 0,524 | 0,0655 | [H34] |
| Azure `F8als_v6` | Brazil South | 0,776 | 0,0970 | [H34] |
| Oracle E6 (x86) | São Paulo **não verificado** | OCPU 0,03 + 0,002/GB | **~0,019** (½ OCPU + 2 GB) | [H35]; preço igual em toda região **não verificado** |
| Oracle A1 (Ampere, ARM) | idem | OCPU 0,01 (+ memória, preço não lido) | ~0,01 + memória | [H35] |
| Fly `performance-8x` (16 GB) | `gru` (×1,62 sobre `iad`) | ~0,594 | **~0,074** | [H16] (preço calculado pela fórmula da página) |
| Cloudflare Containers `standard-4` | sem região | 0,396 | 0,099 | [H1], conta minha |
| Modal CPU | `sa`, multiplicador desconhecido | 0,047 por núcleo físico + 0,008 por GiB-h | ~0,024 + memória, × região (1,15 a 1,75) × 3 sem preempção | [H19, H20] |
| Magalu Cloud | Brasil | — | **não verificado** | [H37] |

### 3.4 Quando a CPU ganha da GPU [estimativa]

```
CPU é mais barata se: núcleos_por_sessão < (preço_GPU_hora ÷ sessões_por_GPU) ÷ preço_vCPU_hora
```

Com L4 em São Paulo (US$ 1,368/h) e c7g (US$ 0,0555/vCPU-h):

| Sessões por L4 (não medido) | Custo de GPU por sessão-hora | A CPU ganha se cada sessão usar menos de |
|---|---|---|
| 20 | US$ 0,068 | 1,2 vCPU |
| 50 | US$ 0,027 | 0,5 vCPU |
| 100 | US$ 0,014 | 0,25 vCPU |

**Leitura:** hoje uma sessão com diarização ocupa um pool de 12 threads e mal acompanha o tempo real (cerca de 1,12× o
áudio antes do ajuste) [medido, `tools/nemotron/README.md`]. Se a medição do dono der ≥ 2 vCPU por sessão, **a CPU só vale
para dezenas de sessões**: como piso barato e fora do horário, ou para a sessão online sem diarização, que é mais leve
(final constante em 0,8 s [medido, idem]). A partir de ~20 sessões simultâneas a L4 deve ganhar. Isso depende de
medir quantas sessões cabem numa L4 com o NeMo-Speech.cpp CUDA, número que **ninguém publicou**
[`pesquisa-nemotron-asr-escala.md` §3.2].

Exemplo com `k` vCPU por sessão, c7g, folga de 20%, 176 h/mês [estimativa]:

| Sessões simultâneas | k = 1 | k = 2 | k = 4 |
|---|---|---|---|
| 10 | US$ 117 | US$ 234 | US$ 469 |
| 100 | US$ 1.172 | US$ 2.344 | US$ 4.689 |
| 1.000 | US$ 11.722 | US$ 23.443 | US$ 46.886 |

---

## 4. Arquitetura recomendada

### 4.1 Princípios [estimativa, seguindo o AGENTS.md: camada por camada, sem paliativo]

- **Os dois serviços ficam em São Paulo, num provedor com contrato de operador**, por LGPD e latência. AWS `sa-east-1`
  é o único com L4, A10G e T4 no Brasil com preço público lido nesta pesquisa [H30]. É também a região citada nos
  documentos anteriores.
- **Cada serviço tem a sua URL, a sua imagem e o seu grupo de máquinas**, mesmo quando dividem a primeira máquina. Separar
  depois é trocar o DNS.
- **Os servidores não guardam estado.** O estado da sessão (cache do modelo, falantes) vive em RAM pela duração do
  WebSocket. Reconectar recomeça a sessão no servidor, e o cliente recupera pelo índice de amostra
  (`pesquisa-nemotron-asr-escala.md` §3.3).
- **A Cloudflare continua servindo o app.** Ela não entra no caminho do áudio (§1.3).

### 4.2 Desenho por fase

```
Fase 1 (até ~10-20 sessões)                  Fase 2 (dezenas a centenas)            Fase 3 (milhares)
navegador ──wss──► Caddy (TLS, ticket)      navegador ──wss──► ALB (TLS/ACM)        igual à fase 2, com
               │                                         │  rota por host          mais GPUs por máquina
               ├─► nemotron:8080 (CUDA)                  ├─► ASG "transcricao"     (g6.12xlarge / H100)
               └─► juiz:8000 (vLLM) ◄── orquestrador     │    L4, escala por sessões e NIM se a medição
    1× g6.xlarge sa-east-1, ligada em horário            └─► ASG "juiz" (L4) ◄──   mostrar ganho
                                                              orquestrador (HTTP)
```

| Peça | Fase 1 | Fase 2+ | Tipo |
|---|---|---|---|
| TLS | Caddy na própria máquina, certificado automático | ALB com certificado do ACM. O idle timeout do ALB vai até 4.000 s (**não verificado**), e áudio contínuo mantém a conexão viva | [estimativa] |
| Chave de API da transcrição | O NeMo-Speech.cpp não tem chave nem TLS (`tools/nemotron/README.md`). A API emite um **tíquete de uso único, de 60 s**. O navegador não manda cabeçalho no WebSocket, então o tíquete vai na query ou no subprotocolo, e o proxy valida com a API (Caddy `forward_auth`). A query **não** pode ir para o log | [estimativa] |
| Chave do juiz | `VLLM_API_KEY` já existe. Só o orquestrador chama o juiz, e o juiz fica em rede privada (security group que só aceita o orquestrador) | `tools/juiz/README.md`; [estimativa] |
| Afinidade WebSocket | Uma conexão TCP já fica numa máquina só. Não precisa de sticky session. Reconexão pode cair em outra máquina, e o cliente reenvia a partir do último ponto confirmado | [estimativa] |
| Admissão | Cada servidor aceita no máximo `C` sessões (o número medido). Acima disso recusa, e o cliente tenta de novo, caindo em outra máquina. O NeMo-Speech.cpp tem `max_queue_depth` [`pesquisa…` F21] | [estimativa] |
| Autoescala da transcrição | Métrica: sessões abertas ÷ `C` por máquina, alvo 60 a 70%. Subir leva minutos, então: **ação agendada** (sobe às 7h45, desce às 18h15) e mais uma máquina de folga. Ao descer, proteção contra encerramento enquanto houver sessão aberta, com drenagem de até 60 min | [estimativa] |
| Autoescala do juiz | Métrica: fila e tempo de resposta do vLLM. Pedidos são curtos, então dá para descer rápido. Mínimo de 1 no horário, 0 fora | [estimativa] |
| Fora do horário | Grupos em 0. A primeira sessão fora do horário espera a máquina subir (minutos), ou é recusada com aviso. **Decisão do dono** | [estimativa] |
| Imagem | Pesos dentro da imagem (como o juiz já faz) ou num volume EBS pré-carregado, para cortar o download na partida | `tools/juiz/README.md`; [estimativa] |
| Saída de rede | Trocar os eventos cumulativos por **delta + confirmação**, ou limitar `words` às palavras não finais, antes de abrir para a internet | [medido] (tamanho), [estimativa] (custo) |
| Logs | Sem corpo de pedido, sem query, sem disco de dados, nos dois serviços. Uma frase-sentinela no teste de carga e um grep nos logs, que precisa dar 0 | `tools/juiz/README.md`; `pesquisa…` §5.5 |

### 4.3 Juiz e transcrição: juntos ou separados?

| Opção | Prós | Contras | Quando |
|---|---|---|---|
| Mesma L4 (24 GB), dois contêineres | uma máquina só; ~US$ 241/mês no horário | um pico do juiz atrasa o parcial; o vLLM precisa de `--gpu-memory-utilization` menor (o README já documenta 0,80 com outro modelo junto) | fase 1 |
| Máquinas separadas | cada um escala pela sua métrica; a transcrição fica protegida | duas máquinas mínimas | quando um dos dois passar de ~70% de uma L4 |

VRAM na L4 [estimativa]: transcrição com q8 ≈ 742 MB + 107 MB de pesos [`pesquisa…` F1, F5], mais o estado por sessão. O juiz
em vLLM a 0,60 a 0,70 da GPU. **Não medido.**

### 4.4 Custo mensal estimado (8 h × 22 dias = 176 h; AWS `sa-east-1`; GPUs ligadas o horário todo)

**Premissas, todas [estimativa]:**
- L4 `g6.xlarge` a US$ 1,368/h [H30] → US$ 240,8 por GPU por mês.
- **Transcrição:** `C_T` sessões por L4 com o NeMo-Speech.cpp CUDA + diarização. **Não medido.** Cenários de 50 e de 20. Mais
  uma GPU de folga (ou +10% acima de 20 GPUs).
- **Juiz:** a cada fala do paciente (uma a cada ~20 s), 40 candidatos (`COPILOTO_CANDIDATOS_JUIZ`) de ~250 tokens novos
  cada, com a rubrica e a fala em cache de prefixo, mais uma reescrita de até 260 tokens (`juiz_llm.py`). Isso dá ~500
  tokens/s de prefill por sessão. Uma L4 tem 121 TFLOPS FP16 densos (metade dos 242 com esparsidade
  [`pesquisa…` F31]). O E4B tem ~4B parâmetros efetivos, o que dá ~7.000 tokens/s úteis. Resultado: `C_J` ≈ 10 sessões por L4
  com folga. Cenário otimista: 30 (menos candidatos ou fala mais rara). **Nada disso foi medido.**
- A sessão-hora conta como se o pico durasse as 8 h: é um teto.
- Fora da conta: banco, API e orquestrador (já existem), ALB (preço em SP **não verificado**) e saída de rede (§4.2).

| Pico simultâneo | Transcrição `C_T`=50 | Transcrição `C_T`=20 | Juiz `C_J`=30 | Juiz `C_J`=10 | **Total (melhor … pior)** |
|---|---|---|---|---|---|
| **10** | 1 L4 compartilhada com o juiz: **US$ 241** | idem | (na mesma L4) | (na mesma L4) | **~US$ 241** (1 máquina; +US$ 241 se separar) |
| **100** | 3 L4: US$ 722 | 6 L4: US$ 1.445 | 5 L4: US$ 1.204 | 11 L4: US$ 2.649 | **~US$ 1.900 … 4.100** |
| **1.000** | 22 L4: US$ 5.297 | 55 L4: US$ 13.242 | 38 L4: US$ 9.149 | 110 L4: US$ 26.485 | **~US$ 14.400 … 39.700** |

Para comparar [estimativa]:
- **Só CPU** para a transcrição de 1.000 sessões, com k = 2 vCPU em c7g: US$ 23.443 (§3.4).
- **Workers AI `nova-3`** para 1.000 sessões: 1.000 × 176 × 0,55 ≈ US$ 97.000 [H9].
- **Saída de rede com o protocolo atual:** ~3 GB por sessão-hora × US$ 0,15 × 176.000 sessões-hora ≈ US$ 79.000.
  **Precisa corrigir antes da fase 2.**
- **Acima de ~1.000 sessões**, a conta da NIM em H100 do documento anterior (~US$ 0,015 por stream-hora, já com a
  licença) passa a ganhar da L4 com o NeMo-Speech.cpp [`pesquisa…` §3.5]. A NIM não roda em T4 e pede licença em
  produção [`pesquisa…` F11, F19].

### 4.5 Ambiente de teste (dado sintético)

O juiz de teste precisa sair da Fly (§Resumo, item 2). Opções [estimativa]:

| Opção | US$/h | Escala a zero | Observação |
|---|---|---|---|
| Modal L4, com preempção | ~0,92 | sim, nativo | o mais perto do que a Fly fazia; a imagem vLLM roda como `web_server` [H19, H21] |
| RunPod pod L4 | 0,44 a 0,59 | não (desligar na mão) | [H23] |
| Vast RTX 3090/4090 | 0,15 a 0,46 | não | já usada para treinar [H26] |
| A mesma `g6.xlarge` de São Paulo da fase 1 | 1,368 | parar a instância | um ambiente só, igual ao de produção |

---

## 5. Próximas medições (por ordem)

1. **Núcleos por sessão** em CPU (o dono manda), com e sem diarização. Entra na fórmula do §3.2.
2. **Sessões por L4** com o NeMo-Speech.cpp CUDA (`v3-streaming`, bloco de 80/160 ms para a meta de 350 ms): sobe N até o
   atraso crescer. Numa `g6.xlarge` por algumas horas, ou numa L4 da Vast com dado sintético.
3. **Juiz:** pedidos por fala, tokens por pedido e vazão do vLLM numa L4. Decide `C_J`.
4. **Saída de rede** por sessão-hora, antes e depois do delta.
5. **Ida e volta** do celular (4G e Wi-Fi) até `sa-east-1`.

---

## Não verificado (resumo)

- Preço da T4 em `southamerica-east1`; GPUs e preços da Oracle e da Magalu em São Paulo.
- Preço de saída de rede e do ALB na AWS São Paulo; idle timeout máximo do ALB.
- Se o Cloudflare Containers põe instância no Brasil; duração máxima de um contêiner; "bring your own model" no Workers AI.
- Onde a inferência do Workers AI roda para um pedido vindo do Brasil.
- Build ARM do NeMo-Speech.cpp; sessões por GPU com o NeMo-Speech.cpp; vazão do juiz.
- Tempo de 60 min do Cloud Run para WebSocket (não há L4 no Brasil de qualquer forma).
- A data exata do fim da GPU da Fly: o aviso diz 2026-07-31 [H18], mas a documentação oficial que eu abri só redireciona [H17].

---

## Fontes (todas consultadas em 2026-10-10)

| Id | Fonte | Data da página |
|---|---|---|
| H1 | https://developers.cloudflare.com/containers/pricing/ | 2026-10-05 |
| H2 | https://developers.cloudflare.com/containers/platform-details/limits/ | 2026-09-30 |
| H3 | https://developers.cloudflare.com/containers/platform-details/architecture/ | 2026-09-30 |
| H4 | https://developers.cloudflare.com/containers/examples/websocket/ | 2026-10-02 |
| H5 | https://www.cloudflare.com/products/containers.md | sem data |
| H6 | https://developers.cloudflare.com/workers-ai/models/ | 2026-08-12 |
| H7 | https://developers.cloudflare.com/workers-ai/platform/pricing/ | 2026-10-09 |
| H8 | https://developers.cloudflare.com/workers-ai/features/fine-tunes/loras/ | 2026-04-21 |
| H9 | https://developers.cloudflare.com/workers-ai/models/nova-3/ | sem data |
| H10 | https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/ | sem data |
| H11 | https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/ | sem data |
| H12 | https://developers.deepgram.com/docs/models-languages-overview | sem data |
| H13 | https://developers.cloudflare.com/durable-objects/platform/pricing/ | 2026-09-30 |
| H14 | https://developers.cloudflare.com/durable-objects/reference/data-location/ | 2026-06-26 |
| H15 | https://developers.cloudflare.com/durable-objects/best-practices/websockets/ | 2026-09-30 |
| H16 | https://docs.fly.io/about/pricing (preços calculados pela fórmula da página; multiplicador de `gru` ≈ 1,62) | sem data |
| H17 | https://fly.io/docs/gpus/ → https://docs.fly.io/gpus → redireciona (307) para https://fly.io/blog/wrong-about-gpu/ | redirecionamento visto em 2026-10-10 |
| H18 | https://community.fly.io/t/gpu-migration-fly-io-gpus-will-be-deprecated-as-of-july-31-2026/27110 (e-mail citado por cliente; sem resposta da equipe) | 2026-02-11 |
| H19 | https://modal.com/pricing | sem data |
| H20 | https://modal.com/docs/guide/region-selection | sem data |
| H21 | https://modal.com/docs/guide/webhooks | sem data |
| H22 | https://modal.com/docs/guide/timeouts | sem data |
| H23 | https://www.runpod.io/pricing | sem data; tabela e dados estruturados divergem |
| H24 | https://docs.runpod.io/serverless/pricing | sem data |
| H25 | https://docs.runpod.io/serverless/load-balancing/overview | sem data |
| H26 | API pública da Vast: `https://console.vast.ai/api/v0/bundles/` (ofertas sob demanda, 1 GPU, por modelo, e filtro `geolocation=BR`) | consulta em 2026-10-10 ~12:52 (preço muda a toda hora) |
| H27 | https://lambda.ai/pricing | sem data |
| H28 | https://www.koyeb.com/pricing | sem data |
| H29 | https://www.koyeb.com/docs/reference/regions | 2026-05-27 |
| H30 | https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/South%20America%20(Sao%20Paulo)/Linux/index.json | publicado em 2026-10-09T20:31Z |
| H31 | https://docs.cloud.google.com/compute/docs/gpus/gpu-regions-zones | sem data visível |
| H32 | https://docs.cloud.google.com/run/docs/configuring/services/gpu | 2026-10-07 |
| H33 | https://gcloud-compute.com/southamerica-east1.html (terceiro; "accuracy not guaranteed") | 2026-10-04 |
| H34 | API de preços do Azure: `https://prices.azure.com/api/retail/prices` (`armRegionName eq 'brazilsouth'`, Consumption, Linux) | consulta em 2026-10-10 |
| H35 | Lista de preços da Oracle: `https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD` | consulta em 2026-10-10 |
| H36 | https://docs.oracle.com/en-us/iaas/Content/Compute/References/computeshapes.htm (sem tabela de região) | consulta em 2026-10-10 |
| H37 | https://magalu.cloud/precos/ (simulador dinâmico, sem números no HTML); `pesquisa-nemotron-asr-escala.md` F29 | consulta em 2026-10-10 |
| H38 | https://www.economize.cloud/resources/aws/latency/sa-east-1-vs-us-east-1/ (terceiro) | sem data |
| H39 | https://aws.amazon.com/es/blogs/aws-spanish/ensayos-transferencia-datos-aws (US$ 0,15/GB a partir de São Paulo; post possivelmente antigo) | não verificado |
| H40 | https://cloud.google.com/products/compute/gpus-pricing (trecho de busca: T4 US$ 0,35/h, sem região) | não verificado |
| R | Repositório: `tools/nemotron/README.md`, `tools/juiz/README.md`, `mvp-copiloto/src/copiloto/juiz_llm.py`, `docs/pesquisa-nemotron-asr-escala.md`, `docs/ambiente-de-teste.md`, `docs/analise-asr-celular.md` | ramo `codex/copiloto-mvp`, 2026-10-10 |
