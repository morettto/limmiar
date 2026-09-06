# pages/notas

## Responsabilidade

Monta a Tela P4.1 (spec S08-01) na rota `/notas` (`app/routing/router.tsx`, via
`NotaRouteComponent`): compõe `widgets/soap-editor/FilaEEditor` com uma fila e uma nota
em memória, e é o único lugar que sabe ligar `aoAssinar` à gravação real no prontuário e
à assinatura de facto (`entities/nota`, `entities/patient`). Deixou de ser "fina de mais
para ter README" na fatia 5, quando `aoAssinar` passou de mexer só em estado local para
gravar/assinar a sério -- ver o README de `widgets/soap-editor` para o histórico dessa
decisão.

## Fluxo principal

1. Monta com uma fila de um único item e uma nota fixa (`notaFixture()`), ambos com um id
   fixture (`NOTA_FIXTURE_ID`/`PATIENT_FIXTURE_ID`) -- não há ainda uma fila real vinda de
   um backend (fica fora de âmbito, ver `widgets/soap-editor/README.md`).
2. **Efeito de arranque (S08-11), guardado desde o S08-27:** no mount, `useEffect(...,
   [accountId, accessToken])` pergunta ao servidor (`obterAssinatura`, `entities/nota/api.ts`)
   se a nota fixture já está assinada -- mas só dispara se `accountId !== null` **e**
   `accessToken !== null`, guarda no mesmo idioma do `if (kek === null)` de `aoAssinar` (ver
   3.b abaixo). O ticket S08-27 corrigiu um defeito de raiz: antes desta guarda, o efeito
   disparava sempre, mesmo com `accountId`/`accessToken` vazios (constantes de módulo, não
   props), mandando `/accounts//notes/nota-fixture-1/signature` com `Authorization: Bearer `
   a cada mount de `/notas` -- um pedido sem caminho de sucesso possível, engolido por
   `.catch(() => {})`. Hoje `accountId`/`accessToken` são ambos props `string | null` (ver
   "Decisões desta fatia (S08-27)"), e `router.tsx` passa `accountId` real (sessão) com
   `accessToken={null}` (sem Keychain ainda) -- então a guarda continua a bloquear em
   produção, mas por uma prop `null`, não por uma constante impossível de testar. `ok:true`
   chama `marcarAssinada`, deixando `EditorSoap` em leitura apenas logo no primeiro render
   útil -- um reload é, portanto, um mount novo, e a trava não se perde. Critério "reload não
   perde a trava" tem prova executada, não por inferência: `NotaPage.test.tsx` ("reload
   (unmount + mount novo) repõe a trava vinda do servidor, sem interação do utilizador") monta,
   desmonta (`cleanup()` -- simula o reload, apaga toda memória do cliente) e monta de novo com
   `obterAssinatura` a devolver `ok:true` só na segunda vez; fixa que é a resposta do servidor,
   não estado do cliente, que repõe `estado === 'assinada'` na instância nova de `EditorSoap`.
   `ok:false` (404 `notes.signature_not_found`, o caso normal de uma nota por assinar) e a
   promessa rejeitada (rede em baixo, 401 no arranque) colapsam no mesmo `if (r.ok)`: nenhum
   dos dois produz `role="alert"`/`role="status"`. **Fail-open**: se a pergunta falhar, a nota
   fica editável -- a trava a sério é a chave primária do Postgres, e um cliente desatualizado
   apanha o 409 `notes.already_signed` que `aoAssinar` já trata (ver 3.f abaixo). A guarda em
   si (accountId/accessToken ausentes) tem prova própria, à parte: ver "Prova de zero pedidos
   de rede" em "Decisões desta fatia (S08-27)".
