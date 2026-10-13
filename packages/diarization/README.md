# @limmiar/diarization

## Responsabilidade

Peças puras sobre quem falou, depois que o gateway de fala (`apps/gateway-fala`) já resolveu o falante de cada frase.

1. **`similaridadeCosseno` e `LIMIAR_MESMA_VOZ` (`0,5`)**: a medida e o limiar de "mesma voz" entre dois embeddings TitaNet. Valem para o
   cadastro de voz (`features/voice-enrollment`) e para o gateway, que os importa daqui: o profissional é quem casa com o perfil
   cadastrado, e as demais vozes são agrupadas pelo mesmo critério.
2. **Passe canônico** (`montarTranscricaoCanonica`): colapsa a sequência de palavras já rotuladas (`voce`/`paciente`) em trechos
   consecutivos, prontos para a UI de transcrição.

Zero dependências de runtime — sem UI, sem I/O, sem relógio. Os imports internos levam a extensão `.ts` porque o gateway roda
em Node direto sobre o código-fonte (remoção de tipos), sem etapa de build. A classificação por voz (`classificarLocutores`), a
atribuição palavra a turno e a segmentação pyannote do aparelho saíram quando o reconhecimento de quem fala passou ao gateway
(`docs/adr/ADR-0012-transcricao-no-servidor.md`).

`LIMIAR_MESMA_VOZ`: `0.7`, o padrão publicado de
[NeMo `verify_speakers`](https://docs.nvidia.com/nemo/speech/nightly/asr/speaker_recognition/api.html), recusou uma leitura real do
dono no cadastro e deixava toda a sessão "não identificada"; `0.5` ainda não foi calibrado com voz humana.

## Fluxo — passe canônico (`montarTranscricaoCanonica`)

1. Percorre `PalavraAtribuida[]` (o falante vem do gateway) e resolve o rótulo de cada palavra via `rotulos.get(palavra.locutor)`.
2. Palavra com `locutor: null`, ou cujo `locutor` não existe em `rotulos`, ou cujo rótulo mapeado é `null` (voz ainda sem decisão) — mesma convenção de "indeterminado": fecha o trecho corrente e não entra em nenhum trecho.
3. Sequências consecutivas com o mesmo rótulo colapsam num único `TrechoCanonico`; uma palavra indeterminada no meio quebra a sequência — a próxima palavra do mesmo rótulo abre um trecho novo, não retoma o anterior.

## Pontos de entrada

- `montarTranscricaoCanonica(palavras: readonly PalavraAtribuida[], rotulos: ReadonlyMap<string, RotuloLocutor | null>): readonly TrechoCanonico[]` — pura e determinística.
- `similaridadeCosseno(a, b)` (`NaN` para vetores vazios, de tamanhos diferentes ou não finitos) e `LIMIAR_MESMA_VOZ`.
- Tipos (`src/palavra.ts`, `src/classify.ts`, `src/canonico.ts`): `PalavraAtribuida`, `RotuloLocutor`, `TrechoCanonico`.

## Decisões relevantes

**Um mutante equivalente aceito, não perseguido (`canonico.ts`):** o `palavra.locutor === null ? null : …` é redundante em runtime (`Map.get` aceita qualquer valor e devolve `undefined` para uma chave ausente, independente do tipo declarado) e existe só para o TypeScript, não para o comportamento. Perseguir 100% aqui significaria trocar uma guarda clara por uma dependência implícita de `undefined`, mais frágil de ler do que o ganho de um mutante vale.
