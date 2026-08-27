# @limmiar/diarization

## Responsabilidade

Pipeline puro de diarização → transcrição canônica, em três passos independentes:

1. **Merge** (`atribuirLocutores`): junta a saída do ASR (palavras com timestamps) com a saída do diarizador (turnos de locutor) e devolve cada palavra com o locutor atribuído, ou `null` quando não há atribuição inequívoca.
2. **Classificação** (`classificarLocutores`): decide, por id opaco de locutor, quem é `'voce'` (o profissional cadastrado) e quem é `'paciente'` (todo o resto), comparando um embedding de voz cadastrado contra os embeddings dos locutores que apareceram na sessão.
3. **Passe canônico** (`montarTranscricaoCanonica`): colapsa a sequência de palavras já rotuladas (`voce`/`paciente`) em trechos consecutivos, prontos para a UI de transcrição.

Zero dependências de runtime — sem UI, sem I/O, sem relógio.

## Fluxo — merge (`atribuirLocutores`)

1. Para cada palavra, percorre todos os turnos e acumula, por locutor, a soma de `sobreposicao(palavra, turno)` — a interseção em milissegundos entre o intervalo `[palavra.inicioMs, palavra.fimMs)` e `[turno.inicioMs, turno.fimMs)`.
2. Palavra degenerada (`inicioMs === fimMs`, o ASR emite-as) conta como 1ms — normalizada para o ponto `[inicioMs, inicioMs+1)` — para pertencer a exatamente um lado de uma fronteira `[a,b)/[b,c)`. A mesma normalização (`Math.max(fimMs, inicioMs+1)`) também cobre, sem caso à parte, uma palavra ASR invertida (`fimMs < inicioMs`, entrada hipotética inválida): trata-a igualmente como o ponto de 1ms em `inicioMs`.
3. O locutor com maior soma de sobreposição vence. Empate exato entre dois ou mais locutores, ou nenhum peso positivo (silêncio / turno vazio / turno inválido), dá `locutor: null`.
4. O vencedor é decidido com uma sentinela `0` para o maior peso visto: pesos zero (sem sobreposição) entram no mapa como qualquer outro, sem guarda — o mesmo ramo de empate (`peso === maiorPeso`) que trata um empate real entre dois locutores também repõe o vencedor a `null` quando só há zeros, sem caso à parte; assim que aparece um peso real ele substitui a sentinela sem ambiguidade.
5. Turno inválido (`fimMs <= inicioMs`) produz sobreposição zero por construção da fórmula (ver ponto 2 do cálculo abaixo) — não há guarda de validação à parte.

## Fluxo — classificação (`classificarLocutores`)

1. Similaridade de cosseno entre o embedding `cadastrado` e o embedding de cada `LocutorCandidato`.
2. Vencedor = maior similaridade. Se `(maior - segundo maior) < margemMinima` (padrão `0.05`), a decisão é ambígua e **todo** candidato recebe `null` — inclusive o que teria vencido.
3. Caso contrário: o vencedor recebe `'voce'`, todos os outros `'paciente'`. Um único candidato nunca é ambíguo (não há segundo colocado para disputar a margem).
4. Devolve um `Map` por id de locutor — a ordem de `candidatos` não importa, o rótulo segue o id, não a posição.

## Fluxo — passe canônico (`montarTranscricaoCanonica`)

1. Percorre `PalavraAtribuida[]` (saída de `atribuirLocutores`) e resolve o rótulo de cada palavra via `rotulos.get(palavra.locutor)`.
2. Palavra com `locutor: null`, ou cujo `locutor` não existe em `rotulos`, ou cujo rótulo mapeado é `null` (margem ambígua da classificação) — mesma convenção de "indeterminado": fecha o trecho corrente e não entra em nenhum trecho.
3. Sequências consecutivas com o mesmo rótulo colapsam num único `TrechoCanonico`; uma palavra indeterminada no meio quebra a sequência — a próxima palavra do mesmo rótulo abre um trecho novo, não retoma o anterior.

## Pontos de entrada

