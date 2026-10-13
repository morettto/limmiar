# Serviço de transcrição (Nemotron)

A transcrição em tempo real roda no servidor, não no navegador. O caminho de uma sessão:

```
navegador ──WebSocket /speech/v1/fala──▶ gateway de fala (apps/gateway-fala) ──WebSocket──▶ NeMo-Speech (N containers)
             PCM16 16 kHz, só fala          quem fala: TitaNet por frase          Nemotron 3.5 ASR streaming, sem diarização
```

O gateway escolhe o processo menos ocupado, manda ao app só o que é novo (parcial com a cauda ainda sem tempo, cada frase
final com o falante resolvido) e reinicia a sessão upstream numa pausa a cada ~3 min, mantendo o relógio. A decisão e o que
ela muda na privacidade: `docs/adr/ADR-0012-transcricao-no-servidor.md`. Áudio e impressão de voz vivem só em memória.

`pnpm dev` garante os containers (`tools/nemotron/garantir.mjs`) e sobe o gateway com a lista deles (`NEMOTRON_URLS`).
Para rodar sozinho: `node tools/nemotron/garantir.mjs`.

## Pré-requisitos

- Docker. A imagem `limmiar-nemotron:0.2.0-cpu` sai de `tools/nemotron/Dockerfile` (NeMo-Speech.cpp **0.2.0**, versão fixa,
  pelo instalador oficial que confere o SHA-256); `garantir.mjs` a constrói se faltar. Para GPU:
  `docker build --build-arg BACKEND=cuda -t limmiar-nemotron:0.2.0-cuda tools/nemotron` e `--gpus all`.
- O volume `nemotron_models` guarda o ASR Nemotron 3.5 q8_0. A primeira subida baixa do Hugging Face.

## Os containers

`garantir.mjs` cria `NEMOTRON_INSTANCIAS` containers (padrão 2), cada um fixo em `NEMOTRON_NUCLEOS_POR_INSTANCIA` núcleos
(padrão 2), nas portas 8081, 8082...:

```bash
docker run -d --name nemotron-speech-1 --restart unless-stopped --cpuset-cpus 0-1 \
  -p 127.0.0.1:8081:8080 -v nemotron_models:/models limmiar-nemotron:0.2.0-cpu \
  serve --host 0.0.0.0 --asr-model nemotron-3.5 --device cpu --endpointing --stop-history-eou-ms 600 --threads 4 --no-ui
```

| Flag | Por quê (medido em 11/10/2026, Ryzen 9 5900X) |
|---|---|
| `--cpuset-cpus` | O motor (ggml) usa todos os núcleos que enxerga. Sem fixar, os processos disputam a CPU e o atraso explode; fixo em 2 núcleos, uma sessão usa ~0,65 núcleo. |
| vários containers | Um processo serializa as sessões: com 4 sessões num processo o atraso foi a 10 s, com batching desligado a 72 s, mesmo com CPU sobrando. Dois por processo ficam estáveis. |
| `--threads 4` | É o pool **HTTP**, não a inferência: cada sessão WebSocket ocupa um worker. Com 2, a terceira sessão é recusada. |
| sem `--diar-model` | A diarização contínua (Sortformer) processava o silêncio mais devagar que o tempo real (travava depois de pausas) e marcava voz nova ~4,5 s depois. O gateway resolve quem fala por frase. |
| `--endpointing --stop-history-eou-ms 600` | Um final por frase, ~0,9 s depois da pausa. |
| `rnnt_right_context` padrão | Passo de 160 ms. O passo de 80 ms (`0`) não acompanha em CPU nem com 8 núcleos (até 30 s de atraso); o de 320 ms (`-1`) é mais barato (0,54 núcleo) e mais lento. |
| `-p 127.0.0.1:...` | Só loopback: o servidor não tem TLS. Fora daqui, use `--api-key` (o gateway manda `NEMOTRON_CHAVE`). |

### Na GPU

`NEMOTRON_DISPOSITIVO=cuda pnpm dev` troca os processos de CPU por **um** container na GPU (`limmiar-nemotron:0.2.0-cuda`,
`--gpus all`) com `NEMOTRON_SESSOES_GPU` vagas (padrão 8; vira `--threads` e `--asr.batching.state_arena_slots`). Medido na
GTX 1660 SUPER desta máquina, com o juiz na mesma placa: 1, 4 e 8 sessões estáveis com finais a 0,7 s, GPU a 20%, VRAM total
5,4 de 6 GB. Na nuvem (seção abaixo), uma A4000 aguentou 64 sessões estáveis.

