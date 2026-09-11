# widgets/painel-profissional

## Responsabilidade

Painel inicial do profissional: a ação principal ("iniciar próxima sessão"),
dois KPIs e a fila "Requer você". É o único ponto do app que junta paciente
(`entities/patient`), consentimento (`entities/consentimento`), nota
(`entities/nota`) e agenda (`entities/agenda`) — nenhuma dessas entidades
sabe da outra; a composição e o isolamento de falha por fonte vivem só aqui.

## Fluxo principal

1. O render decide "bloqueado" direto da prop: `chaveiro === null` → mostra
   "Chaveiro bloqueado..." (`role="status"`), sem tocar no `useEffect` nem no
   estado interno. Nenhum pedido sai. `chaveiro: { kek, accountId, accessToken
   } | null` é uma única prop — não há como só uma das três partes faltar, a
   narrowing `!== null` do TypeScript basta, sem guarda própria.
2. Chaveiro destrancado: o `useEffect` carrega duas fontes em paralelo via
   `Promise.all`: `carregarPacientes` (`listPatients` → `openSummaries`, Web
   Worker, default `openSummariesInWorker`, injetável por prop para teste, →
   `obterConsentimentos` por paciente) e `carregarSessoes` (`listarSessoes`
   com a janela `[agora, agora + 7 dias)` montada aqui, `SETE_DIAS_MS`
   privada ao widget). Cada uma tem o seu próprio `.catch` que absorve
   qualquer rejeição e a converte no mesmo `ResultadoFonte<T>` que um
   `ProblemResult` já produz — nenhuma das duas rejeita para o `Promise.all`,
   senão a falha de uma derrubaria a outra. O efeito depende só de
   `chaveiro?.kek`, `chaveiro?.accountId`, `baseUrl`, `openSummaries` — nem
   `accessToken` nem `i18n`/`t` entram nas deps, ver "Decisões".
3. Com os pacientes resolvidos, um `obterConsentimentos` por paciente em
   paralelo (`Promise.all`, cada chamada com `.catch(() => null)`); o
   paciente cujo pedido falhar (resolvido `{ok:false}` ou rejeitado) cai da
   lista de consentimentos, os outros continuam de pé.
4. O cleanup do efeito (dispara ao trocar de conta, trancar o chaveiro ou
   desmontar) marca `cancelled`, aborta o `AbortController` e repõe
   `{status:'a-carregar'}` — a próxima conta nunca herda os dados "pronto" da
   anterior.
5. Render, chaveiro destrancado: `proximaSessao(sessoes.dados, new Date())`
   (só quando `sessoes.ok`, senão `null`) decide a sessão da ação principal;
   o nome vem do sumário decifrado casado por `patientId` — nunca o
   `patientId` cru quando o sumário falta ou não decifrou. `juntarRequerVoce`
   agrega risco+assinatura+consentimento sem duplicar nem perder item;
   exatamente dois `KpiStrip.Item` — nenhuma métrica de vaidade. Se
   `listPatients` falhar, KPI "Pacientes ativos" mostra "—" e um
   `role="alert"` (texto de `traduzirFalha`, ver "Decisões") aparece; se
   `listarSessoes` falhar, KPI "Sessões na semana" mostra "—" e um segundo
   `role="alert"`, irmão do primeiro.

## Pontos de entrada

- `PainelProfissional` (`PainelProfissional.tsx`) — componente React. Props:
  `baseUrl`, `chaveiro: { kek: CryptoKey; accountId: string; accessToken:
  string } | null`, `notas: readonly Nota[]`, `openSummaries?` (seam de
  teste).
- `itensDeRisco`, `itensDeAssinatura`, `itensDeConsentimento`,
  `juntarRequerVoce`, `ConsentimentosPorPaciente` (`requer-voce.ts`) — puros,
  testados isoladamente do React em `requer-voce.test.ts`.
- Consumido por `pages/home/HomePage.tsx`, que repassa a prop `chaveiro` sem
  transformação; montada por `IndexRouteComponent` (`app/routing/router.tsx`),
  que monta o `chaveiro` (sempre `null` em produção enquanto não existir
  `KeychainProvider`) e passa `notas=[]` (sem o `GET` de nota ainda).

## Decisões desta fatia

- **`EstadoPainel` só tem `'a-carregar' | 'pronto'`.** "Bloqueado" nunca foi
  um estado assíncrono — é uma função pura das props, decidida no render.
  Guardar no estado obrigava um `estadoInicial` exportado só para os testes e
  duplicava a mesma guarda no `useEffect`.
- **O cleanup do efeito é o único lugar que repõe `'a-carregar'`.** Antes o
  reset acontecia solto no início do corpo do efeito; centralizá-lo no
  cleanup garante que ele corre em toda troca de deps (conta, kek) e no
  unmount, sem depender de alguém lembrar de repetir a linha.
- **`openSummaries` é sempre chamado, mesmo depois de cancelar — quem barra é
  o `signal.aborted` do próprio `worker-client.ts`.** `carregarPacientes` faz
  só `await openSummaries(kek, items, abortController.signal)`; se o efeito
  já tiver sido cancelado o `signal` chega abortado, e é
  `openSummariesInWorker` quem rejeita sem nunca criar o `Worker` (ver
  `entities/patient/README.md`/`worker-client.test.ts`). Nem `{ok:false,
  motivo:''}` fabricado nem `throw` aqui — quem decide se o resultado conta é
  só `carregar`, com o `if (cancelled) return` que já precede o `setEstado` —
  o único freio contra um `setEstado` tardio de uma conta já trocada (prova:
  teste "acc-1 ainda em voo...", que fica vermelho por mutação se essa linha
  sair).
- **`ponytail:`** o `AbortSignal` só chega a `openSummaries` (o worker);
  `listPatients`, `obterConsentimentos` e `listarSessoes` não o recebem — os
  fetches em voo terminam e são descartados. Upgrade natural é propagar o
  `signal` a eles quando o desperdício de rede virar o problema visível.
- **A falha de uma fonte fica crua no estado (`ProblemResult` ou `null` para
  "sem código"); só o render traduz, via `traduzirFalha`.** `i18n`/`t` saem
  das deps do efeito — traduzir lá dentro capturava a data do pedido, não a
  do render; trocar de idioma depois de já ter falhado agora atualiza o texto
  do alert sem recarregar nada.
- **`accessToken` também sai das deps — lido de novo a cada pedido, via
  `chaveiroRef` (`useRef` atualizado em todo render).** Só `kek`/`accountId`
  mudam a identidade de "que conta carregar"; renovar o token não é motivo
  para voltar a "Carregando painel..." nem redecifrar. O valor capturado no
  início do efeito (`tokenAoEntrar`) é só o *fallback* de `tokenAtual()` para
  quando um pedido em voo sobrevive a um cleanup que já zerou o `chaveiro`
  (trancado ou trocado) — sem ele `tokenAtual()` quebraria nesse instante.
- **`ItemRequerVoce` nunca carrega o nome do paciente.** O nome só existe
  decifrado em `SummaryResult`; o render resolve por `patientId` a cada
  renderização — nenhum nome em claro é copiado para uma segunda estrutura.
- **`ResultadoFonte<T>` (local a `PainelProfissional.tsx`) em vez de lançar
  para o React.** `{ok:true,dados}|{ok:false,falha}` isola a falha de uma
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
