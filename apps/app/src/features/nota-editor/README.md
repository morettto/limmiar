# features/nota-editor

## Responsabilidade

Editor SOAP da Tela P4.1 (spec S08, fatias 2 e 3 de 5): as quatro secções (Subjetivo,
Objetivo, Avaliação, Plano) de uma `Nota` (domínio de `entities/nota`), frases editáveis,
uma citação por âncora temporal que toca o áudio ao passar o rato ou ganhar foco pelo
teclado, e o atalho de teclado para assinar. Totalmente controlado pelo chamador
(`nota`/`onChange`/`aoTocar` por prop) -- este módulo não guarda a nota em estado próprio,
nem chama backend, nem sabe de onde vem o áudio (isso é `features/nota-audio`, ligado
pelo chamador -- hoje `pages/notas/NotaPage.tsx`).

## Fluxo principal

1. `EditorSoap` recebe `nota` (a nota inteira, controlada pelo chamador),
   `onChange(nota)`, `aoTocar(ancora)` e `aoAssinar(nota)`.
2. Renderiza as secções na ordem `ORDEM_SECOES` (`S`, `O`, `A`, `P`, importada de
   `entities/nota/nota.ts` -- ver Decisões). Dentro de cada secção, um `<textarea>` por
   frase (`aria-label` único, `"${rótulo da secção} ${posição}"`, já que várias frases da
   mesma secção partilhariam o mesmo rótulo sem a posição).
3. Editar um `<textarea>` chama `editarFrase(nota, frase.id, novoTexto)` (função pura de
   `entities/nota/nota.ts`, já testada a 100% na fatia 1) e propaga o resultado via
   `onChange` -- a nota nova (com `revisao` incrementada) só existe de facto se o chamador
   a guardar em algum estado.
4. Cada `<textarea>` recebe `readOnly={nota.estado === ESTADO_ASSINADA}` (S08-11) -- nenhuma
   prop nova, `Nota` já é dona do `estado` desde o S08-06. Ver Decisões, "Leitura apenas
   depois de assinada".
5. Cada âncora de cada frase vira uma `Citacao` (`aoTocar` passado direto). Frase sem
   âncoras não mostra nenhuma. `Citacao` (fatia 3) chama `aoTocar(ancora)` em três
   gatilhos: `onClick`, `onMouseEnter` (critério de aceite -- "ao passar o rato") e
   `onFocus` (o mesmo instante tem de tocar para quem navega por `Tab`, já que hover é
   um caminho só de mouse).
6. Um `onKeyDown` no container raiz do editor chama `ehAtalhoAssinar` (seam de
   `./atalho-assinar.ts` -- ver Decisões, "aceita `⌘` OU `Ctrl`"); se verdadeiro, chama
   `aoAssinar(nota)` com a nota **atual** (a mesma que está a ser editada, não uma cópia
   obsoleta) e previne o comportamento nativo da tecla.

## Pontos de entrada

- `EditorSoap` (`EditorSoap.tsx`) -- componente React, props `nota`, `onChange`, `aoTocar`,
  `aoAssinar`.
- `Citacao` (`Citacao.tsx`) -- componente React, props `ancora` (`{ inicioMs, fimMs }` de
  `@limmiar/copilot`), `aoTocar`. Mostra `mm:ss–mm:ss` e chama `aoTocar(ancora)` ao
  clicar, passar o rato (`onMouseEnter`) ou ganhar foco (`onFocus`).
- `ehAtalhoAssinar(e)` (`atalho-assinar.ts`, desde S08-08) -- seam puro, sem React, sem
  browser, 100% interno a esta feature. Viveu em `features/nota-fila/navegacao-teclado.ts`
  até essa fatia; moveu porque a regra de isolamento de slices (`.dependency-cruiser.cjs`,
  `fsd-no-cross-slice`) deixou de permitir uma feature a importar diretamente de outra do
  mesmo nível -- as únicas exceções de composição aceites são pares exatos
  (`recovery`→`totp-challenge`/`totp-enrollment`, `device-pairing-new`→`qr-scan`), e
  nenhuma delas cobria `nota-editor`→`nota-fila`.
- Consumido por `widgets/soap-editor/FilaEEditor.tsx`.

## Decisões desta fatia

