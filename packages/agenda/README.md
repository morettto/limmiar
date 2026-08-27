# @limmiar/agenda

## Responsabilidade

Modelo de tempo puro (sem UI) para a agenda: valida fuso IANA e expande uma série recorrente (RRULE RFC5545) numa janela `[from, until)` em instantes absolutos reais, preservando a hora de parede local através de mudanças de horário de verão.

## Fluxo principal (`expandOccurrences`)

1. Valida `series.timeZone` com `toTimeZoneId`.
2. Valida a fronteira de confiança, e lança `Error` (não expande) se:
   - `series.rrule`, `series.startsAt`, ou qualquer entrada de `series.exdates` contiver `\r` ou `\n` (guarda contra injeção de linha iCal);
   - a janela (`window.until - window.from`) exceder ~730 dias (2 anos);
   - `series.rrule` não tiver `FREQ` (string vazia, só espaços, ou sem o token `FREQ=`) — não cai no default `YEARLY` do `rrule`, é rejeitada explicitamente;
   - `series.rrule` tiver `FREQ=SECONDLY`, `FREQ=MINUTELY` ou `FREQ=HOURLY` — esta é uma agenda de sessões de psicólogo, recorrência sub-diária não faz sentido de produto e forçaria o motor `rrule` por centenas de milhões de candidatos antes do primeiro resultado, bloqueando o event loop;
   - `series.rrule` tiver `INTERVAL` fora de `[1, 366]` (incluindo negativo/zero) — um `INTERVAL` negativo faz o iterador do `rrule` andar para trás a partir de `dtstart` e nunca atingir a sua própria condição de aceitação, um loop síncrono infinito e irrecuperável;
   - `series.startsAt` ou qualquer `series.exdates` não bater com o formato `YYYY-MM-DDTHH:mm`, bater com o formato mas não for uma data/hora real por campo fora do intervalo (ex. `2024-13-99T99:99`), ou por overflow aritmético de calendário (ex. `2024-02-30`, que o construtor `Date` desliza silenciosamente para `2024-03-01/02` em vez de rejeitar) — `parseWallClock` faz um round-trip: relê os campos UTC da data construída e compara com os dígitos da string de entrada, campo a campo.
3. Monta a série via uma allowlist explícita de campos extraídos de `RRule.parseString(series.rrule)` — só `freq`, `interval`, `count`, `until`, `byweekday`, `bymonth`, `bymonthday`, `bysetpos` chegam ao construtor `new RRule({ ...camposPermitidos, dtstart })`. Nada mais (`tzid`, um `dtstart` embutido na própria string, `byhour`/`byminute`/`bysecond`, `wkst`) atravessa essa fronteira — mesmo que apareça na mesma linha do `FREQ` (sem quebra de linha, logo invisível ao guard do ponto 2). `dtstart` vem sempre de `series.startsAt` via `parseWallClock`, nunca da string do `rrule`. Esta agenda é de sessões com hora fixa vinda de `startsAt`; `BYHOUR`/`BYMINUTE`/`BYSECOND` na rrule são ignorados deliberadamente, não é bug.
4. Converte as pontas de `window` (instantes absolutos reais) para o espaço ingénuo com `toWallClock`, com ±1 dia de folga — para não cortar ocorrências de fronteira quando o deslocamento (offset) muda dentro da janela.
5. Chama `rule.between(fromNaive, untilNaive, true, iterator)` diretamente na `RRule` (não há `RRuleSet` — ver Decisões) para obter as ocorrências no espaço ingénuo. O `iterator` deixa passar até um candidato além do teto de 10 000; se o resultado ainda assim exceder o teto, `expandOccurrences` lança em vez de devolver um resultado parcial — um corte silencioso seria indistinguível de "sem ocorrências", perigoso numa função também usada para detetar sobreposição de horários. Com a allowlist do ponto 3 e o teto de janela do ponto 2, nenhuma forma de `rrule` hoje permitida gera mais de ~1 candidato/dia, logo este teto é defesa em profundidade não alcançável por input legal — continua testado diretamente (substituindo a saída do motor) para não perder a proteção.
6. Para cada ocorrência ingénua: `fromWallClock` materializa o instante absoluto real (`start`); `end = start + durationMinutes`; `localStart` é re-derivado desse instante real via `toWallClock(start, tz)` — não copiado do valor ingénuo de entrada, para refletir corretamente o caso em que a hora de parede pedida cai num buraco de DST (spring-forward) e nunca aconteceu de facto.
7. Filtra `series.exdates` **depois** da expansão, no mesmo espaço resolvido de `localStart` (cada exdate passa pela mesma pipeline `parseWallClock → fromWallClock → toWallClock → formatWallClock` que uma ocorrência) — não antes, via `RRuleSet.exdate()`, que compararia contra o espaço ingénuo de entrada. Dentro de um buraco de DST os dois espaços divergem (entrada ingénua `00:30`, `localStart` resolvido `01:30`); filtrar pós-resolução garante que um exdate no formato de entrada nominal cancela a ocorrência que a API efetivamente relata.
8. Filtra o resultado final em espaço absoluto real (`start >= window.from && start < window.until`) — é o único espaço onde a comparação com a janela é sempre verdadeira, mesmo quando o offset varia dentro dela.

