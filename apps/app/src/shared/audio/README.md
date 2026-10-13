# Captura PCM

Worklet mono a 16 kHz, blocos de 80 ms e drenagem explícita antes de encerrar.
A camada recebe uma MediaStream já autorizada: sessão exige os consentimentos
do paciente em `live-session/microfone`; cadastro exige a autorização explícita
do próprio profissional em `voice-enrollment`. O primitivo não decide consentimento.

Cancelamento, erro e desmontagem fecham AudioContext e trilhas. Nenhum buffer
é persistido; o silêncio é preservado na captura para o relógio da sessão não encolher (só o envio ao servidor o descarta, abaixo).

## Transcrição no servidor (`transcricao-servidor`)

Uma sessão de transcrição é um WebSocket para `/speech/v1/audio/transcriptions/realtime` (proxy do Vite em dev;
em build hospedado, a origem de `VITE_SPEECH_BASE_URL`). Protocolo e serviço: `tools/nemotron/README.md`;
decisão: `docs/adr/ADR-0012-transcricao-no-servidor.md`.

- `abrirTranscricao({ diarizar, aoResultado, falhar })` entrega a sessão depois do `session.created`; `enviar(pcm)` converte o
  Float32 da captura em PCM16 e manda; `concluir()` manda o `commit`, espera o `committed` e devolve tudo como final;
  `esvaziada()` espera o socket escoar (uso: mandar um arquivo inteiro, `transcrever-local`); `descartar()` cancela.
- Cada resultado é um **snapshot**: todas as palavras (finais e em hipótese) com `inicioMs`/`fimMs` na linha do tempo da
  captura, o falante (`speaker_N`, ou `null`), quantas são finais e `estavelAteMs`, o instante até onde nem o texto nem o
  falante mudam mais (o menor entre o fim da última palavra final e o `speaker_stable_until` do servidor).
- **Silêncio não vai ao servidor** (`porta-de-voz`): com a separação de vozes ligada o servidor processa silêncio mais devagar que o
  tempo real (30 s de pausa viram ~40 s de atraso). A porta mede a energia RMS de cada quadro de 80 ms contra um piso de ruído
  adaptativo (o quadro mais quieto dos últimos ~3 s) com histerese (liga a 3x o piso, desliga abaixo de 1,8x) e deixa passar só a
  fala, com 300 ms de pré-rolagem e 800 ms de cauda para o servidor fechar a frase (600 ms). Os limiares não foram calibrados com
  microfone real. `mapa-de-tempo` guarda onde cada trecho enviado começou na captura e devolve `start`/`end` das palavras (que
  contam só o áudio recebido) ao relógio da sessão. O PCM do cadastro de voz e o anel do TitaNet continuam com o áudio inteiro.
- **Queda do socket:** vira o aviso `reconectando`; as palavras finais ficam, a hipótese em curso se perde; o áudio capturado
  enquanto cai fica numa fila e vai à sessão nova (5 tentativas, 0/1/2/4/8 s). A sessão nova conta o tempo desde o primeiro
  quadro que recebe, então ela ganha um mapa de tempo novo, e os falantes dela ganham o sufixo da época
  (`speaker_1_r1`), porque o servidor numera de novo. Esgotadas as tentativas, `falhar`.
- **Atraso:** aviso `atrasada` quando há mais de 2 s de áudio parado no socket (`bufferedAmount`) ou quando o servidor
  processou (`audio_processed`) mais de 2 s a menos que o enviado. Em CPU, com a separação de vozes, o segundo caso é o
  que acontece.
- Sem nenhum evento do servidor por 30 s depois do `commit`, a conclusão falha. Um `error` do servidor derruba a sessão.
- O PCM nunca é gravado: o que não foi enviado fica na fila de reconexão e é descartado ao encerrar.
