# ADR-0011 · Onde rodam a transcrição, a diarização e o juiz

- Status: aceito pelo responsável do produto em 2026-10-08 (aval sobre o texto da fala; o resto a medir). **Substituído em parte pelo `ADR-0012-transcricao-no-servidor.md` (2026-10-10): o ASR e a diarização saíram do navegador. O juiz em serviço, só texto, continua como aqui.**
- Data: 2026-10-08

## Contexto

O produto precisa funcionar em celular, tablet e PC, só com navegador, sem lentidão perceptível,
inclusive a transcrição com identificação de quem fala.

Hoje o código faz outra coisa. `packages/diarization` e `tools/nemotron` chamam o Nemotron como
**serviço nativo local** (NeMo-Speech.cpp, loopback), e o copiloto é um **serviço Python local**
(`/copiloto/api`). Nenhum dos dois roda em celular ou tablet. O vault (`Stack.md`, D3/D4) já
decidia o contrário: ASR Nemotron no navegador via WebGPU, com WASM de reserva.

## O que existe para rodar no navegador (pesquisa de 2026-10-08, fontes secundárias)

- **ASR:** há Nemotron 3.5 ASR streaming 0,6B em ONNX INT4 para WebGPU
  (`onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4`), exportado para blocos de 560 ms.
  Roda com ONNX Runtime Web; não é a transformers.js pronta.
- **Diarização:** `pyannote-segmentation-3.0` roda no navegador via transformers.js. A
  implementação pública separa dois falantes (consulta tem dois). Não achei build web do
  Nemotron 3 Diarization.
- **Juiz:** Gemma 4 E2B existe em LiteRT-LM para web (`litert-community/gemma-4-E2B-it-litert-lm`):
  2,0 GB, só texto, ~4.700 tokens/s de leitura e ~74 de geração no Chrome de um MacBook M4 Max.
  Em celular só há número nativo (iPhone 17 Pro ~2.900 tokens/s de leitura na GPU), não em
  navegador. A rota MediaPipe web está em manutenção. O juiz lê muito e escreve um token, então
  o que importa é a velocidade de leitura.

## Decisão proposta: duas velocidades

**Caminho rápido, sempre no aparelho (navegador).** Microfone, ASR Nemotron em blocos de 560 ms
e separação dos dois falantes. O áudio nunca sai do aparelho. A transcrição não depende de
servidor nem de rede, então aparece em tempo quase real em qualquer celular, tablet ou PC com
WebGPU (WASM de reserva, mais lento).

**Caminho assíncrono, em um serviço de GPU (o juiz).** Quando uma fala do paciente fecha, o
navegador envia **só texto**: a fala, o contexto curto e no máximo os K trechos candidatos. O
serviço devolve as notas aos poucos e a tela mostra cada cartão assim que ele chega. O áudio e
os PDFs inteiros não vão ao serviço.

O serviço do juiz:
- é **sem estado**: não grava nada, não registra o texto em log, TLS, autenticado pela sessão;
- roda **uma imagem imutável** com o modelo já mesclado (Gemma 4 E4B + LoRA; o E2B só entra se o juiz um dia for para o navegador) e um
  identificador de versão; todas as réplicas são idênticas;
- escala por **réplicas atrás de um balanceador**; versão nova entra por troca gradual (azul/verde)
  e a anterior fica disponível para voltar;
- só publica uma versão que passou na regra de promoção do teste fixo
  (`docs/juiz-ciclo-de-treino.md`); o treino continua offline, em GPU alugada.

Ordem de grandeza (a confirmar na 3090 com o E2B): o E4B julgou 2.122 pares em 67 s, ~30 pares/s.
Uma fala gera 12 a 50 pares, ou seja, cerca de 1 s por fala por GPU, e uma GPU atende dezenas de
consultas ao mesmo tempo por ~US$ 0,16/h.

**Quem não tem WebGPU suficiente** ainda transcreve (WASM, mais lento) e usa o juiz pelo serviço,
então o copiloto não depende do aparelho. Rodar o juiz dentro do navegador fica como otimização
futura para os aparelhos fortes, se um dia for preciso tirar até o texto da rede.

**Aval (2026-10-08, do responsável do produto):** a transcrição é texto puro sem vínculo com pessoa. Quem
sabe quem fala é só o profissional, o único com a chave para iniciar sessão e desbloquear os atendimentos. Por
isso a fala e os trechos candidatos podem passar pelo serviço do juiz, que não grava nada. Isso é uma decisão do
responsável do produto, não parecer jurídico escrito; o envio de votos para treino continua dependendo do
consentimento do profissional (pergunta única no app, interruptor em Configurar copiloto).

## Medido (2026-10-08)

- **Juiz no servidor (3090 Ti, vLLM 0.31, Gemma 4 E4B bf16 + adaptador v1):** sobe e atende `juiz` e
  `base` no mesmo processo. Teste de fumaça: trecho certo 0,997, errado 5e-8; a reescrita sai em PT/EN/ES.
- **Fluxo completo em 44 falas de obras novas:** primeiro cartão em 2,6 s (p50) e 4,0 s (p95), com o modelo
  de busca dividindo a mesma GPU; 22 de 44 falas recebem cartão; falas neutras, do terapeuta e de
  quase-acerto: 0 cartões em 56; risco alertado em 100% dos casos de risco.
- **ASR no navegador** (`docs/spikes/asr-navegador.md`): Nemotron 0,6B em WebGPU, 151 ms por bloco de
  560 ms (fator 0,33) neste PC; só WASM fica mais lento que o áudio (604 ms/bloco). Diarização com pyannote
  separou duas vozes em 7 de 8 janelas (42 ms em WASM). Erro de palavras de ~38% com voz sintética: falta voz
  humana. Celular não medido; download de ~790 MB.

## A medir antes de prometer

- ASR e diarização em celular e tablet reais, com voz humana.
- Juiz com o modelo de busca fora da GPU (a busca roda no navegador ou em CPU), para o primeiro cartão cair
  abaixo de 2 s.
- Os três juntos na mesma GPU: o que cabe ao mesmo tempo e o que precisa ser sequencial.

## Consequências

O juiz de produção é o **Gemma 4 E4B + LoRA no serviço** (`tools/juiz`); o servidor não tem o limite
de 6 GB. Uma única versão serve todos os clientes. O E2B só volta se o juiz for para o navegador.
O serviço Python do copiloto vira o orquestrador (busca, reescrita, portão, chamada ao juiz), e o app
conversa com ele. Ligar o juiz é uma variável de ambiente (`COPILOTO_JUIZ_URL`).
