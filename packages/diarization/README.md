# @limmiar/diarization

## Responsabilidade

Merge de diarização puro: junta a saída do ASR (palavras com timestamps) com a saída do diarizador (turnos de locutor) e devolve cada palavra com o locutor atribuído, ou `null` quando não há atribuição inequívoca. Zero dependências de runtime — sem UI, sem I/O, sem relógio.

## Fluxo principal (`atribuirLocutores`)

1. Para cada palavra, percorre todos os turnos e acumula, por locutor, a soma de `sobreposicao(palavra, turno)` — a interseção em milissegundos entre o intervalo `[palavra.inicioMs, palavra.fimMs)` e `[turno.inicioMs, turno.fimMs)`.
2. Palavra degenerada (`inicioMs === fimMs`, o ASR emite-as) conta como 1ms — normalizada para o ponto `[inicioMs, inicioMs+1)` — para pertencer a exatamente um lado de uma fronteira `[a,b)/[b,c)`. A mesma normalização (`Math.max(fimMs, inicioMs+1)`) também cobre, sem caso à parte, uma palavra ASR invertida (`fimMs < inicioMs`, entrada hipotética inválida): trata-a igualmente como o ponto de 1ms em `inicioMs`.
3. O locutor com maior soma de sobreposição vence. Empate exato entre dois ou mais locutores, ou nenhum peso positivo (silêncio / turno vazio / turno inválido), dá `locutor: null`.
4. O vencedor é decidido com uma sentinela `0` para o maior peso visto: pesos zero (sem sobreposição) entram no mapa como qualquer outro, sem guarda — o mesmo ramo de empate (`peso === maiorPeso`) que trata um empate real entre dois locutores também repõe o vencedor a `null` quando só há zeros, sem caso à parte; assim que aparece um peso real ele substitui a sentinela sem ambiguidade.
5. Turno inválido (`fimMs <= inicioMs`) produz sobreposição zero por construção da fórmula (ver ponto 2 do cálculo abaixo) — não há guarda de validação à parte.

## Pontos de entrada

- `atribuirLocutores(palavras: readonly PalavraAsr[], turnos: readonly TurnoLocutor[]): PalavraAtribuida[]` — função pura e determinística. `saida.length === palavras.length`, mesma ordem, `texto`/`inicioMs`/`fimMs` preservados; cada item tem `locutor: string` ou `locutor: null`, nunca ambos, nunca nenhum. Permutar `turnos` não muda o resultado.
- Tipos (`src/merge.ts`, sem `types.ts` — aqui não há biblioteca externa a manter fora do contrato, seria uma interface com uma única implementação): `TurnoLocutor`, `PalavraAsr`, `PalavraAtribuida`.

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

**Saltado deliberadamente, não implementado (S06-01):** `agruparEmBlocos` (colapsar `PalavraAtribuida[]` em turnos finais para a UI de transcrição) — YAGNI: é uma função de ~5 linhas do lado do consumidor (percorrer `PalavraAtribuida[]` e fundir vizinhos com o mesmo `locutor`), sem necessidade de viver neste package antes de o ecrã de transcrição existir e precisar dela. Adapters (diarizador externo → `TurnoLocutor[]`, ASR externo → `PalavraAsr[]`, segundos em float → ms inteiro) ficam fora deste package — S05-02.
