# Latência da fala ao DOM

SLO: cada palavra falada aparece no DOM da transcrição ao vivo até 300 ms depois do seu fim acústico.

## Fixture

`fixtures/live-asr/sessao-clinica.pcm` tem 63 s de PCM16 mono a 16 kHz. São 108 palavras de um diálogo clínico sintético (`fixtures/live-asr/roteiro.json`) com duas vozes OneCore pt-BR: Daniel faz o profissional e Maria faz a paciente. `sessao-clinica.words.json` dá o início e o fim de cada palavra em amostras.

Os limites vêm do próprio sintetizador, nunca do ASR. Para regerar, rode `powershell -File e2e/fixtures/live-asr/gerar-fixture.ps1`. A saída é determinística: duas execuções deram o mesmo SHA-256.

- O início de cada palavra vem do `SpeakProgress` do System.Speech.
- O fim é o fim do último fonema não silencioso dela, pelo `PhonemeReached` (posição mais duração).
- As word cues do WinRT `SpeechSynthesizer` não servem, porque chegam todas com `Duration` 0, e os bookmarks SSML caem no meio das palavras.
- O System.Speech só lista vozes Desktop. As vozes OneCore entram pelo mesmo caminho interno, por reflexão.

O gerador recusa a saída quando falha uma destas verificações:

- O número de palavras difere do roteiro.
- Os fonemas não cobrem o áudio com tolerância de 25 ms.
- Uma palavra cai em silêncio.
- Depois de uma palavra seguida de pausa, a energia entre 30 e 100 ms após o fim não fica abaixo de 25% da energia da palavra.

## Como medir

1. Suba o stack com `pnpm dev` e confira-o pelo `docs/guia-teste-manual.md`.
2. Rode, na raiz do repositório:

```powershell
$env:LIVE_ASR_REPORT = ".local/claude-goal/asr/baseline-$(Get-Date -Format yyyyMMdd-HHmmss).json"
pnpm --filter app exec playwright test -c e2e/playwright.live-asr.config.ts
```

A spec cria pela interface um profissional sintético. Ele recebe o perfil de voz sintético de `fixtures/perfil-de-voz-sintetico.ts`, que não usa áudio. A spec também cria um paciente fictício e uma sessão vazia, e marca os consentimentos de gravação e de análise por IA. Sem este último, a gravação não transcreve ao vivo. A chave da equipe sai de `.local/settings.json`. O microfone é um `AudioContext` que toca a fixture por uma `MediaStreamDestination`. O relógio de áudio converte cada amostra para o relógio de `performance.now()`. O WebSocket `/speech` é o real.

A cada mutação do DOM, o texto visível é lido no `requestAnimationFrame` seguinte. Cada leitura é alinhada por distância de edição às palavras que já tinham começado naquele instante. Cada palavra recebe crédito na primeira leitura que a pareia com um token igual. Assim, um erro do ASR não bloqueia as palavras seguintes. Uma frase que some da tela custa deleções e não é tomada por fala ainda por vir.

O relatório fica em `test-results/.../live-asr-dom-latency.json` e também em `LIVE_ASR_REPORT`, quando essa variável está definida. Ele traz:

- p50, p95 e máximo, e as palavras com crédito e as ausentes;
- o WER da transcrição final;
- as palavras que sumiram e voltaram (`vanished`);
- a mesma agregação separada entre palavras no meio da frase e palavras antes de uma pausa de 150 ms ou mais;
- o atraso de cada palavra.

O teste passa só quando estas quatro condições valem:

- abriu uma única conexão de fala;
- a transcrição foi concluída;
- o WER ficou em 5% ou menos;
- nenhuma palavra ficou ausente e o atraso máximo ficou em 300 ms ou menos.

`LIVE_ASR_SESSION_URL` pula o cadastro e abre uma sessão pronta. A sessão do app fica no `sessionStorage` e a chave do cofre fica em memória, e o `storageState` não leva nenhuma das duas. Por isso esse atalho só funciona com um navegador que já tenha sessão e cofre abertos.

## O que a medição não cobre

- Microfone físico e o buffer do sistema operacional.
- Cancelamento de eco, ganho automático e supressão de ruído.
- Pixels já compostos na tela: o `requestAnimationFrame` roda antes da pintura do quadro.
- A teleconsulta, que abre uma sessão por trilha.

`audioClock.outputLatencyMs` mede o quanto a correlação do relógio pode atrasar o fim das palavras. Ela usa o instante de saída para o alto-falante, e a `MediaStreamDestination` recebe o áudio antes disso.
