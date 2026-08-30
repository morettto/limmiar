# pages/notas

## Responsabilidade

Monta a Tela P4.1 (spec S08-01) na rota `/notas` (`app/routing/router.tsx`): compõe
`widgets/soap-editor/FilaEEditor` com uma fila e uma nota em memória, e é o único lugar
que sabe ligar `aoAssinar` à gravação real no prontuário e à assinatura de facto
(`entities/nota`, `entities/patient`). Deixou de ser "fina de mais para ter README" na
fatia 5, quando `aoAssinar` passou de mexer só em estado local para gravar/assinar a
sério -- ver o README de `widgets/soap-editor` para o histórico dessa decisão.

## Fluxo principal

1. Monta com uma fila de um único item e uma nota fixa (`notaFixture()`), ambos com um id
   fixture (`NOTA_FIXTURE_ID`/`PATIENT_FIXTURE_ID`) -- não há ainda uma fila real vinda de
   um backend (fica fora de âmbito, ver `widgets/soap-editor/README.md`).
2. `⌘↵`/`Ctrl+↵` no editor (via `EditorSoap`/`FilaEEditor`, ver `ehAtalhoAssinar`) chama
   `aoAssinar(nota)`, que segue uma ordem fixa e não inversível:
   a. `openRecord(kek, record, nota.patientId)` -- desembrulha a DEK do prontuário.
   b. Se a revisão desta nota ainda não foi gravada (`ultimaRevisaoGravadaRef`), sela
      (`sealEntry`) e grava (`appendPatientEntry`) uma entrada de prontuário com
      `notaParaEntrada(nota)`, **antes** de assinar.
   c. Sela a assinatura (`selarAssinatura`) e chama `assinarNota`.
   d. Marca **só o item com `nota.id`** (não a fila inteira) como assinado, e anuncia o
      desfecho: sucesso (`role="status"`, data da assinatura), 409 `notes.already_signed`
      (`role="alert"`, mas marca assinada também -- o servidor é a verdade), ou falha de
      rede (`role="alert"`, item continua pendente).
   e. Foca de volta a listbox da fila, para o `j`/`k` seguinte continuar dali.
3. `onChangeNota`/`aoTocar` continuam simples repasses para estado local / o reprodutor
   real (`features/nota-audio`, fatia 3) -- nenhuma mudança nesta fatia.

## Pontos de entrada

- `NotaPage()` -- componente React sem props, montado em `/notas`.

## Decisões desta fatia (atualizado no ticket S08-06)

- **`itens` (`ItemFila[]`) e `notas` (`Record<string, Nota>`) fundiram-se num único
  `useState<Record<string, Nota>>`, com `estado` a viver em `Nota`.** Eram duas
  coleções paralelas do mesmo `id`, mantidas em sincronia à mão por `marcarAssinada` (metade
  `itens`) e `onChangeNota` (metade `notas`) -- ver
  `[[S08-06 Fundir ItemFila em Nota e eliminar as listas paralelas]]` para o defeito
  completo. `notaFixture()` agora inclui `estado: ESTADO_PENDENTE`; `marcarAssinada(notaId)`
  atualiza só a `estado` da entrada certa dentro do `Record` (guarda: se `notaId` não é uma
  chave existente, não cria uma entrada nova) -- `onChangeNota` já mexia no mesmo `Record`,
  sem alteração. `<FilaEEditor>` passa a receber `notas={Object.values(notas)}` numa prop
  só, em vez de `itens`+`notas` separados.
- **A lógica de `aoAssinar` (ordem, guardas, mensagens) não mudou.** Só a forma de
  `marcarAssinada` por dentro mudou (map sobre array → update de chave num `Record`); os
  três ramos de desfecho (sucesso, 409, falha de rede) continuam exatamente como estavam.

## Decisões desta fatia (S08-01, fatia 5 de 5)

- **`kek`/`record`/`baseUrl`/`accountId`/`accessToken` são fixtures locais, não props.**
  Não existe ainda nenhum `KeychainProvider`/sessão real montada em lado nenhum da app
  (mesma situação, mesmo motivo, do `kek={null}, accountId=""` de
  `pages/settings/CopilotKeyPage.tsx`) -- inventar aqui uma forma de os receber via
  query string alargaria esta fatia para construir a wiring de sessão que nenhuma outra
  página tem, e que a spec S08-01 não pediu. `ponytail:` o comentário no topo de
  `NotaPage.tsx` nomeia o teto (as chamadas de rede reais falham com estas credenciais) e
  o caminho de upgrade (substituir os quatro valores quando existir Keychain/sessão --
  a lógica de `aoAssinar` não muda). Consequência prática: contra o `wrangler dev` que o
  e2e sobe, `aoAssinar` cai sempre no caminho de falha de rede -- `e2e/assinar-nota.spec.ts`
  prova o percurso de teclado até aí (o mesmo desfecho de rede que
  `NotaPage.test.tsx` prova com os módulos de crypto/api duplados).
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
  assinar" que a decisão acima declara. O resultado de `assinarNota` != `ok` continua com
  uma única exceção tratada (`notes.already_signed`, ver acima); qualquer outro
  `ProblemResult` de `assinarNota` cai no `catch` genérico (mesmo teto de sempre: só um
  escritor por nota nesta fatia).
- **Foco de volta à listbox via `document.querySelector('[role="listbox"]')`, não
  `forwardRef`.** É a única instância desse role na página; encadear `forwardRef` por
  `FilaEEditor` → `FilaAssinatura` só para devolver o foco seria mais código para o mesmo
  resultado.

## Fora de âmbito

- Fila real (múltiplas notas/pacientes vindas de um backend) -- ver
  `widgets/soap-editor/README.md`.
- Sessão/Keychain real (substituir os quatro valores fixture por props reais) -- ver a
  decisão acima.
- Reabrir uma nota já assinada e mostrar quando foi assinada é fluxo futuro, ainda sem
  nenhuma tela. `obterAssinatura` (`entities/nota/api.ts`) que serviria esse fluxo foi
  apagado no S08-02 por nunca ter tido chamador -- ver `entities/nota/README.md`,
  "Removido".
