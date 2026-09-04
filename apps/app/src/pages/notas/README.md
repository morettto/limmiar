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
2. **Efeito de arranque (S08-11):** no mount, `useEffect(..., [])` pergunta ao servidor
   (`obterAssinatura`, `entities/nota/api.ts`) se a nota fixture já está assinada. `ok:true`
   chama `marcarAssinada`, deixando `EditorSoap` em leitura apenas logo no primeiro render
   útil -- um reload é, portanto, um mount novo, e a trava não se perde. Critério "reload não
   perde a trava" tem prova executada, não por inferência: `NotaPage.test.tsx` ("reload
   (unmount + mount novo) repõe a trava vinda do servidor, sem interação do utilizador") monta,
   desmonta (`cleanup()` -- simula o reload, apaga toda memória do cliente) e monta de novo com
   `obterAssinatura` a devolver `ok:true` só na segunda vez; fixa que é a resposta do servidor,
   não estado do cliente, que repõe `estado === 'assinada'` na instância nova de `EditorSoap`.
   `ok:false` (404
   `notes.signature_not_found`, o caso normal de uma nota por assinar) e a promessa rejeitada
   (rede em baixo, 401 no arranque) colapsam no mesmo `if (r.ok)`: nenhum dos dois produz
   `role="alert"`/`role="status"` -- 404 não é acionável, e falha de rede/401 no boot também
   não. Sem flag de cancelamento: as três credenciais e o id são constantes de módulo (deps
   `[]` são honestas), `marcarAssinada` é idempotente, e `setState` depois do desmonte é
   no-op no React 19. **Fail-open**: se a pergunta falhar, a nota fica editável -- a trava a
   sério é a chave primária do Postgres, e um cliente desatualizado apanha o 409
   `notes.already_signed` que `aoAssinar` já trata (ver 2.e abaixo). Fail-closed trancaria
   toda nota de uma app local-first sempre que a rede caísse. `ponytail:` teto conhecido:
   offline, um reload não recupera a trava -- upgrade natural é cachear o último resultado
   conhecido localmente.