## Protocolo do NeMo-Speech 0.2.0 (o que o gateway usa)

`/v1/audio/transcriptions/realtime`: `session.created`; uma vez `session.update` (`sample_rate`, `language`, `word_timestamps`,
`endpointing_ms`); quadros PCM16; ao fim `input_audio_buffer.commit` → `input_audio_buffer.committed`. Medido, **não
documentado**: o parcial (`...delta`) traz só o pedaço novo de texto (`delta`) e `audio_processed`, sem tempos; a frase final
(`...completed`) traz `transcript` e `words` (com tempos) **só daquela frase**; a sessão fecha com uma frase final vazia.
A 0.1.0 era diferente (`words` acumulada, `final_word_count`): trocar de versão exige rever `apps/gateway-fala/src/upstream.ts`.

## Números (0.2.0, cliente em tempo real, `node .local/gw-medir.mjs`, diálogo de 43 s com gabarito)

| Sessões simultâneas | Texto: palavra até a tela (mediana / pior) | Falante certo | Rótulo após o fim da frase |
|---|---|---|---|
| 1 | −0,03 s / 0,32 s | 98,4% | ~1,1 s |
| 4 (2 processos de 2 núcleos) | 0,17 s / 0,65 s | 98,4% | ~1,1 s |

Silêncio de 30 s no meio: sem travar (pior palavra 0,29 s; só 17 de 46 s de áudio enviados, a porta de voz do app corta o
silêncio). Custo: ~0,8 núcleo de CPU e ~0,93 GB de RAM por processo (2 sessões). A diarização contínua anterior dava 96,8%
de acerto. Voz humana, celular e 4G ainda não foram medidos.

## Consumo medido na nuvem (11/10/2026, Vast, RTX A4000 16 GB + i3-10100, US$ 0,09/h)

NeMo-Speech.cpp **0.2.0** com CUDA (instalador oficial), só ASR, passo de 160 ms, áudio de 70 s em quadros de 80 ms, tempo real.
Métrica: atraso de cada frase final depois da pausa (estável = não cresce ao longo da sessão).

| Sessões simultâneas | Atraso dos finais (mediana / p95) | GPU (uso / VRAM) |
|---|---|---|
| 1 a 16 | 0,7 s / 0,8 s | até 27% / 1,2 GB |
| 32 (padrão de 16 vagas) | as 16 excedentes crescem até 4,9 s | 27% / 1,2 GB |
| 32 com `--asr.batching.state_arena_slots 128` | 0,7 s / 0,8 s | 34% / 2,8 GB |
| 64 com 128 vagas | 0,7 s / 0,8 s | 40% / 2,8 GB |
| 128 com 256 vagas | mediana 0,8 s, p95 36,9 s (satura) | 90% / 4,5 GB |

- **Capacidade:** ~80 sessões estáveis por A4000 (estimativa entre 64 medidas estáveis e 128 saturadas). A US$ 0,09/h, isso dá
  **~US$ 0,001 por hora de sessão** de transcrição. Em CPU (seção anterior) é ~0,8 núcleo por sessão.
- `state_arena_slots` (padrão 16) é o teto de sessões na GPU: ajuste para acima do pico esperado.
- O passo de 80 ms (`rnnt_right_context 0`) devolveu texto **vazio** na GPU com a 0.2.0. Fica o padrão.
- Não medido aqui: o gateway na mesma máquina (a verificação de voz custa ~0,02 s de CPU por segundo de áudio, medido local)
  e a latência de rede até a GPU.

## Problemas comuns

- "Capacidade de transcrição esgotada": todas as vagas ocupadas; aumente `NEMOTRON_INSTANCIAS` (precisa de núcleos livres).
- Atraso crescendo: outro programa disputa a CPU (jogos, por exemplo); feche-o ou fixe os containers em outros núcleos.
- `docker logs nemotron-speech-1` mostra a configuração carregada (`[asr] mode=streaming ... step=160ms`).
