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
2. Senão, o `useEffect` carrega as duas fontes em paralelo via `Promise.all`
   (S09-02): `carregarPacientes` (`listPatients` → `openSummaries`, Web Worker,
   default `openSummariesInWorker`, injetável por prop para teste, →
   `obterConsentimentos` por paciente) e `carregarSessoes`
   (`listarSessoes(baseUrl, accId, token, agora, agora + SETE_DIAS_MS)`). Cada
   uma tem o seu próprio `.catch` que absorve qualquer rejeição (rede, JSON
   malformado) e a converte no mesmo `ResultadoFonte<T>` que um `ProblemResult`
   já produz — nenhuma das duas rejeita para o `Promise.all`, senão a falha de
   uma derrubaria a outra. Se `listPatients` falhar, KPI "Pacientes ativos"
   mostra "—", uma linha `role="alert"` aparece, e tanto o risco quanto o
   consentimento somem da fila (os `patientId` vinham dali) — mas a assinatura
   (vem de `notas`, prop, nunca falha) continua. Se `listarSessoes` falhar, KPI
   "Sessões na semana" mostra "—" e um **segundo** `role="alert"`, irmão do
   primeiro, aparece com o motivo — a ação principal cai para "Iniciar próxima
   sessão" sem nome (não há sessão para nomear).
3. Com os pacientes resolvidos, um `obterConsentimentos` por paciente via
   `Promise.allSettled` — o paciente cujo pedido falhar cai da lista de
   consentimentos, os outros continuam de pé (critério de aceite 4).
4. Render: `proximaSessao(sessoes.dados, new Date())` (só quando `sessoes.ok`,
   senão `null`) decide a sessão da ação principal; o nome vem do sumário
   decifrado casado por `patientId` — nunca o `patientId` cru quando o sumário
   falta ou não decifrou (critério 1). `juntarRequerVoce` agrega
   risco+assinatura+consentimento sem duplicar nem perder item (critério 2);
   exatamente dois `KpiStrip.Item` — nenhuma métrica de vaidade (critério 3).

## Pontos de entrada

- `PainelProfissional` (`PainelProfissional.tsx`) — componente React. Props:
  `baseUrl`, `accountId: string | null`, `accessToken: string | null`,
  `kek: CryptoKey | null`, `notas: readonly Nota[]`, `openSummaries?` (seam de
  teste). **`sessoes` saiu das props no S09-02** — o widget carrega-as sozinho,
  no mesmo `useEffect` que já carregava os pacientes (ver "Decisões desta
  fatia" da forma S09-02, `.harness/S09-02-forma.md` §1: guarda kek/conta/token
  única, mesmo `cancelled`/`AbortController`, sem duplicar em `HomePage`/router).
- `itensDeRisco`, `itensDeAssinatura`, `itensDeConsentimento`, `juntarRequerVoce`
  (`requer-voce.ts`) — puros, testados isoladamente do React em
  `requer-voce.test.ts`.
- Consumido por `pages/home/HomePage.tsx`, que por sua vez é montada por
  `IndexRouteComponent` (`app/routing/router.tsx`) com as props da sessão real
  (`accountId`) e fixture (`accessToken`/`kek`/`notas`) enquanto não existir
  `KeychainProvider` nem o `GET` de nota.

## Decisões desta fatia

- **`ItemRequerVoce` nunca carrega o nome do paciente.** O nome só existe
  decifrado em `SummaryResult`; o render resolve por `patientId` a cada
  renderização — nenhum nome em claro é copiado para uma segunda estrutura.
- **`ResultadoFonte<T>` (local a `PainelProfissional.tsx`) em vez de lançar.**
  `Promise.allSettled` + `{ok:true,dados}|{ok:false,motivo}` é o mecanismo do
  critério 4: uma `ErrorBoundary` apanha throws de render, não promessas
  rejeitadas, e desmontaria a subárvore inteira — o oposto do que "a falha de
  uma fonte não derruba o painel inteiro" pede. Fonte única: o estado `pronto`
  tem um só `pacientes: ResultadoFonte<{ sumarios, consentimentos }>` — os
  sumários e os consentimentos nascem juntos (mesmo `listPatients`) e falham
  juntos; não há dois `motivo` divergentes para o mesmo erro. `juntarRequerVoce`
  (`requer-voce.ts`) não conhece `ResultadoFonte`: recebe listas já resolvidas
  (`[]` quando `pacientes` falhou), o isolamento de falha por fonte é decidido
  na chamada, em `PainelProfissional.tsx`.
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

## Decisões do S09-02

- **As sessões carregam-se no widget, não no router.** `sessoes` saiu das props;
  o `useEffect` já existente ganhou uma segunda fonte. Alternativa rejeitada:
  carregar no router e passar por prop — duplicaria a guarda
  `chaveiroDestrancado` fora do widget, um segundo `AbortController` e um
  `sessoes: readonly SessaoAgendada[]` simples em vez de `ResultadoFonte<...>`
  (ver `.harness/S09-02-forma.md` §1).
- **Duas fontes, dois `.catch`, um só `Promise.all`.** `carregarPacientes` e
  `carregarSessoes` nunca rejeitam para fora de si — cada uma converte a sua
  própria falha (rede ou `ProblemResult`) no mesmo `ResultadoFonte<T>` antes de
  entrar no `Promise.all`, para a falha de uma fonte nunca arrastar a outra.
  Por isso o `carregar(...)` externo não tem `.catch()` (ao contrário de
  `PatientWallet.tsx`): um `.catch` aí ficaria morto — nunca dispararia — e
  reprovaria o portão de cobertura de funções.
- **`SETE_DIAS_MS` exportada de `entities/agenda/sessao.ts`.** Único ponto que
  define a janela de 7 dias; o widget usa o mesmo valor para pedir ao backend
  (`listarSessoes(..., agora, agora + SETE_DIAS_MS)`) e para o KPI
  (`sessoesNaSemana`), sem repetir o literal.

## Fora de âmbito (ver `.harness/S09-01-forma.md`, secção 1 e "Decisões que esperam o humano")

- Nenhuma listagem real de notas: `notas` também chega por prop, hoje sempre
  `[]` a partir do router — a fila de assinatura nasce vazia em produção pelo
  mesmo motivo.
- Nada de mover/cancelar sessão, nada de "hoje" separado da semana além da
  contagem, nada de `KeychainProvider` — o painel monta sempre em "chaveiro
  bloqueado" em produção, igual a `PatientWallet`.
