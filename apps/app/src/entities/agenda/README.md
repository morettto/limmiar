# entities/agenda

## Responsabilidade

Modelo puro de uma sessão já agendada (ticket S09-01) mais, desde o S09-02, o
`api.ts` que a lê do backend real. Zero React em qualquer dos dois; `api.ts`
depende só de `shared/api` (o `request` partilhado) e de `./sessao`.

## Fluxo principal

1. `SessaoAgendada` espelha o `ScheduledSessionListItem` do backend (`sessionId`,
   `patientId`, `inicioEm` ISO 8601 = `StartsAt`, `duracaoMinutos`). Sem
   `canceladaEm` (S09-04): o `GET` só devolve sessões vivas, uma cancelada nunca
   aparece na lista, então o campo não tinha razão de existir no tipo.
2. `listarSessoes(baseUrl, accountId, accessToken, de, ate)` — `GET
   /accounts/{accountId}/agenda/sessions?from=&to=`, `de`/`ate` via
   `toISOString()` + `encodeURIComponent` (o backend faz parse de string, ver
   `Scheduling/README.md`). Mapeia os 4 campos do corpo (`sessions[]`) para
   `SessaoAgendada[]`; `ListarSessoesResult` é `{ok:true, sessoes}` ou o
   `ProblemResult` partilhado, intacto num erro (403/401/etc.).
3. `proximaSessao(sessoes, agora)` — pura. `porComecar(sessoes, agora)[0] ?? null`:
   confia na ordem do contrato (`ORDER BY starts_at`), não ordena de novo. É a
   fonte da ação principal do painel profissional (critério de aceite 1: nomear
   o paciente correto da sessão seguinte).
4. `sessoesNaSemana(sessoes, agora)` — pura. `porComecar(sessoes, agora).length`:
   conta as que ainda não começaram, sem recortar o limite superior de 7 dias —
   essa janela é do pedido ao backend (`listarSessoes(..., agora, agora +
   SETE_DIAS_MS)`), não do KPI. É uma contagem, não uma vista de agenda — não
   expande recorrência nem agrupa por dia.
5. `horaDaSessao(inicioEm, locale)` — pura. `toLocaleTimeString` só hora:minuto.
   Vive aqui (não no widget) porque `entities/agenda/sessao.ts` é `.ts` puro,
   fora do alcance de `lingui/no-unlocalized-strings` — os literais `'2-digit'`
   dispararam o lint quando estavam inline num `.tsx` (mesmo motivo de
   `entities/nota/nota.ts` para `ORDEM_SECOES`).

## Pontos de entrada

- `SessaoAgendada` (tipo).
- `listarSessoes(baseUrl, accountId, accessToken, de: Date, ate: Date): Promise<ListarSessoesResult>`
  (`api.ts`).
- `SETE_DIAS_MS` — exportada (S09-02) para o widget construir a janela `[agora, agora + SETE_DIAS_MS)`
  sem repetir o literal.
- `proximaSessao(sessoes: readonly SessaoAgendada[], agora: Date): SessaoAgendada | null`
- `sessoesNaSemana(sessoes: readonly SessaoAgendada[], agora: Date): number`
- `horaDaSessao(inicioEm: string, locale: string): string`
- Consumido por `widgets/painel-profissional/PainelProfissional.tsx`.

## Decisões desta fatia

- **Sem `packages/agenda`.** Esse pacote expande recorrência RRULE;
  `scheduled_sessions` já são linhas concretas (uma sessão = uma linha), não há
  recorrência para expandir neste fluxo.
- **"Hoje" não é um conceito à parte.** `proximaSessao` e `sessoesNaSemana` não
  distinguem hoje do resto da semana — só a contagem de 7 dias existe hoje;
  qualquer UI de "hoje" fica para uma fatia futura.
- **Teste de `horaDaSessao` com TZ pinada (`vi.stubEnv('TZ', 'America/Sao_Paulo')`)
  e valor literal esperado, não a própria implementação repetida.** A primeira
  versão comparava contra `toLocaleTimeString(...)` com as mesmas opções da
  função — tautológico, trocar `'2-digit'` por `'numeric'` continuaria verde
  (achado da ronda 1 de review). Brasil não observa horário de verão desde
  2019, então UTC-3 é estável o ano inteiro — a entrada UTC do teste foi
  escolhida para cair num valor literal fixo (`'15:30'`) nesse fuso.

## Decisões do S09-02

- **`api.ts` no molde de `entities/patient/api.ts`.** Mesmo `request` partilhado,
  mesmo formato `{ok:true,...}|ProblemResult`; o corpo `{sessions:[...]}` mapeia
  campo a campo (`startsAt`→`inicioEm`, `durationMinutes`→`duracaoMinutos`).

## Decisões do S09-04

- **`canceladaEm` saiu do tipo, não só do mapeamento.** O `GET` já só devolvia
  vivas; o item da lista nunca tinha um `cancelledAt` de verdade para mapear
  (o backend hoje nem manda a propriedade — ver `Scheduling/README.md`,
  `ScheduledSessionListItem`). Um campo sempre `null` no tipo era uma mentira de
  interface — quem lê `SessaoAgendada` não tinha como saber que `canceladaEm`
  jamais varia.
- **`porComecar` — um só filtro de tempo, privado ao módulo.** `proximaSessao`
  e `sessoesNaSemana` eram dois filtros quase idênticos (um com `.reduce` para
  achar o menor, o outro com limite superior de 7 dias); agora os dois só
  fatiam o resultado de `porComecar`. `proximaSessao` deixou de ordenar
  (`.reduce`) porque o contrato já devolve `ORDER BY starts_at` — confiar nisso
  é mais barato do que reordenar no cliente algo que o servidor já ordenou.
  `sessoesNaSemana` deixou de recortar o limite superior de 7 dias: essa janela
  é do pedido (`listarSessoes(..., agora, agora + SETE_DIAS_MS)`), repetir o
  recorte no KPI é que causava o desencontro de borda entre o `agora` do fetch
  e o `agora` do render (ver `painel-profissional/README.md`).
