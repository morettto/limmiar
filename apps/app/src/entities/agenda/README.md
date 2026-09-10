# entities/agenda

## Responsabilidade

Modelo puro de uma sessão já agendada (ticket S09-01) mais, desde o S09-02, o
`api.ts` que a lê do backend real. Zero React em qualquer dos dois; `api.ts`
depende só de `shared/api` (o `request` partilhado) e de `./sessao`.

## Fluxo principal

1. `SessaoAgendada` espelha o `ScheduledSessionResponse` do backend (`sessionId`,
   `patientId`, `inicioEm` ISO 8601 = `StartsAt`, `duracaoMinutos`, `canceladaEm`
   = `CancelledAt`).
2. `listarSessoes(baseUrl, accountId, accessToken, de, ate)` — `GET
   /accounts/{accountId}/agenda/sessions?from=&to=`, `de`/`ate` via
   `toISOString()` + `encodeURIComponent` (o backend faz parse de string, ver
   `Scheduling/README.md`). Mapeia os 5 campos do corpo (`sessions[]`) para
   `SessaoAgendada[]`; `ListarSessoesResult` é `{ok:true, sessoes}` ou o
   `ProblemResult` partilhado, intacto num erro (403/401/etc.).
3. `proximaSessao(sessoes, agora)` — pura. Devolve a sessão de menor `inicioEm`
   que ainda não passou (`inicioEm >= agora`) e não está cancelada; `null` se não
   houver nenhuma. É a fonte da ação principal do painel profissional (critério
   de aceite 1: nomear o paciente correto da sessão seguinte).
4. `sessoesNaSemana(sessoes, agora)` — pura. Conta as sessões não canceladas com
   `inicioEm` dentro de `[agora, agora + SETE_DIAS_MS)`. É um KPI (contagem), não
   uma vista de agenda — não expande recorrência nem agrupa por dia.
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
  campo a campo (`startsAt`→`inicioEm`, `durationMinutes`→`duracaoMinutos`,
  `cancelledAt`→`canceladaEm`) — o backend inclui as canceladas fora da janela
  viva por decisão do endpoint (ver `Scheduling/README.md`); `cancelledAt` nunca
  vem preenchido nesta lista, mas o campo continua mapeado por completude.
