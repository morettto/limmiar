# entities/agenda

## Responsabilidade

Modelo puro de uma sessão já agendada (ticket S09-01, painel profissional). Sem
`api.ts`: o backend não expõe leitura de agenda (`SchedulingEndpoints.cs` só tem
`POST`/`PATCH`/`DELETE`), então este módulo não inventa um endpoint — a lista de
sessões entra sempre por prop, injetada por quem monta o widget que a consome.
Zero I/O, zero React.

## Fluxo principal

1. `SessaoAgendada` espelha o `ScheduledSessionResponse` do backend (`sessionId`,
   `patientId`, `inicioEm` ISO 8601 = `StartsAt`, `duracaoMinutos`, `canceladaEm`
   = `CancelledAt`).
2. `proximaSessao(sessoes, agora)` — pura. Devolve a sessão de menor `inicioEm`
   que ainda não passou (`inicioEm >= agora`) e não está cancelada; `null` se não
   houver nenhuma. É a fonte da ação principal do painel profissional (critério
   de aceite 1: nomear o paciente correto da sessão seguinte).
3. `sessoesNaSemana(sessoes, agora)` — pura. Conta as sessões não canceladas com
   `inicioEm` dentro de `[agora, agora + 7 dias)`. É um KPI (contagem), não uma
   vista de agenda — não expande recorrência nem agrupa por dia.
4. `horaDaSessao(inicioEm, locale)` — pura. `toLocaleTimeString` só hora:minuto.
   Vive aqui (não no widget) porque `entities/agenda/sessao.ts` é `.ts` puro,
   fora do alcance de `lingui/no-unlocalized-strings` — os literais `'2-digit'`
   dispararam o lint quando estavam inline num `.tsx` (mesmo motivo de
   `entities/nota/nota.ts` para `ORDEM_SECOES`).

## Pontos de entrada

- `SessaoAgendada` (tipo).
- `proximaSessao(sessoes: readonly SessaoAgendada[], agora: Date): SessaoAgendada | null`
- `sessoesNaSemana(sessoes: readonly SessaoAgendada[], agora: Date): number`
- `horaDaSessao(inicioEm: string, locale: string): string`
- Consumido por `widgets/painel-profissional/PainelProfissional.tsx`.

## Decisões desta fatia

- **Sem `api.ts` de propósito.** Ver `Scheduling/README.md` (backend): não há
  `GET` da agenda porque nenhum critério de aceite anterior pediu. O critério 1
  deste ticket fica verde em teste (sessões injetadas) e cinzento em produção
  até esse `GET` existir — bloqueio registado, não contornado aqui.
- **Sem `packages/agenda`.** Esse pacote expande recorrência RRULE;
  `scheduled_sessions` já são linhas concretas (uma sessão = uma linha), não há
  recorrência para expandir neste fluxo.
- **"Hoje" não é um conceito à parte.** `proximaSessao` e `sessoesNaSemana` não
  distinguem hoje do resto da semana — só a contagem de 7 dias existe hoje;
  qualquer UI de "hoje" fica para uma fatia futura, quando o `GET` real existir.
- **Teste de `horaDaSessao` com TZ pinada (`vi.stubEnv('TZ', 'America/Sao_Paulo')`)
  e valor literal esperado, não a própria implementação repetida.** A primeira
  versão comparava contra `toLocaleTimeString(...)` com as mesmas opções da
  função — tautológico, trocar `'2-digit'` por `'numeric'` continuaria verde
  (achado da ronda 1 de review). Brasil não observa horário de verão desde
  2019, então UTC-3 é estável o ano inteiro — a entrada UTC do teste foi
  escolhida para cair num valor literal fixo (`'15:30'`) nesse fuso.
