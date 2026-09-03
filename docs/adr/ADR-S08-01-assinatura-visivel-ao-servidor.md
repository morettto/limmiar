# ADR-S08-01: Assinatura de nota visível ao servidor apesar do produto ser zero-knowledge

## Contexto

O critério de aceite S08-01 exige que uma nota assinada fique travada -- ninguém, incluindo o
próprio profissional, consegue voltar a editá-la depois de assinada -- e que essa trava
sobreviva a um reload ou a um novo dispositivo, não apenas viva em memória do browser.
`patient_record_entries` (S03-01) e `scheduled_sessions` (S04-02) já estabeleceram o padrão do
produto: campos clínicos são blobs cifrados opacos ao servidor, com uma exceção pontual e
justificada quando o próprio Postgres precisa de comparar um valor para impor uma garantia
(`ADR-S04-02-horario-em-claro-servidor-zero-knowledge.md`). Impor "uma assinatura por nota,
para sempre" -- contra `app_role`, o único papel com que a API liga, não contra a credencial
que corre as migrações -- tem a mesma forma: exige que o servidor veja o suficiente para uma
chave primária recusar a segunda escrita desse papel, não apenas para o cliente lembrar-se de
recusar reeditar.

## Decisão

`note_signatures` (migração `0005_create_note_signatures.sql`) guarda, por nota, um blob
selado (`iv(12) || AES-GCM(digest SHA-256 da nota)(32) || tag(16)`, 60 bytes, opaco ao
servidor), a `revisao` assinada (entra na AAD do blob -- impede replicar a assinatura de uma
revisão para outra) e o instante da assinatura (`signed_at`, decidido pelo servidor via
`DEFAULT now()`, nunca aceite do corpo do pedido). A chave primária composta
`(tenant_id, note_id)` é o único mecanismo de imposição: não existe segunda camada (trigger,
índice único adicional, foreign key) -- ver o comentário `ponytail:` na própria migração para
as três alternativas avaliadas e rejeitadas.

Três construções alternativas para a primitiva de assinatura foram avaliadas e rejeitadas:

- **SHA-256 em claro na coluna**: dá ao servidor um oráculo de confirmação de plaintext -- a
  nota SOAP tem frasear templado (seções Subjetivo/Objetivo/Avaliação/Plano com vocabulário
  clínico previsível), o que torna adivinhar-e-confirmar um ataque prático contra o hash em
  claro, não apenas teórico.
- **HMAC-SHA256**: a DEK do paciente é uma `CryptoKey` AES-GCM não extraível (WebCrypto) e não
  serve como chave HMAC -- usá-la exigiria uma chave nova, uma derivação nova e uma primitiva
  nova só para entregar a mesma garantia de integridade que a tag do próprio AES-GCM já dá de
  graça.
- **Ed25519**: a primitiva em si é grátis -- `@noble/curves` já é dependência de
  `packages/crypto/src/x25519.ts`. O que não é grátis é a infraestrutura de identidade que a
  torna significativa: inscrição de chave pública, publicação, rotação e revogação. Isso é
  escopo de S10 (identidade de assinatura), não uma coluna nova nesta fatia.

## Consequências

- O servidor zero-knowledge passa a ver a existência de cada nota assinada, a sua revisão, e o
  instante exato da assinatura -- metadado operacional (quando, quantas vezes), não conteúdo
  clínico. Mesma exceção deliberada e localizada que `ADR-S04-02` já abriu para
  `scheduled_sessions`, não uma reversão do princípio.
- A trava "uma assinatura por nota" é garantida pelo próprio Postgres (chave primária), não por
  uma verificação de aplicação sujeita a corrida -- a mesma prova que `patient_record_entries`
  já demonstrou para `(tenant_id, patient_id, sequence)`.
- **A propriedade que se perde é o não-repúdio perante terceiros.** Quem tem a DEK do paciente
  -- hoje, isso inclui o próprio profissional que assinou -- consegue reproduzir bit-a-bit o
  mesmo blob selado mais tarde, para a mesma nota e revisão. A assinatura prova conteúdo
  (esta nota, nesta revisão) e acesso (quem tinha a DEK no momento), não autoria irrefutável
  contra o próprio profissional diante de um auditor externo ou de um tribunal -- essa
  propriedade só chega com identidade assimétrica publicada (Ed25519 + infraestrutura de
  chave pública), que é o escopo rejeitado acima e fica para S10.
- **A trava vale contra `app_role`, não contra quem administra a base.** `app_role` é o único
  papel com que a API alguma vez liga, e o `REVOKE UPDATE, DELETE` fecha os caminhos de escrita
  que esse papel tem. A credencial que corre as migrações -- dona da tabela -- fica de fora
  dessa garantia: mantém `DELETE` (nunca lhe foi revogado), pode
  `ALTER TABLE note_signatures NO FORCE ROW LEVEL SECURITY` e pode `DROP POLICY
  tenant_isolation`, revertendo a trava por inteiro. `NoteSigned` está reservada em
  `AuditAction`, e S10-01 entregou a estrutura da trilha sem produtor
  (`apps/api/src/Api/Features/Audit/README.md`). Mesmo com produtor, a trilha regista o que a
  aplicação faz como `app_role` -- não SQL emitido diretamente pela credencial das migrações --
  e este abuso não produz entrada nenhuma. O que a trilha daria, havendo produtor, é divergência
  detetável, não registo do abuso: uma assinatura apagada por SQL direto deixaria a entrada
  `NoteSigned` órfã face a `note_signatures` -- e mesmo isso assume que a mesma credencial não
  reescreve entradas e âncoras na mesma transação, que é precisamente o que a âncora, por
  desenho, não prova.