## Pontos de entrada

- `toTimeZoneId(value: string): TimeZoneId` — valida um fuso IANA via `Intl`, lança `Error` se inválido.
- `expandOccurrences(series: RecurringSeries, window: Window): Occurrence[]` — expande a série na janela pedida. Lança `Error` nos casos de validação do passo 2 acima (ronda S04-01: superfície de erro ampliada, assinatura pública inalterada).

## Decisões recentes relevantes

Expansão em espaço de parede ingénuo + materialização por `TZDate` (`@date-fns/tz`), não `tzid` nativo do `rrule`, para não duplicar motor de fuso horário — ver `docs/adr/ADR-S04-01-expansao-parede-ingenua-tzdate.md`.

Construção da série via `RRule` sozinha, com uma **allowlist explícita** de campos (`freq`/`interval`/`count`/`until`/`byweekday`/`bymonth`/`bymonthday`/`bysetpos`) em vez de `{ ...RRule.parseString(series.rrule), dtstart }`. O spread propagava *todos* os campos que o parser reconhecesse na string do atacante — incluindo `tzid` e um `dtstart` embutido — para o construtor do `RRule`; um `TZID=...` na mesma linha do `FREQ` (sem quebra de linha, logo invisível ao guard de injeção iCal) deslocava silenciosamente todas as ocorrências. Nomear os campos que este produto de facto usa fecha esse vetor por construção, não por deteção.

Sem `RRuleSet`: `set.exdate()` comparava exdates no espaço ingénuo de entrada contra ocorrências já geradas — divergia dentro de um buraco de DST (ver ponto 7 do fluxo). `RRule.between(...)` é chamado diretamente e as exdates são filtradas depois, no espaço resolvido; o import de `RRuleSet` foi removido.

Teto de ocorrências (`MAX_OCCURRENCES`) falha fechado: se o motor devolver mais candidatos do que o teto, `expandOccurrences` lança em vez de truncar em silêncio (ver ponto 5 do fluxo) — um resultado parcial indistinguível de um resultado completo é perigoso numa função de deteção de sobreposição.

Anteriormente (pré-S04-01), a série era construída por síntese de string ICS + `rrulestr(..., { forceset: true })`; essa síntese concatenava `series.rrule` numa string multi-linha interpretada linha a linha, o que era o vetor de injeção de linha iCal original (`\n`/`\r` em `series.rrule`/`exdates` podia injetar `RDATE:`/`EXDATE:`/uma segunda `RRULE:`). O guard explícito contra `\r`/`\n` (ponto 2 do fluxo) fica como defesa em profundidade mesmo depois da migração para a API do `RRule`.