3. `⌘↵`/`Ctrl+↵` no editor (via `EditorSoap`/`FilaEEditor`, ver `ehAtalhoAssinar`) chama
   `aoAssinar(nota)`, que segue uma ordem fixa e não inversível:
   a. **Guarda de nota já assinada (S08-11), antes de qualquer outra guarda:** se
      `nota.estado === ESTADO_ASSINADA`, mostra `role="alert"` ("Esta nota já está
      assinada.") e retorna sem tocar em `openRecord`/`appendPatientEntry`/`assinarNota`.
      Existe porque, depois de a trava vir do servidor (item 2), `ultimaRevisaoGravadaRef`
      está vazio para essa nota -- sem esta guarda, um `⌘↵` gravaria uma entrada nova no
      prontuário append-only para uma nota já assinada, que é exatamente o defeito do
      ticket (a chave primária recusa a segunda linha, mas só depois de já ter gravado).
   b. Guarda de sessão (S08-27: `kek === null || accountId === null || accessToken === null`,
      era só `kek === null` até então) -- `kek`/`accessToken` são sempre `null` hoje (ver
      "Pontos de entrada"), então esta guarda continua a disparar sempre em produção,
      mostrando `role="alert"` com uma mensagem de estado permanente ("Sem sessão ativa. Não
      é possível assinar.") e retornando **sem** chamar `openRecord` nem nenhuma outra função
      de cripto/rede -- mesmo padrão estrutural do `dek === null` em
      `pages/biblioteca/BibliotecaPage.tsx`. Juntar as três condições (em vez de guardas
      separadas) mantém uma só mensagem para "sem sessão", e dá ao TypeScript a estreita de
      `accountId`/`accessToken` para `string` no resto da função -- as três credenciais
      precisam existir antes de qualquer chamada.
   c. `openRecord(kek, record, nota.patientId)` -- desembrulha a DEK do prontuário.
   d. Se a revisão desta nota ainda não foi gravada (`ultimaRevisaoGravadaRef`), sela
      (`sealEntry`) e grava (`appendPatientEntry`) uma entrada de prontuário com
      `notaParaEntrada(nota)`, **antes** de assinar.
   e. Sela a assinatura (`selarAssinatura`) e chama `assinarNota`.
   f. Marca **só o item com `nota.id`** (não a fila inteira) como assinado, e anuncia o
      desfecho, um de três: sucesso (`role="status"`, data da assinatura, marca assinada);
      409 `notes.already_signed` (`role="alert"`, mas marca assinada também -- o servidor é
      a verdade); ou qualquer outro `ProblemResult`/falha de rede (`role="alert"`, item
      continua pendente -- ver decisão abaixo).
   g. Foca de volta a listbox da fila, para o `j`/`k` seguinte continuar dali.
4. `onChangeNota`/`aoTocar` continuam simples repasses para estado local / o reprodutor
   real (`features/nota-audio`, fatia 3) -- nenhuma mudança nesta fatia.

## Pontos de entrada

- `NotaPage({ kek, accountId, accessToken }: NotaPageProps)` -- componente React puro. `kek:
  CryptoKey | null` é prop **obrigatória** (sem default) desde a ronda 1 de correção do
  S08-07 -- mesmo contrato de `pages/biblioteca/BibliotecaPage`'s `dek: CryptoKey | null`.
  `accountId: string | null` e `accessToken: string | null` são obrigatórias desde o S08-27,
  mesmo contrato do `accountId` de `BibliotecaPage`. Testes injetam uma
  `CryptoKey`/`accountId`/`accessToken` reais para exercitar os caminhos pós-guarda.
- `NotaRouteComponent()` (`app/routing/router.tsx`) -- monta `<NotaPage kek={null}
  accountId={sessao?.id ?? null} accessToken={null} />` na rota `/notas`; `accountId` vem de
  `useSession()` desde o S08-27 (mesmo padrão de
  `BibliotecaRouteComponent`/`CopilotKeyRouteComponent`, S18-01), `kek`/`accessToken`
  continuam `null` enquanto não existir `KeychainProvider`. Ver "Decisões desta fatia
  (S08-07)", "Decisões desta fatia (S08-27)" e "ronda 1 de correção" abaixo.

## Decisões desta fatia (atualizado no ticket S08-06)

- **`itens` (`ItemFila[]`) e `notas` (`Record<string, Nota>`) fundiram-se num único
  `useState<Record<string, Nota>>`, com `estado` a viver em `Nota`.** Eram duas
  coleções paralelas do mesmo `id`, mantidas em sincronia à mão por `marcarAssinada` (metade
  `itens`) e `onChangeNota` (metade `notas`) -- ver
  `[[S08-06 Fundir ItemFila em Nota e eliminar as listas paralelas]]` para o defeito
  completo. `notaFixture()` agora inclui `estado: ESTADO_PENDENTE`; `marcarAssinada(notaId)`
  atualiza só a `estado` da entrada certa dentro do `Record` (guarda: se `notaId` não é uma
  chave existente, não cria uma entrada nova) -- `onChangeNota` já mexia no mesmo `Record`,
  sem alteração. `<FilaEEditor>` passa a receber `notas` numa prop só, em vez de
  `itens`+`notas` separados.
- **`notas={Object.values(notas)}` virou `notas={listaNotas}`, com `listaNotas =
  useMemo(() => Object.values(notas), [notas])` (S08-18) -- e voltou a
  `notas={Object.values(notas)}` direto, sem `useMemo` (ticket S08-25).** O `useMemo` do
  S08-18 era garantia preventiva, por escrito: "hoje não há consumidor que dependa dessa
  identidade". O consumidor que a teria justificado era o `useEffect` do índice em
  `pages/biblioteca/BibliotecaPage` -- mas esse efeito é de outra página (`notas` próprias,
  não as desta), nunca leu esta identidade, e o S08-25 corrigiu justamente esse efeito para
  depender de `impressao` (`impressaoDigital(notas)`, uma string), não da identidade da
  array -- ver `pages/biblioteca/README.md`, "O `useEffect` que restaura/constrói/persiste
  o índice". Sem consumidor real em lado nenhum, o `useMemo` ficou puro custo: apagado, e
  `Object.values(notas)` volta a correr direto no JSX. `FilaEEditor` continua a receber uma
  array de identidade nova em toda renderização de `NotaPage` (incluindo as que só mudam
  `mensagem`) -- sem `FilaEEditor` memoizado nem efeito que leve `notas` numa dependency
  array, essa identidade nova não move nada.
- **O `Record<string, Nota>` não virou `useState<Nota[]>`.** O `Record` dá atualização
  O(1) por id, decisão deliberada do S08-06 -- sem motivo novo para desfazer essa decisão.
- **A lógica de `aoAssinar` (ordem, guardas, mensagens) não mudou.** Só a forma de
  `marcarAssinada` por dentro mudou (map sobre array → update de chave num `Record`); os
  três ramos de desfecho (sucesso, 409, falha de rede) continuam exatamente como estavam.

## Decisões desta fatia (S08-07)

- **O fixture do `kek` deixou de ser `{} as CryptoKey` (um cast que fazia um objeto vazio
  passar por chave) e passou a `null` honesto, tipado `CryptoKey | null`.** O defeito:
  `openRecord({} as CryptoKey, ...)` lançava `TypeError` contra um `openRecord` real, e o
  `catch` genérico mostrava "Falha ao assinar a nota. Tente novamente." -- uma mentira,
  porque não é falha transitória, é ausência de sessão, permanente até existir
  `KeychainProvider`. Agora `aoAssinar` guarda cedo sobre `kek === null` e mostra
  "Sem sessão ativa. Não é possível assinar." em `role="alert"`, **antes** de qualquer
  chamada a `openRecord`/`sealAssinatura` -- mesma forma estrutural do `dek === null` em
  `pages/biblioteca/BibliotecaPage.tsx`.
- **`kek` virou prop de `NotaPage` (na altura, opcional com default `= null`), não ficou
  só o valor do fixture trocado por dentro.** A primeira tentativa, mais estreita (só o
  tipo/valor do fixture + a guarda, sem prop), foi uma preferência de execução -- do
  orquestrador ao despachar o ticket (decisão de âmbito), não uma cláusula do ticket
  S08-07: nenhum dos seus três critérios de aceite menciona prop vs. constante. Essa
  tentativa esbarrou num problema técnico: um `const` de módulo fixo em `null`, sem seam
  nenhum para o substituir, faz a guarda interceptar **toda** chamada a `aoAssinar`,
  incluindo dentro dos testes (`vi.mock` dos módulos de cripto/api não alcança um `const`
  interno do próprio ficheiro sob teste). Isso tornava o resto de `aoAssinar`
  (`openRecord` → `sealEntry` → `appendPatientEntry` → `assinarNota`, os três desfechos)
  permanentemente morto e sem cobertura -- quebrando 5 dos 7 testes da fatia 5 e violando o
  piso de 100% de branch do portão de cobertura. Essa necessidade técnica (seam de teste
  inexistente + piso de cobertura) justificou a prop opcional na altura. A ronda 1 de
  correção abaixo tornou `kek` **obrigatória**, alinhando com o critério de aceite 2 do
  ticket (`kek: CryptoKey | null`).
- **`record`/`baseUrl`/`accountId`/`accessToken` continuavam fixtures locais, não props --
  corrigido para `accountId`/`accessToken` no S08-27, `record`/`baseUrl` continuam fixture,
  ver "Decisões desta fatia (S08-27)" abaixo.** Na altura (S08-07), não existia ainda nenhum
  `KeychainProvider`/sessão real montada em lado nenhum da app (mesma situação do
  `kek={null}, accountId=""` de `pages/settings/CopilotKeyPage.tsx`) -- inventar aqui uma
  forma de os receber via query string teria alargado a fatia para construir a wiring de
  sessão que nenhuma outra página tinha, e que nenhuma spec pedia ainda. Consequência prática
  à data: contra o `wrangler dev` que o e2e sobe, `aoAssinar` caía sempre no caminho de "sem
  sessão" (antes: falha de rede) -- `e2e/assinar-nota.spec.ts` prova o percurso de teclado até
  aí, e continua a provar hoje pela mesma guarda, agora também por falta de
  `accountId`/`accessToken`.
- **`marcarAssinada` atualiza só a entrada de `notaId`** (desde S08-06, dentro do `Record`
  de `notas` -- ver a decisão no topo deste README; antes da fusão, era um `.map` sobre o
  array `itens`), pagando a dívida `ponytail:` da fatia 3 (que marcava a fila inteira, e só
  funcionava porque a fixture tinha um único item). Com um único item ainda hoje, o ramo
  "outra nota passa incólume" só é exercitável chamando `aoAssinar` com uma nota de id
  diferente da existente -- é exatamente o que `NotaPage.test.tsx` faz para manter 100% de
  branch sem inventar uma segunda fila.
- **Ordem que não inverte: grava no prontuário antes de assinar.** Falhar a assinatura
  depois de gravar deixa uma revisão por assinar no prontuário -- recuperável, um novo
  `⌘↵` assina a mesma revisão de novo. O inverso (assinar antes de gravar) deixaria, numa
  falha entre as duas chamadas, uma assinatura a apontar para uma revisão que não existe
  em lado nenhum do prontuário -- essa linha não se pode apagar depois.
- **`ultimaRevisaoGravadaRef` evita repetir `appendPatientEntry` da mesma revisão.** Sem
  esta guarda, um segundo `⌘↵` depois de uma falha de rede na assinatura (não na
  gravação) gravaria a mesma revisão duas vezes no prontuário.
- **`appendPatientEntry` não-ok interrompe antes de assinar (ronda 1 de correção).**
  `aoAssinar` verifica `gravado.ok` logo depois de gravar: se for um `ProblemResult` (ex.:
  `patients.entry_sequence_conflict` por escrita concorrente ao mesmo prontuário), mostra
  `translateProblemCode(gravado.code, gravado.params, i18n)` em `role="alert"` e retorna --
  **sem** avançar `proximaSequenciaRef`/`ultimaRevisaoGravadaRef` e **sem** chegar a
  `selarAssinatura`/`assinarNota`/`marcarAssinada`. Antes desta correção o `Result` era
  descartado (`await appendPatientEntry(...)` sem checar `.ok`), e um conflito seguia o
  mesmo caminho de um sucesso até `marcarAssinada` -- partindo o invariante "grava antes de
  assinar" que a decisão acima declara.
- **O resultado de `assinarNota` != `ok` tem três desfechos, não dois (ronda 2 de
  correção, S08-03).** `marcarAssinada` só corre se `resultado.ok` for verdadeiro, ou se
  `resultado.code === 'notes.already_signed'` -- essa é a única exceção, porque aí o
  servidor é a verdade: a nota já estava assinada antes desta chamada, então marcar
  "assinada" no cliente só está a alinhar com um facto que já existe no backend. Qualquer
  outro `ProblemResult` (ex.: `auth.access_token_invalid`, token a expirar entre gravar e
  assinar) cai no terceiro ramo: `translateProblemCode(resultado.code, resultado.params,
  i18n)` em `role="alert"`, **sem** marcar assinada -- porque, ao contrário do 409, aqui o
  servidor não guardou assinatura nenhuma, e marcar assinada mandaria a nota para
  "Assinadas" sem existir um único byte de assinatura do outro lado, sem caminho de volta
  para "Pendentes". Um `catch` genérico continua a cobrir só falha de rede/exceção lançada
  antes de `assinarNota` devolver um `Result` (mesmo teto de sempre: só um escritor por
  nota nesta fatia).
- **Foco de volta à listbox via `document.querySelector('[role="listbox"]')`, não
  `forwardRef`.** É a única instância desse role na página; encadear `forwardRef` por
  `FilaEEditor` → `FilaAssinatura` só para devolver o foco seria mais código para o mesmo
  resultado.

## Correções da cadeia de review (S08-07, ronda 1)

- **`kek` passou de opcional (default `= null`) a obrigatória: `kek: CryptoKey | null`,
  sem `?`.** Alinha com o critério de aceite 2 do ticket, e com o mesmo padrão já usado por
  `pages/biblioteca/BibliotecaPage`'s `dek: CryptoKey | null`. Quem decide o valor deixou
  de ser `NotaPage` (via default) e passou a ser o call site: `router.tsx` cria
  `NotaRouteComponent`, que monta `<NotaPage kek={null} />` -- mesmo padrão de
  `BibliotecaRouteComponent`/`dek={null}` (ver `pages/biblioteca/README.md`). A rota
  `/notas` usa `component: NotaRouteComponent` em vez de `component: NotaPage`
  diretamente. Comportamento de produção inalterado: `/notas` continua a mostrar "Sem
  sessão ativa..." pelo mesmo caminho de guarda, só que agora `kek={null}` chega por um
  argumento explícito do call site em vez de um default escondido dentro de `NotaPage`.
- **`KEK_FIXTURE` foi removida** -- só existia para ser o default do prop opcional; sem
  prop opcional, não tem mais chamador.
- **Correção de atribuição:** a frase "o ticket previa a válvula de escape" que descrevia
  a decisão acima em `.harness/diff/S08-07.md` não vinha do ticket -- era uma instrução do
  orquestrador no prompt de despacho do implementador dessa fatia, não texto do ficheiro do
  ticket. O ticket S08-07 só tinha os três critérios de aceite. A bullet acima manteve, na
  altura, uma variante do mesmo engano ("o ticket S08-07 pedia a solução mais estreita...")
  -- só corrigida na ronda 2 ([[S08-19 README de pages-notas atribui ao ticket S08-07 uma
  preferência que ele não formula]]): a preferência pela solução mais estreita era do
  orquestrador, ao despachar o ticket (decisão de âmbito), não do ticket em si.

## Decisões desta fatia (S08-27)

Origem: achado 3.1 do `reviewer-thermo`, ronda 2 da cadeia de review da spec S08 --
`/notas` era a única das três rotas de produto (`/settings/copilot`, `/biblioteca`, `/notas`)
que tinha ficado de fora da ligação a `useSession()` que o S18-01 fez para as outras duas, e
o mount de `NotaPage` disparava `obterAssinatura` sempre, com `accountId`/`accessToken` vazios.

- **`accountId` deixou de ser fixture e passou a prop `string | null`, ligada em
  `NotaRouteComponent` via `useSession()` (mesmo padrão de `BibliotecaRouteComponent`/
  `CopilotKeyRouteComponent`, S18-01).** Fecha a assimetria: as três rotas de produto usam
  hoje o mesmo padrão para `accountId`. `ACCOUNT_ID_FIXTURE` foi apagada de `NotaPage.tsx` --
  não sobrou nenhuma sentinela `accountId=""` em lado nenhum (ver nota abaixo sobre
  `key-store.ts`).
- **`accessToken` também deixou de ser fixture (`ACCESS_TOKEN_FIXTURE`, uma constante `''`) e
  passou a prop `string | null`, exatamente como `kek`.** Motivo estrutural: uma constante de
  módulo comparada consigo mesma (`ACCESS_TOKEN_FIXTURE === ''`) é sempre verdadeira, então o
  corpo do efeito de mount (`obterAssinatura(...).then(...)`) ficava **código morto**,
  incobrível por qualquer teste. `router.tsx` monta com `accessToken={null}` -- mesmo padrão,
  mesmo motivo do `kek={null}` que já lá estava: sem
  `KeychainProvider`, não há token real para passar. Isto também fecha uma segunda
  assimetria que sobrou da primeira ronda desta fatia: `kek` já era prop `null` e
  `accessToken` era constante fixture -- duas formas de dizer "sem Keychain ainda". **O que
  falta para deixar de ser `null` de verdade:** um provider que guarde o `accessToken` da
  sessão viva (e o renove, já que expira -- ver o ramo `auth.access_token_invalid` em
  `aoAssinar`, item 3.f) e passe um valor real em `NotaRouteComponent`, no lugar de `null` --
  a lógica de `NotaPage` não muda nada, só a origem do valor (mesmo caminho de upgrade do
  `kek`).
- **`BASE_URL_FIXTURE` continua constante, não virou prop.** Ao contrário de `accessToken`,
  `baseUrl` nunca entra em nenhuma condição -- não há `if (baseUrl === ...)` em lado nenhum,
  então não sofre do problema de "constante comparada consigo mesma vira código morto" que
  motivou a mudança de `accessToken`. Promovê-lo a prop aqui seria simetria cega (o próprio
  ticket pediu para não arrastar por simetria): mais uma prop, mais um argumento em
  `NotaRouteComponent`, sem nenhum ramo novo a cobrir e sem nenhum defeito a fechar. Upgrade
  natural no mesmo diff que ligar `accessToken` de verdade, quando/se a app tiver mais de uma
  `baseUrl` (hoje só há uma, a do `wrangler dev`/produção).
- **Nenhum `accountId`/`accessToken` colapsou para `''`.** O S18-04 trocou `accountId=""` por
  `string | null` nas outras páginas de produto justamente para não reintroduzir a sentinela
  que `key-store.ts` rejeita (`key-store: accountId must not be empty`); esta fatia manteve
  `string | null` de ponta a ponta nas duas props, sem nenhum `?? ''` a colapsar o tipo.
- **A guarda do mount ganhou `[accountId, accessToken]` como dependência** (era `[]`) --
  honesto agora que ambas são props que podem mudar (troca de conta, Keychain a ligar),
  não mais constantes de módulo.
- **Prova de zero pedidos de rede (critério de aceite 1):** `NotaPage.test.tsx` tem dois
  testes -- um com `accountId === null` que espia `fetch` de verdade (religando
  `entities/nota/api` real via `vi.importActual`, porque o módulo vem mockado no resto do
  ficheiro) e prova zero chamadas; outro com `accountId` real e `accessToken === null` que
  prova que `obterAssinatura` (a função mockada) nunca é invocada. Com `accessToken` agora
  prop (não constante), o describe block "mount pergunta ao servidor se a nota já está
  assinada" (S08-11, 4 testes) voltou a ser alcançável, montando com `accountId`/`accessToken`
  reais -- restaurado com as mesmas asserções de sempre, só a chamada a `obterAssinatura`
  passou a incluir os valores de teste em vez de `''`.
- **Dois testes novos, sem relação com a guarda, fecham 100% em `NotaPage.test.tsx` isolado:**
  `onChangeNota` e o ramo real de `aoTocar` (`audioRef.current` não-nulo) só tinham prova em
  `router.test.tsx`, nunca neste ficheiro -- inofensivo enquanto a etapa 6 media cobertura
  pela suíte inteira, mas o comando de verificação por ficheiro
  (`vitest run --coverage src/pages/notas/NotaPage.test.tsx`) não os alcançava sozinho.
  Réplicas mínimas do que `router.test.tsx` já prova, sem mexer nesse ficheiro.

## Fora de âmbito

- Fila real (múltiplas notas/pacientes vindas de um backend) -- ver
  `widgets/soap-editor/README.md`.
- Keychain real (um valor não-nulo de verdade para `kek`/`accessToken` em `router.tsx`) --
  `accountId` e o mecanismo de `accessToken` (prop vs. constante) já saíram desta lista no
  S08-27; falta só o provider que produza os valores reais, ver as decisões acima.
- Mostrar quando/por quem a nota foi assinada continua fluxo futuro, ainda sem nenhuma tela
  -- o S08-11 usa `obterAssinatura` (`entities/nota/api.ts`, reposto neste ticket com
  chamador, ver `entities/nota/README.md`) só para decidir `estado`, sem exibir
  `signedAt`/`revision` em lado nenhum da UI.
- Fila real com efeito por nota selecionada -- o efeito de arranque hoje pergunta só pela
  nota fixture (`ponytail:` no topo do efeito em `NotaPage.tsx`); levantar
  `selecionadoId` de `FilaEEditor`, ou trazer o `estado` já resolvido pelo fetch da fila
  real, é o caminho de upgrade quando essa fila existir.
