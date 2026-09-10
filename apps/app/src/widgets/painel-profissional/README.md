# widgets/painel-profissional

## Responsabilidade

Painel inicial do profissional (ticket S09-01): a ação principal ("iniciar
próxima sessão"), dois KPIs e a fila "Requer você". É o único ponto do app que
junta paciente (`entities/patient`), consentimento (`entities/consentimento`),
nota (`entities/nota`) e agenda (`entities/agenda`) — nenhuma dessas entidades
sabe da outra; a composição e o isolamento de falha por fonte vivem só aqui.

## Fluxo principal

1. `chaveiroDestrancado({ kek, accountId, accessToken })` falso (qualquer um dos
   três `null`) → estado `bloqueado`: nenhum pedido sai, mostra "Chaveiro
   bloqueado..." (`role="status"`, mesmo padrão de
   `widgets/patient-wallet/PatientWallet.tsx`). É o estado real em produção
   hoje — não há `KeychainProvider` ainda. `chaveiroDestrancado` é a fonte única
   dessa guarda: tanto `estadoInicial` (usado no `useState` do primeiro
   render) quanto o `useEffect` a chamam — a guarda repetida em dois sítios
   divergiu na ronda 1 de review (`estadoInicial` só olhava `kek`), causando um
   flash de "Carregando painel..." antes do efeito corrigir. Recebe o trio como
   objeto e é um type predicate porque o `tsc -b` do `build` exige que a guarda
   estreite os três valores — um `boolean` compilava no `tsc --noEmit` e caía no
   `build`.
2. Senão, `listPatients` → `openSummaries` (Web Worker, default
   `openSummariesInWorker`, injetável por prop para teste) → decifra os
   sumários. Se `listPatients` falhar, KPI "Pacientes ativos" mostra "—", uma
   linha `role="alert"` aparece, e tanto o risco quanto o consentimento somem da
   fila (os `patientId` vinham dali) — mas a assinatura (vem de `notas`, prop,
   nunca falha) continua.
3. Com os pacientes resolvidos, um `obterConsentimentos` por paciente via
   `Promise.allSettled` — o paciente cujo pedido falhar cai da lista de
   consentimentos, os outros continuam de pé (critério de aceite 4).
4. Render: `proximaSessao(sessoes, new Date())` decide a sessão da ação
   principal; o nome vem do sumário decifrado casado por `patientId` — nunca o
   `patientId` cru quando o sumário falta ou não decifrou (critério 1).
   `juntarRequerVoce` agrega risco+assinatura+consentimento sem duplicar nem
   perder item (critério 2); exatamente dois `KpiStrip.Item` — nenhuma métrica
   de vaidade (critério 3).

## Pontos de entrada

- `PainelProfissional` (`PainelProfissional.tsx`) — componente React. Props:
  `baseUrl`, `accountId: string | null`, `accessToken: string | null`,
  `kek: CryptoKey | null`, `notas: readonly Nota[]`,
  `sessoes: readonly SessaoAgendada[]`, `openSummaries?` (seam de teste).
- `itensDeRisco`, `itensDeAssinatura`, `itensDeConsentimento`, `juntarRequerVoce`
  (`requer-voce.ts`) — puros, testados isoladamente do React em
  `requer-voce.test.ts`.
- Consumido por `pages/home/HomePage.tsx`, que por sua vez é montada por
  `IndexRouteComponent` (`app/routing/router.tsx`) com as props da sessão real
  (`accountId`) e fixture (`accessToken`/`kek`/`notas`/`sessoes`) enquanto não
  existir `KeychainProvider` nem os `GET`s de nota/agenda.

## Decisões desta fatia

- **`ItemRequerVoce` nunca carrega o nome do paciente.** O nome só existe
  decifrado em `SummaryResult`; o render resolve por `patientId` a cada
  renderização — nenhum nome em claro é copiado para uma segunda estrutura.
- **`ResultadoFonte<T>` em vez de lançar.** `Promise.allSettled` +
  `{ok:true,dados}|{ok:false,motivo}` por fonte é o mecanismo do critério 4: uma
  `ErrorBoundary` apanha throws de render, não promessas rejeitadas, e
  desmontaria a subárvore inteira — o oposto do que "a falha de uma fonte não
  derruba o painel inteiro" pede.
- `ponytail:` o `useEffect` faz um `obterConsentimentos` por paciente (fan-out
  N+1) em vez de um endpoint em lote — teto conhecido: aceitável enquanto a
  lista de pacientes ativos for pequena; upgrade natural é
  `GET /accounts/{accountId}/patients/consents?ids=...` quando isso virar o
  gargalo visível.
- **Falha de `obterConsentimentos` vira valor, não `throw`.** Dentro do
  `Promise.allSettled`, um `ProblemResult` (`{ok:false}`) é devolvido como
  valor resolvido `{ok:false}` e filtrado — não lançado. `throw` fica reservado
  para a rejeição genuína (erro de rede/fetch), que `allSettled` continua a
  apanhar; um valor de domínio esperado não é uma exceção de controlo de
  fluxo (nota da ronda 1 de review).
- **Um `agora = new Date()` só, partilhado por `proximaSessao` e
  `sessoesNaSemana`.** Duas chamadas a `new Date()` no mesmo render podiam
  observar instantes diferentes numa fronteira de segundo, fazendo o botão de
  ação e o KPI "Sessões na semana" discordarem entre si (nota da ronda 1).

## Fora de âmbito (ver `.harness/S09-01-forma.md`, secção 1 e "Decisões que esperam o humano")

- Nenhum `GET` de agenda: `sessoes` chega sempre por prop. Critério 1 fica verde
  em teste e cinzento em produção até esse endpoint existir (ticket de backend
  a jusante).
- Nenhuma listagem real de notas: `notas` também chega por prop, hoje sempre
  `[]` a partir do router — a fila de assinatura nasce vazia em produção pelo
  mesmo motivo.
- Nada de mover/cancelar sessão, nada de "hoje" separado da semana além da
  contagem, nada de `KeychainProvider` — o painel monta sempre em "chaveiro
  bloqueado" em produção, igual a `PatientWallet`.