3. `⌘↵`/`Ctrl+↵` no editor (via `EditorSoap`/`FilaEEditor`, ver `ehAtalhoAssinar`) chama
   `aoAssinar(nota)`, que segue uma ordem fixa e não inversível:
   a. **Guarda de nota já assinada (S08-11), antes de qualquer outra guarda:** se
      `nota.estado === ESTADO_ASSINADA`, mostra `role="alert"` ("Esta nota já está
      assinada.") e retorna sem tocar em `openRecord`/`appendPatientEntry`/`assinarNota`.
      Existe porque, depois de a trava vir do servidor (item 2), `ultimaRevisaoGravadaRef`
      está vazio para essa nota -- sem esta guarda, um `⌘↵` gravaria uma entrada nova no
      prontuário append-only para uma nota já assinada, que é exatamente o defeito do
      ticket (a chave primária recusa a segunda linha, mas só depois de já ter gravado).
   b. Guarda de sessão: se `kek === null` (o que `NotaRouteComponent` sempre passa hoje, ver
      "Pontos de entrada"), mostra `role="alert"` com uma mensagem de estado permanente
      ("Sem sessão ativa. Não é possível assinar.") e retorna **sem** chamar `openRecord`
      nem nenhuma outra função de cripto/rede -- mesmo padrão estrutural do `dek === null`
      em `pages/biblioteca/BibliotecaPage.tsx`.
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

- `NotaPage({ kek }: NotaPageProps)` -- componente React puro. `kek: CryptoKey | null` é
  prop **obrigatória** (sem default) desde a ronda 1 de correção do S08-07 -- mesmo
  contrato de `pages/biblioteca/BibliotecaPage`'s `dek: CryptoKey | null`. Testes injetam
  uma `CryptoKey` real para exercitar o caminho pós-guarda.
- `NotaRouteComponent()` (`app/routing/router.tsx`) -- monta `<NotaPage kek={null} />` na
  rota `/notas`; é quem hoje decide o valor de `kek`, enquanto não existir
  `KeychainProvider`/sessão real (mesmo padrão de `BibliotecaRouteComponent`/`dek={null}`
  em `pages/biblioteca/README.md`). Ver "Decisões desta fatia (S08-07)" e "ronda 1 de
  correção" abaixo.

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
  useMemo(() => Object.values(notas), [notas])` (S08-18).** `Object.values` sobre um
  `Record` cria uma array nova a cada chamada, mesmo sem mudança de conteúdo; sem
  `useMemo`, `FilaEEditor` recebia uma array de identidade nova em toda renderização de
  `NotaPage` -- incluindo as que só mudam `mensagem` (ex.: a guarda de sessão em
  `aoAssinar`) e não tocam em `notas`. Garantia preventiva: hoje não há consumidor que
  dependa dessa identidade -- `FilaEEditor` não está memoizado, e não tem efeito nenhum que
  leve `notas` numa dependency array. `pages/biblioteca/BibliotecaPage` recebe `notas`
  como prop e, até o S08-13, levava-a na dependency array do efeito do índice -- o que
  tornava esse efeito sensível à estabilidade de identidade de quem lha passasse. O
  S08-13 tirou `notas` das deps (hoje `[chaveIndice, accountId]`) e passou a ler o valor
  atual via `useEffectEvent` (`lerAtuais`, ver `pages/biblioteca/README.md`): a exigência
  de identidade que existia ali deixou de existir -- quem ler este README não deve repô-la.
  `onChangeNota`, `aoTocar` e `aoAssinar` continuam a ser recriadas a cada render de
  `NotaPage`: só `notas` tem identidade estável, e quem memoizar `FilaEEditor` no futuro não
  pode assumir o mesmo das outras props. `NotaPage.test.tsx` prova por referência (`toBe`),
  não por igualdade estrutural, no teste "render que só muda mensagem (kek === null) não
  troca a referência de notas".
- **O `Record<string, Nota>` não virou `useState<Nota[]>`.** O `Record` dá atualização
  O(1) por id, decisão deliberada do S08-06; trocar a forma do estado só para obter uma
  identidade estável que o `useMemo` já dá numa linha seria mais diff pela mesma coisa, sem
  motivo novo para desfazer essa decisão.
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
- **`record`/`baseUrl`/`accountId`/`accessToken` continuam fixtures locais, não props.**
  Não existe ainda nenhum `KeychainProvider`/sessão real montada em lado nenhum da app
  (mesma situação, mesmo motivo, do `kek={null}, accountId=""` de
  `pages/settings/CopilotKeyPage.tsx`) -- inventar aqui uma forma de os receber via
  query string alargaria esta fatia para construir a wiring de sessão que nenhuma outra
  página tem, e que nenhuma spec pediu ainda. `ponytail:` o comentário no topo de
  `NotaPage.tsx` nomeia o teto (as chamadas de rede reais falham com estas credenciais) e
  o caminho de upgrade (substituir os quatro valores quando existir Keychain/sessão --
  a lógica de `aoAssinar` não muda). Consequência prática: contra o `wrangler dev` que o
  e2e sobe, `aoAssinar` cai sempre no caminho de "sem sessão" (antes: falha de rede) --
  `e2e/assinar-nota.spec.ts` prova o percurso de teclado até aí.
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

## Fora de âmbito

- Fila real (múltiplas notas/pacientes vindas de um backend) -- ver
  `widgets/soap-editor/README.md`.
- Sessão/Keychain real (substituir `record`/`baseUrl`/`accountId`/`accessToken` por props
  reais, e `router.tsx` a passar uma `kek` não-nula) -- ver as decisões acima.
- Mostrar quando/por quem a nota foi assinada continua fluxo futuro, ainda sem nenhuma tela
  -- o S08-11 usa `obterAssinatura` (`entities/nota/api.ts`, reposto neste ticket com
  chamador, ver `entities/nota/README.md`) só para decidir `estado`, sem exibir
  `signedAt`/`revision` em lado nenhum da UI.
- Fila real com efeito por nota selecionada -- o efeito de arranque hoje pergunta só pela
  nota fixture (`ponytail:` no topo do efeito em `NotaPage.tsx`); levantar
  `selecionadoId` de `FilaEEditor`, ou trazer o `estado` já resolvido pelo fetch da fila
  real, é o caminho de upgrade quando essa fila existir.