- `atribuirLocutores(palavras: readonly PalavraAsr[], turnos: readonly TurnoLocutor[]): PalavraAtribuida[]` — função pura e determinística. `saida.length === palavras.length`, mesma ordem, `texto`/`inicioMs`/`fimMs` preservados; cada item tem `locutor: string` ou `locutor: null`, nunca ambos, nunca nenhum. Permutar `turnos` não muda o resultado.
- `classificarLocutores(cadastrado: readonly number[], candidatos: readonly LocutorCandidato[], margemMinima = 0.05): Map<string, RotuloLocutor | null>` — pura e determinística; permutar `candidatos`, renomear ids ou escalar todos os embeddings por `k > 0` não muda o resultado (invariante de cosseno).
- `montarTranscricaoCanonica(palavras: readonly PalavraAtribuida[], rotulos: ReadonlyMap<string, RotuloLocutor | null>): readonly TrechoCanonico[]` — pura e determinística.
- Tipos (`src/merge.ts`, `src/classify.ts`, `src/canonico.ts`, sem `types.ts` — aqui não há biblioteca externa a manter fora do contrato, seria uma interface com uma única implementação): `TurnoLocutor`, `PalavraAsr`, `PalavraAtribuida`, `RotuloLocutor`, `LocutorCandidato`, `TrechoCanonico`.

## Decisões relevantes

**Regra de desempate — soma de sobreposição por locutor:**

```
para cada palavra p:
  peso[locutor] += sobreposicao(p, t)   para cada turno t
  vencedor = argmax(peso)               // maior sobreposição total
  empate exato entre locutores distintos → null
  nenhum peso > 0                       → null   (silêncio / turnos vazios)

sobreposicao(p, t) =
  fim = max(p.fimMs, p.inicioMs + 1)   // degenerada ou invertida vira ponto de 1ms
  max(0, min(fim, t.fimMs) - max(p.inicioMs, t.inicioMs))
```

Soma de sobreposição, não "turno único mais próximo" nem "primeiro turno que toca": uma palavra que atravessa dois turnos do mesmo locutor conta o total, não fica ambígua por estar dividida (ver caso 4/12 na tabela de mesa). Locutores diferentes empatados na soma exata é a única condição de `null` por ambiguidade — qualquer diferença, por menor que seja, decide.

`// ponytail: O(palavras × turnos) — varredura completa por palavra. ~9k palavras × ~500 turnos numa sessão de 50 min corre em milissegundos; se algum dia doer, dois ponteiros sobre turnos ordenados.` — deliberado, sem otimização prematura.

**Classificação binária, não N-classes:** o par `voce`/`paciente` assume exatamente um profissional cadastrado por sessão de teleconsulta. Um candidato que nunca fala (não aparece em `candidatos`) simplesmente não entra no `Map` — não é `'paciente'` nem `null`, está ausente; `montarTranscricaoCanonica` já trata id ausente do mapa como indeterminado, então nenhum caso extra é necessário aqui.

**Margem estritamente `<`, não `<=`:** uma diferença de similaridade exatamente igual a `margemMinima` decide (não é ambígua) — coberto pelo caso 7 de `classify.test.ts`, é a fronteira que separa "decide" de "ambíguo".

**Dois mutantes equivalentes aceitos, não perseguidos (`classify.ts`, `canonico.ts`):** a guarda de `candidatos.length === 0` e o `palavra.locutor === null ? null : …` de `canonico.ts` são redundantes em runtime (o resto do corpo já produz o mesmo resultado sem eles — `Map.get` aceita qualquer valor e devolve `undefined` para uma chave ausente, independente do tipo declarado) e existem só para o TypeScript, não para o comportamento. Mutação fica em 97.56% (piso 95) por isso — perseguir 100% aqui significaria trocar uma guarda clara por uma dependência implícita de `NaN`/`undefined`, mais frágil de ler do que o ganho de dois mutantes vale.

**`agruparEmBlocos` (S06-01) tornou-se `montarTranscricaoCanonica` (S06-02):** o placeholder de YAGNI da fatia anterior foi implementado nesta fatia, já com o passo de classificação binária entre eles — a colisão de nomes é intencional, é a mesma necessidade, resolvida quando apareceu quem a precisava (a transcrição canônica). Adapters (diarizador externo → `TurnoLocutor[]`, ASR externo → `PalavraAsr[]`, segundos em float → ms inteiro, embedding de voz cadastrado → `readonly number[]`) continuam fora deste package — S05-02.
