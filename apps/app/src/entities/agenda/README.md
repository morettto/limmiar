# entities/agenda

## Responsabilidade

Modelo puro de uma sessão já agendada mais o `api.ts` que a lê do backend
real. Zero React em qualquer dos dois; `api.ts` depende só de `shared/api`
(o `request` partilhado) e de `./sessao`.

## Fluxo principal

1. `SessaoAgendada` espelha o `ScheduledSessionListItem` do backend (`sessionId`,
   `patientId`, `inicioEm` ISO 8601 = `StartsAt`, `duracaoMinutos`). Sem
   `canceladaEm`: o `GET` só devolve sessões vivas, uma cancelada nunca
   aparece na lista, então o campo não tem razão de existir no tipo.
2. `listarSessoes(baseUrl, accountId, accessToken, de, ate)` — `GET
   /accounts/{accountId}/agenda/sessions?from=&to=`, `de`/`ate` via
   `toISOString()` + `encodeURIComponent` (o backend faz parse de string, ver
   `Scheduling/README.md`). Mapeia os 4 campos do corpo (`sessions[]`) para
   `SessaoAgendada[]`; `ListarSessoesResult` é `{ok:true, sessoes}` ou o
   `ProblemResult` partilhado, intacto num erro (403/401/etc.). Quem quiser
   uma janela específica (ex.: os próximos 7 dias) monta `de`/`ate` do lado de
   fora — ver `painel-profissional/README.md`.
3. `proximaSessao(sessoes, agora)` — pura. `porComecar(sessoes, agora)[0] ?? null`:
   confia na ordem do contrato (`ORDER BY starts_at`), não ordena de novo. É a
   fonte da ação principal do painel profissional (nomear o paciente correto
   da sessão seguinte).
4. `contarPorComecar(sessoes, agora)` — pura. `porComecar(sessoes, agora).length`:
   conta as que ainda não começaram, sem recortar limite superior nenhum —
   quem quiser uma janela recorta-a no pedido (`listarSessoes`), não aqui.
   É uma contagem, não uma vista de agenda — não expande recorrência nem
   agrupa por dia.
5. `horaDaSessao(inicioEm, locale, timeZone?)` — pura. `toLocaleTimeString` só
   hora:minuto. Vive aqui (não no widget) porque `entities/agenda/sessao.ts` é
   `.ts` puro, fora do alcance de `lingui/no-unlocalized-strings` — os
   literais `'2-digit'` disparariam o lint num `.tsx` (mesmo motivo de
   `entities/nota/nota.ts` para `ORDEM_SECOES`). `timeZone` é opcional e só
   existe para o teste: omitido (uso em produção), usa o fuso do navegador;
   passado explícito, ignora qualquer `TZ` de ambiente — ver "Decisões".

## Pontos de entrada

- `SessaoAgendada` (tipo).
- `listarSessoes(baseUrl, accountId, accessToken, de: Date, ate: Date): Promise<ListarSessoesResult>`
  (`api.ts`).
- `proximaSessao(sessoes: readonly SessaoAgendada[], agora: Date): SessaoAgendada | null`
- `contarPorComecar(sessoes: readonly SessaoAgendada[], agora: Date): number`
- `horaDaSessao(inicioEm: string, locale: string, timeZone?: string): string`
- Consumido por `widgets/painel-profissional/PainelProfissional.tsx`.

## Decisões desta fatia

- **Sem `packages/agenda`.** Esse pacote expande recorrência RRULE;
  `scheduled_sessions` já são linhas concretas (uma sessão = uma linha), não há
  recorrência para expandir neste fluxo.
- **"Hoje" não é um conceito à parte.** `proximaSessao` e `contarPorComecar` não
  distinguem hoje do resto da semana — a janela do pedido é decisão de quem
  chama `listarSessoes`; qualquer UI de "hoje" fica para uma fatia futura.
- **`api.ts` no molde de `entities/patient/api.ts`.** Mesmo `request`
  partilhado, mesmo formato `{ok:true,...}|ProblemResult`; o corpo
  `{sessions:[...]}` mapeia campo a campo (`startsAt`→`inicioEm`,
  `durationMinutes`→`duracaoMinutos`).
- **`porComecar` — um só filtro de tempo, privado ao módulo.**
  `proximaSessao` e `contarPorComecar` fatiam o mesmo resultado em vez de
  filtrar duas vezes; `proximaSessao` confia na ordem do contrato
  (`ORDER BY starts_at`) em vez de reordenar no cliente algo que o servidor
  já ordenou.
- **Teste de `horaDaSessao` passa `timeZone` explícito, não `vi.stubEnv('TZ',
  ...)`.** Um `TZ` de ambiente muda o resultado só se nenhum `Intl` tiver
  rodado ainda neste processo — o runner do Stryker reaproveita workers entre
  mutantes, então o valor pode já estar cacheado quando o teste muda o `TZ`
  (visto em CI: o mesmo teste passava isolado e falhava dentro do Stryker). Um
  `timeZone` passado à própria chamada não depende desse cache. Brasil não
  observa horário de verão desde 2019 (UTC-3 o ano inteiro), então a entrada
  UTC do teste cai num valor literal fixo (`'08:05'`) nesse fuso — hora e
  minuto de um só dígito, para `'2-digit'`→`'numeric'` mudar a string.