- **`ehAtalhoAssinar` aceita `metaKey` OU `ctrlKey`, sem detetar o sistema operativo (mudou
  de casa para aqui em S08-08, texto original de `features/nota-fila`).** A spec S08 escreve
  o atalho como `⌘↵` (Mac), mas a assinatura do seam (`Pick<KeyboardEvent, 'key' | 'metaKey'
  | 'ctrlKey'>`) não carrega nenhuma informação de plataforma de propósito: detetar o SO
  exigiria ler `navigator.platform`/`userAgent` (não fiável, e o próprio seam deixaria de
  ser uma função pura testável só com um objeto literal). Em vez disso, `Enter` com
  **qualquer um** dos dois modificadores conta -- `⌘↵` funciona no Mac, `Ctrl+↵` funciona
  fora dele, e nenhum profissional fica sem atalho de teclado por causa do sistema
  operativo que usa. Efeito colateral aceite: `Ctrl+Enter` também funciona num Mac
  (inofensivo) e `Cmd+Enter` "funcionaria" num Windows/Linux se esse teclado tivesse uma
  tecla Meta (na prática, nunca acontece por acidente).
- **Leitura apenas depois de assinada (S08-11): `readOnly`, não `disabled`.** Cada
  `<textarea>` recebe `readOnly={nota.estado === ESTADO_ASSINADA}` (constante importada de
  `entities/nota/nota.ts`, dona do `estado`). `disabled` tiraria o campo da ordem de
  tabulação e do leitor de ecrã -- uma nota assinada continua algo que se lê e se navega,
  só não se edita. O estilo (`read-only:bg-neutral-100`) sai do variante nativo `read-only:`
  do Tailwind 4, já instalado -- sem classe condicional em JS. Nenhuma guarda em `onChange`:
  com `readOnly` o browser nunca emite `input`, uma guarda em JS seria um ramo inalcançável
  (e sem cobertura possível). **O atalho `⌘↵`/`Ctrl+↵` não é travado aqui** -- `aoTeclar`
  continua a chamar `aoAssinar(nota)` mesmo com a nota assinada; a guarda vive em
  `pages/notas/NotaPage.tsx` (`aoAssinar`, funil único de assinatura -- `FilaAssinatura` não
  chama `aoAssinar` diretamente), porque é aí que se decide o que fazer com uma tentativa de
  assinar de novo (mensagem de erro), não neste componente controlado que só repassa a nota
  atual.
- **`aoTocar` já é real (fatia 3): `criarReprodutor`/`abrirSessaoComoBlob` de
  `features/nota-audio`, ligado pelo chamador.** Este módulo continua sem saber de onde
  vem o áudio -- só garante que o gatilho certo (clique, hover, foco) chama `aoTocar` com
  a âncora certa.
- **`aoAssinar` recebe a nota atual (`(nota: Nota) => void`), não é chamado sem argumento.**
  A spec desenha o atalho como `aoAssinar()`, mas quem for assinar de facto (fatia 4)
  precisa da nota **como está no momento do atalho** (com todas as edições já feitas) --
  não teria sentido o chamador ter de guardar a última nota emitida por `onChange` só para
  reconstruir o que este componente já tem à mão. Passar `nota` custa nada a mais e poupa
  esse acoplamento futuro.
- **`ORDEM_SECOES` vem de `entities/nota/nota.ts`, não é redeclarada aqui.** Justificação
  completa (por que `.tsx` não pode declarar o literal, e por que reexportar em vez de
  duplicar) no README de `entities/nota` (dono do símbolo).
- **jsdom, não Playwright Component Testing, para provar `⌘↵`/`Ctrl+↵` → `aoAssinar`.** O
  cabo testado aqui é wiring de handler puro -- "o componente chama a função certa quando a
  tecla e o modificador certos disparam" -- e o `KeyboardEvent` sintético do jsdom
  (`fireEvent.keyDown(elemento, { key: 'Enter', metaKey: true })`) reproduz `metaKey`/
  `ctrlKey` com fidelidade real; o `onKeyDown` do React processa-o como processaria num
  browser de verdade. Nada aqui depende de comportamento só-de-Chromium (IME, foco
  renderizado por GPU, `preventDefault` nativo do SO) que só um teste do Playwright CT
  provaria com mais honestidade -- esse harness, neste repo, é reservado para regressão
  visual + `axe` (ver `TotpSetup.spec.tsx`), não para wiring de evento. Ver
  `EditorSoap.test.tsx`.

## Fora de âmbito (fatias seguintes da spec S08)

- Assinatura de facto, persistência da nota editada -- fatia 5 (feita). `onChange`/
  `aoAssinar` continuam a só devolver/repassar a nota; quem grava no prontuário e assina de
  facto é o chamador (`pages/notas/NotaPage.tsx`, ver o seu README) -- este módulo continua
  sem saber de rede, crypto ou persistência, só de que `aoAssinar(nota)` é a nota como está
  no momento do atalho.
- Carregar o áudio real de uma sessão (`dir`/`dek`/`sessionId` vindos de um backend) --
  continua fora de âmbito, ver README de `features/nota-audio`.
