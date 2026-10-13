# ADR-0012 · A transcrição e a separação das vozes rodam no servidor

- Status: decidido pelo responsável do produto em 2026-10-10. Substitui a parte de ASR e diarização do `ADR-0011-inferencia-no-navegador.md`; o resto daquele ADR (o juiz em serviço de GPU, só texto) continua valendo.
- Data: 2026-10-10

## Contexto

O dono quer a transcrição **em tempo real em qualquer aparelho e navegador**, sem "gravar agora e transcrever depois"
(descartado em `docs/analise-asr-celular.md`). O motor no navegador (Nemotron 3.5 em ONNX Runtime Web) exige WebGPU, ~790 MB
de download e ~1,2 GB de memória; em WASM ele fica atrás do áudio (RTF 1,17 num PC forte) e em celular não há medida nem
evidência. A pesquisa de `docs/pesquisa-nemotron-asr-escala.md` achou o caminho de servidor: Nemotron 3.5 ASR Streaming
(pt-BR, pontuação, tempo por palavra) e Nemotron 3 Diarization (até 8 falantes), servidos pelo NeMo-Speech.cpp.

## Decisão

- **ASR e separação de vozes no servidor** (`tools/nemotron`, container `nemotron-speech-1`), por WebSocket em tempo real. O app
  manda PCM16 a 16 kHz e recebe parciais e finais com tempo e falante por palavra. Cliente: `apps/app/src/shared/audio/transcricao-servidor.ts`.
- **O áudio só existe em memória**, nos dois lados: no navegador (anel de 60 s para o recorte de voz, apagado ao encerrar) e no
  servidor. Nada é gravado em disco, banco, log ou volume. Medido: depois de ~5 sessões de teste, `docker diff` do container
  não lista nenhum arquivo novo e só o volume dos modelos está montado.
- **Quem é o profissional continua sendo decidido no aparelho.** O servidor só diz "falante 1, 2...". O TitaNet do aparelho
  mede a voz de cada falante sobre o áudio local dos trechos dele e `classificarLocutores` compara com o perfil de voz cifrado.
  A impressão de voz do profissional nunca sai do aparelho.
- **Sessão presencial:** um socket com `speaker_diarization`. **Sessão online:** um socket por trilha WebRTC, sem separação de
  vozes; o papel sai da trilha autenticada.
- **Endereço:** mesma origem em `/speech` (proxy do Vite com `ws: true`); um build hospedado nomeia a origem em
  `VITE_SPEECH_BASE_URL`, que entra no `connect-src` com o par `wss:`.
- **O silêncio não vai ao servidor.** Medido: com a separação de vozes, 30 s de silêncio viram ~40 s de atraso, porque o diarizador
  em CPU processa silêncio mais devagar que o tempo real. O aparelho manda só a fala (energia por quadro de 80 ms, piso de ruído
  adaptativo e histerese; 300 ms de pré-rolagem e 800 ms de cauda) e guarda um mapa de tempo para devolver os tempos das palavras ao
  relógio da sessão (`shared/audio/porta-de-voz`, `mapa-de-tempo`). O PCM do TitaNet continua inteiro.
- **Falhas:** a queda do socket avisa na tela, reabre uma sessão nova e continua o relógio da captura; as palavras já finais
  ficam. Mais de 2 s de áudio parado no socket, ou o servidor 2 s atrás do que foi enviado, avisam atraso.

## O que saiu

O motor de ASR do navegador (`shared/audio/asr`, `onnxruntime-web`, `tools/asr-web`, o download de ~790 MB em `tools/dev.mjs`, o
teto de bundle do worker) e a separação de vozes do aparelho (pyannote, `DiarizadorAoVivo`, `diarizarGravacao`,
`atribuirLocutores`). Em `packages/diarization` ficaram `classificarLocutores`, `similaridadeCosseno` e o passe canônico.

## Consequências

- **Privacidade:** o áudio da sessão clínica, que é dado de saúde e pode servir de biometria, passa a **sair do aparelho**. O texto
  de consentimento da sessão online foi mudado para dizer isso ("o áudio segue ao servidor de transcrição, só em memória, e não é
  gravado"). Este ADR não é parecer jurídico: o parecer pedido em `docs/analise-asr-celular.md` §3.4 continua pendente.
  O servidor local não tem TLS nem chave de API; em produção ele precisa dos dois, e o log não pode conter fala.
- **Custo e escala:** passa a existir um serviço com GPU para operar (estimativas em `docs/pesquisa-nemotron-asr-escala.md`, não medidas).
- O app deixa de baixar modelo de ASR. O TitaNet (identidade de voz) continua no aparelho.

## Medido em 2026-10-10 (CPU, pilha de dev no ar, WAV de 62 s com duas vozes sintéticas)

Detalhes e comando em `tools/nemotron/README.md`.

- Primeira palavra visível ~1,1 a 1,3 s depois do início da fala; final ~0,9 s depois da pausa.
- Os falantes saíram certos (38, 22, 28 e 15 palavras nos quatro trechos, dois ids, sem troca).
- **Com `--diar-preset v3-streaming` o servidor em CPU não acompanha o tempo real:** o atraso do final cresce de 0,9 s a 8 s em
  um minuto. Com `v3-offline` acompanha (finais a 0,9 a 1,3 s), mas o falante só fica estável em saltos de ~21 s. Sem separação
  de vozes (sessão online) o atraso é de 0,8 s, constante. Em GPU o `v3-streaming` deve caber; não foi medido.

## Em aberto

- Escolher o preset ou a GPU antes de usar o modo presencial por mais de alguns minutos.
- Cada evento do servidor repete todas as palavras da sessão (~92 bytes por palavra, ~800 KB por evento em 50 min).
- Depois de uma queda o servidor numera os falantes de novo; o app os trata como vozes novas (`speaker_1_r1`), que só ganham papel
  depois de ~2 s de fala final (a janela rápida; o refino usa fala estável); até lá a primeira voz é o profissional provisório, e
  toda outra voz já é paciente provisório. Quem casa com o perfil (similaridade >= 0,5) é o profissional, as demais vozes são "Paciente" (ou "Pessoa 2", "Pessoa 3").
- WER em fala clínica real em pt-BR e o mapeamento do TitaNet com voz humana não foram medidos.
