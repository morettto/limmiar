# ADR-S08-10: O índice de busca é selado por uma chave de conta, não por uma DEK de paciente

## Contexto

O índice de busca da biblioteca (`features/nota-biblioteca`) é cross-paciente por definição de
produto: `BibliotecaPage` recebe a fila de assinatura inteira, `agruparPorPaciente` agrupa-a por
`patientId`, e o próprio índice guarda `patientId` em `storeFields` para poder devolver
resultados de vários pacientes numa só busca. O par `selarIndice`/`abrirIndice` já usava a AAD
certa para isso, `limmiar/note-index/v1|{accountId}`, e o teste de AAD trocada já provava que um
`accountId` diferente rejeita em vez de abrir.

A chave é que não tinha proveniência. `BibliotecaPage` declarava `dek: CryptoKey | null` e o
README dizia "sob a DEK da conta", mas nenhum código gerava ou desembrulhava essa chave --
`app/routing/router.tsx` monta a página com `dek={null}` e o efeito sai cedo. O ticket S08-10
nasceu com a leitura de que não existia nenhuma DEK de conta no repositório. Existem duas:
`voiceDekAad(accountId)` (`features/voice-enrollment`) e `copilotDekAad(accountId)`
(`features/copilot-byok`), as duas com `generateWrappedDek(kek, aad)` sob a KEK da conta.

O que restava era um prop tipado `CryptoKey`, que aceita qualquer chave AES-GCM do repositório.
`openRecord` (`entities/patient/patient-crypto.ts`) devolve exatamente isso: a DEK de um único
paciente. Quem ligasse a sessão real teria essa DEK na mão e este prop à espera dela, e o texto
integral das notas de todos os pacientes ficaria selado sob a chave de um só -- comprometer essa
chave deixaria de expor um prontuário para expor a biblioteca inteira.

## Decisão

O índice é selado sob a **KEK da conta**, com uma DEK fresca por gravação embrulhada sob essa KEK
com a AAD `limmiar/note-index-dek/v1|{accountId}`. Os bytes embrulhados (60: `iv(12) ||
AES-GCM(chave de 32) || tag(16)`) vão prefixados ao ciphertext, no mesmo blob. É a forma que
`features/copilot-byok/key-store.ts` já usa para a chave BYOK, aplicada a um terceiro dado de
conta; `opfsIndice` continua a tratar o blob como opaco e o código de OPFS não muda.

A chave chega a `BibliotecaPage` com um tipo marcado, `ChaveIndiceBusca = CryptoKey & { readonly
[marcaChaveIndice]: true }`, cujo símbolo não é exportado. `chaveIndiceDaConta(kek)` é a única
função que o produz, e recusa em runtime uma chave sem `unwrapKey` em `usages` -- o que uma DEK
de paciente nunca tem. Passar uma DEK de paciente ao prop deixa de compilar, e o teste de tipo
que o afirma vive em `BibliotecaPage.test.tsx`.

**Alternativa rejeitada: um índice por paciente**, selado sob a DEK que já existe para esse
paciente. Encolhe o raio de explosão em disco e não o encolhe em memória, que é onde o texto em
claro está: uma busca na biblioteca continuaria a precisar de todas as DEKs de paciente
desembrulhadas ao mesmo tempo. Em troca, multiplicaria os blobs, as leituras de OPFS e o custo de
reconstruir o índice a cada nota nova. Paga-se o preço todo sem comprar a propriedade.

## Consequências

- Quem tiver a KEK da conta abre o texto integral das notas de todos os pacientes dessa conta.
  É a mesma superfície que o cadastro de voz e a chave do copiloto já assumiram, e é o que uma
  busca única sobre a biblioteca custa. Um índice que não atravessa pacientes não é o produto
  descrito na spec S08.
- O blob em disco muda de formato: passa a ser `wrapped(60) || iv || ciphertext || tag` em vez de
  só o selado. Nenhum blob de produção existe hoje (`dek={null}` em todos os caminhos montados),
  portanto não há leitura de formato antigo, coerente com a regra de `AGENTS.md` de não manter
  compatibilidade para trás.
- A DEK do índice nasce e morre dentro de `selarIndice`. Não é prop, não é estado de página, e
  nunca aparece fora do módulo -- o que reduz o número de sítios onde uma chave errada pode ser
  passada ao único ponto que este ADR fecha.
- Ligar a KEK real continua fora deste ticket: o router mantém `chaveIndice={null}` até existir
  Keychain de sessão. O que muda é que, nesse dia, a única chave que o prop aceita já é a certa.
