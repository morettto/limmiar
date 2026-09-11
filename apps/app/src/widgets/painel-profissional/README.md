# widgets/painel-profissional

## Responsabilidade

Painel inicial do profissional: a ação principal ("iniciar próxima sessão"),
dois KPIs e a fila "Requer você". É o único ponto do app que junta paciente
(`entities/patient`), consentimento (`entities/consentimento`), nota
(`entities/nota`) e agenda (`entities/agenda`) — nenhuma dessas entidades
sabe da outra; a composição e o isolamento de falha por fonte vivem só aqui.

## Fluxo principal

1. O render decide "bloqueado" direto das props: `chaveiroDestrancado({ kek,
   accountId, accessToken })` falso (qualquer um dos três `null`) → mostra
   "Chaveiro bloqueado..." (`role="status"`), sem tocar no `useEffect` nem no
   estado interno. Nenhum pedido sai. `chaveiroDestrancado` é a fonte única
   dessa guarda — o efeito a reusa para decidir se busca.
2. Chaveiro destrancado: o `useEffect` carrega duas fontes em paralelo via
   `Promise.all`: `carregarPacientes` (`listPatients` → `openSummaries`, Web
   Worker, default `openSummariesInWorker`, injetável por prop para teste, →
   `obterConsentimentos` por paciente) e `carregarSessoes`
   (`listarSessoesDaSemana(baseUrl, accId, token, new Date())`). Cada uma tem
   o seu próprio `.catch` que absorve qualquer rejeição e a converte no mesmo
   `ResultadoFonte<T>` que um `ProblemResult` já produz — nenhuma das duas
   rejeita para o `Promise.all`, senão a falha de uma derrubaria a outra.
3. Com os pacientes resolvidos, um `obterConsentimentos` por paciente em
   paralelo (`Promise.all`, cada chamada com `.catch(() => null)`); o
   paciente cujo pedido falhar (resolvido `{ok:false}` ou rejeitado) cai da
   lista de consentimentos, os outros continuam de pé.
4. O cleanup do efeito (dispara ao trocar de conta ou desmontar) marca
   `cancelled`, aborta o `AbortController` e repõe `{status:'a-carregar'}` —
   a próxima conta nunca herda os dados "pronto" da anterior.
5. Render, chaveiro destrancado: `proximaSessao(sessoes.dados, new Date())`
   (só quando `sessoes.ok`, senão `null`) decide a sessão da ação principal;
   o nome vem do sumário decifrado casado por `patientId` — nunca o
   `patientId` cru quando o sumário falta ou não decifrou. `juntarRequerVoce`
   agrega risco+assinatura+consentimento sem duplicar nem perder item;
   exatamente dois `KpiStrip.Item` — nenhuma métrica de vaidade. Se
   `listPatients` falhar, KPI "Pacientes ativos" mostra "—" e um
   `role="alert"` aparece; se `listarSessoesDaSemana` falhar, KPI "Sessões na
   semana" mostra "—" e um segundo `role="alert"`, irmão do primeiro.

## Pontos de entrada

- `PainelProfissional` (`PainelProfissional.tsx`) — componente React. Props:
  `baseUrl`, `accountId: string | null`, `accessToken: string | null`,
  `kek: CryptoKey | null`, `notas: readonly Nota[]`, `openSummaries?` (seam de
  teste).
- `itensDeRisco`, `itensDeAssinatura`, `itensDeConsentimento`,
  `juntarRequerVoce`, `ConsentimentosPorPaciente` (`requer-voce.ts`) — puros,
  testados isoladamente do React em `requer-voce.test.ts`.
- Consumido por `pages/home/HomePage.tsx`, montada por `IndexRouteComponent`
  (`app/routing/router.tsx`) com as props da sessão real (`accountId`) e
  fixture (`accessToken`/`kek`/`notas`) enquanto não existir
  `KeychainProvider` nem o `GET` de nota.

## Decisões desta fatia

- **`EstadoPainel` só tem `'a-carregar' | 'pronto'`.** "Bloqueado" nunca foi
  um estado assíncrono — é uma função pura das props, decidida no render.
  Guardar no estado obrigava um `estadoInicial` exportado só para os testes e
  duplicava a mesma guarda no `useEffect`.
- **O cleanup do efeito é o único lugar que repõe `'a-carregar'`.** Antes o
  reset acontecia solto no início do corpo do efeito; centralizá-lo no
  cleanup garante que ele corre em toda troca de deps (conta, token, kek) e
  no unmount, sem depender de alguém lembrar de repetir a linha.
- **Cancelamento é checado no ponto de consumo, nunca lançado nem
  fabricado.** `carregarPacientes` faz `cancelled ? [] : await
  openSummaries(...)` — só ali o custo (o worker) justifica poupar; nada de
  `{ok:false, motivo:''}` inventado nem de `throw` (que misturaria
  cancelamento com uma falha de rede de verdade no mesmo `.catch`). Quem
  decide se o resultado conta é só `carregar`, com o `if (cancelled) return`
  que já precede o `setEstado` — o único freio contra um `setEstado` tardio
  de uma conta já trocada (prova: teste "acc-1 ainda em voo...", que fica
  vermelho por mutação se essa linha sair).
- **`ponytail:`** o `AbortSignal` só chega a `openSummaries` (o worker);
  `listPatients`, `obterConsentimentos` e `listarSessoesDaSemana` não o
  recebem — os fetches em voo terminam e são descartados. Upgrade natural é
  propagar o `signal` a eles quando o desperdício de rede virar o problema
  visível.
- **`ItemRequerVoce` nunca carrega o nome do paciente.** O nome só existe
  decifrado em `SummaryResult`; o render resolve por `patientId` a cada
  renderização — nenhum nome em claro é copiado para uma segunda estrutura.
- **`ResultadoFonte<T>` (local a `PainelProfissional.tsx`) em vez de lançar
  para o React.** `{ok:true,dados}|{ok:false,motivo}` isola a falha de uma
  fonte sem derrubar a árvore inteira (uma `ErrorBoundary` apanharia o throw
  de render, não uma promessa rejeitada, e desmontaria tudo). Fonte única: o
  estado `pronto` tem um só `pacientes: ResultadoFonte<{sumarios,
  consentimentos}>` — nascem e falham juntos.
- **`ponytail:`** `obterConsentimentos` por paciente é um fan-out N+1; o
  upgrade natural é um endpoint em lote quando a lista de pacientes ativos
  virar o gargalo visível.
- **Um `agora = new Date()` só, partilhado por `proximaSessao` e
  `contarPorComecar`.** Duas chamadas a `new Date()` no mesmo render podiam
  discordar numa fronteira de segundo entre o botão de ação e o KPI.

## Fora de âmbito

- Nenhuma listagem real de notas: `notas` chega por prop, hoje sempre `[]` a
  partir do router.
- Nada de mover/cancelar sessão, nada de "hoje" separado da semana além da
  contagem, nada de `KeychainProvider` — o painel monta sempre em "chaveiro
  bloqueado" em produção.
