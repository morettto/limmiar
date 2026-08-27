# ADR-S04-01: Expansão de RRULE em espaço de parede ingénuo + materialização por TZDate

## Contexto

`packages/agenda` precisa de expandir séries recorrentes (RRULE RFC5545) numa janela de tempo, mantendo a hora de parede local (ex.: "toda quinta às 14:00") mesmo quando o fuso horário atravessa uma mudança de horário de verão (DST) — o offset UTC do instante real muda, a hora local não.

A lib `rrule` sabe lidar com um `tzid` nativo, mas o suporte de fuso horário embutido nela depende de bibliotecas de terceiros (Luxon é a integração documentada). Isso introduziria um segundo motor de fuso horário no pacote, ao lado do `date-fns` já escolhido para o resto do projeto (ver `ADR-S00.5-03`, que fixa Intl/date-fns como fonte única de formatação de data neste monorepo) — dois motores de fuso podem discordar sobre a mesma regra histórica de DST.

## Decisão

Expandir a série inteiramente em "espaço de parede ingénuo": os campos UTC de um `Date` "ingénuo" carregam os valores da hora de parede local, sem qualquer noção de fuso. `rrule` opera apenas sobre esse espaço ingénuo (não recebe `tzid`). A materialização para o instante absoluto real acontece só nas duas bordas — na entrada (converter a janela `[from, until)` real para ingénua, com folga de ±1 dia) e na saída (converter cada ocorrência ingénua para o instante absoluto real) — usando `TZDate` do pacote `@date-fns/tz` (a extensão oficial do date-fns para fuso horário, não uma biblioteca concorrente).

## Consequências

- Um único motor de fuso horário no monorepo (date-fns/@date-fns/tz); nenhuma dependência de Luxon é introduzida.
- `rrule` nunca vê um fuso horário — toda a lógica de DST fica confinada às duas funções de fronteira (`toWallClock`/`fromWallClock`), fáceis de testar isoladamente.
- O filtro final de pertença à janela tem de ser feito em espaço absoluto real (não no ingénuo), porque é o único espaço onde a comparação com `[from, until)` é sempre verdadeira quando o offset muda dentro da janela — ver `packages/agenda/src/recurrence.ts`.
- `.dependency-cruiser.cjs` do pacote proíbe a importação de qualquer segunda biblioteca de fuso horário (luxon, dayjs, moment, moment-timezone), tornando esta decisão estruturalmente exigível, não apenas documentada.
