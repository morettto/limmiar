# Receipt — S04-01 Modelo de tempo local + IANA + expansão RRULE

commit: 37babb0a72fef53cfd6a612ee5bd8c109dc9f394
branch: feat/S04-01-modelo-tempo-rrule
spec: S04 Agenda
rondas_review: 2

## Critério × prova × resultado

| Critério de aceite | Prova | Resultado |
|---|---|---|
| Série semanal atravessa DST mantendo a hora local | `packages/agenda/src/recurrence.test.ts` — asserção de `localStart` fixo e salto de hora UTC na viragem de 2018-02-18 | PASS |
| Nenhuma ocorrência cai fora da janela pedida | teste de fronteira + propriedade `fast-check` sobre janelas aleatórias 2017–2019 | PASS |
| EXDATE remove exatamente uma ocorrência | teste dedicado, com/sem exdate, incluindo caso em buraco de DST | PASS |
| Golden master de um ano com DST histórico | `golden-year.test.ts` — 2017 (com DST) e 2020 (sem DST), snapshot | PASS |

## Pipeline

1. Forma aprovada por `architect` antes de código (show-me).
2. Construção `lean-build` + TDD via `implementer` — 13 testes, 100% cobertura inicial.
3. Verificação independente via `runner` — confirmado.
4. Cadeia de review (5 eixos, paralelo): `reviewer-lang`, `reviewer-thermo`, `reviewer-spec`, `reviewer-lean`, `reviewer-security`.
   - **Ronda 1** — 4 bloqueantes: buraco de DST (spec), custo sem limite de expansão RRULE (security), injeção de linha iCal (security), complexidade incidental evitável — ICS manual/forceset/cast, `parseWallClock`/`formatWallClock` reimplementando stdlib (lang + thermo). Corrigidos.
   - **Ronda 2** (só achados novos introduzidos pela Ronda 1) — 5 bloqueantes: `{...parsed, dtstart}` deixava passar `TZID` embutido (thermo + security), `INTERVAL` negativo causava loop infinito irrecuperável (security), `series.rrule` vazia caía em `YEARLY` silencioso (thermo), teto de ocorrências falhava aberto por truncagem silenciosa (security), inconsistência `localStart`↔`exdates` no buraco de DST (thermo), overflow silencioso de calendário em `parseWallClock` (lang). Corrigidos com allowlist explícita de campos RRULE + eliminação do `RRuleSet` + filtragem de exdates no espaço resolvido + round-trip check de calendário. Durante a correção, o próprio implementer descobriu e fechou um sexto bug (`interval: undefined` sobrescrevendo o default da lib) introduzido pela primeira tentativa de allowlist.
   - Sem ronda 3 (regra do harness). Nenhum achado não-bloqueante corrigido neste ticket (adiados: dependência `date-fns` não usada, nome `Window` colidindo com DOM, `SLACK_MS` sem comentário, revalidação de branded type, `noUncheckedIndexedAccess`, tipo `WallClockString`, mensagens de erro cruas).
5. Verificação final independente via `runner` — 40/40 testes, 100% cobertura, lint/arch/typecheck pass, sem processos pendurados.

## Cobertura final
statements 52/52, branches 47/47, functions 11/11, lines 52/52 (100% perFile).

## Documentação
`packages/agenda/README.md`, `ARCHITECTURE.md` (raiz, criado pela primeira vez), `docs/adr/ADR-S04-01-expansao-parede-ingenua-tzdate.md` (criado, formato próprio por não haver ADR anterior no repo).

## Nota de processo
Este ticket teve 2 rondas de review com achados de segurança genuinamente graves (DoS por loop infinito, injeção de dados via string RRULE) — candidato natural a `/build:friction`.
