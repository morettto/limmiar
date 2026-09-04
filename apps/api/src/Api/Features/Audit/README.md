# Api.Audit

## Responsabilidade

Trilha de auditoria encadeada por hash: cada evento (`SignIn`, `SignOut`, `RecordOpened`,
`RecordAppended`, `NoteSigned`, `ExportRequested`) vira uma linha de `audit_entries` cujo
`entry_hash` cobre os seus próprios campos mais o `entry_hash` da linha anterior -- alterar
qualquer entrada passada faz o encadeamento falhar a partir daí (critério de aceite 1). Uma
reescrita **completa e recomputada** da cadeia não parte elo nenhum, e é por isso que existe a
âncora: `audit_anchors` guarda a cabeça da cadeia num instante, e `AuditChain.Verify` confronta
a entrada ancorada com essa testemunha (critério de aceite 3). O teto do que a âncora prova
está dito em "Decisões relevantes" -- prova contra quem reescreve as entradas, não contra um
superuser que reescreve entradas e âncoras na mesma transação. Este ticket entrega a estrutura
de dados pura e a base persistente, testadas antes de existir qualquer produtor real de evento
-- não há `AuditService`, endpoint HTTP, nem chamador; `AuditEntryStore` é o único ponto de
entrada e os testes constroem-no diretamente. Ver
`docs/adr/ADR-S10-01-campos-do-hash-da-trilha.md` para exatamente que campos entram no hash e
porquê, e o ticket S10-01 para as três decisões duras (concorrência, âncora, prova do
critério 4) que o desenho já fechou.

## Fluxo principal

- `AuditEntry.cs` -- `enum AuditAction` (as seis ações fechadas, ordinal = valor `smallint`
  hasheado e o que o `CHECK audit_action_range` da migração permite), `record AuditEntry`
  (uma linha de `audit_entries`), `record AuditAnchor` (uma linha de `audit_anchors`, produzida
  só por `AuditEntryStore.CaptureAnchorAsync`).
- `AuditChain.cs` -- puro, zero I/O, zero DI:
  - `GenesisHash` -- 32 bytes zero, a raiz da cadeia (nunca `NULL`, ver a migração).
  - `ComputeHash(tenantId, sequence, action, deviceId, recordedAt, previousHash)` -- SHA-256
    sobre o preâmbulo de 82 bytes big-endian de largura fixa (`ADR-S10-01`).
  - `Verify(chain, anchors)` -- percorre a cadeia desde a génese, recalculando cada hash e
    conferindo o encadeamento; para no primeiro elo partido e devolve
    `AuditVerification.Broken(sequence, kind)`. **Só depois** de a cadeia fechar por dentro é
    que confronta cada âncora: se a entrada em `AnchoredSequence` não carrega o `AnchoredHash`
    gravado -- ou já nem existe, que é o caso da cadeia truncada -- devolve
    `Broken(AnchoredSequence, AnchorMismatch)`.
- `AuditVerification.cs` -- resultado de `AuditChain.Verify`: `Intact`/`FirstBrokenSequence`/
  `BreakKind` (`HashMismatch`, `BrokenLink`, `AnchorMismatch`), mais os construtores
  `Ok()`/`Broken(sequence, kind)`. **Decisão (S08-21): deliberadamente não migrado** para
  `Api.Platform.Result<TValue, TFailure>` (ADR
  `docs/adr/0011-store-service-nao-devolve-tuplo-nullable.md`), ao contrário de
  `Api.Notes`/`Api.Patients` (S08-14) e, desde este ticket, `Api.Accounts`
  (`LoginHandler`/`ContinueWithGoogleHandler`), `Api.Consent` e `Api.Scheduling`. Razão: não é
  um par valor-ou-falha. `Result<TValue, TFailure>` exige exatamente um valor de sucesso
  (`TValue`, restrito a `class`) xor uma razão de falha; `AuditVerification.Ok()` não carrega
  nenhum valor de sucesso -- o caso "cadeia íntegra" não tem payload nenhum, só o booleano
  implícito em `Intact`. Forçar isto no molde partilhado exigiria um `TValue` artificial (ex.
  `object`) só para satisfazer a assinatura, ou inverter `Broken` para "falha" e `Ok` para um
  `TValue` vazio inventado -- ambos torcem o tipo partilhado para um formato que não é o dele
  em vez de o tipo servir o domínio. `AuditVerification` fica como está.
- Migração `0006_create_audit_trail.sql` -- cria as duas tabelas, `audit_entries` e
  `audit_anchors`, com o mesmo tratamento: RLS `tenant_isolation` com `FORCE` (mesmo padrão de
  `note_signatures`, migração `0005`) e `GRANT SELECT, INSERT` / `REVOKE UPDATE, DELETE` para
  `app_role`. A imposição do não-fork da cadeia é `UNIQUE (tenant_id, previous_hash)`, não uma
  trava de aplicação -- ver o comentário na própria migração e a secção "Decisões relevantes".
  A chave de `audit_anchors` é `(tenant_id, anchored_at)`: a identidade de uma testemunha é
  "esta cadeia, neste instante", e reancorar a mesma cabeça mais tarde é testemunha nova (fecha
  a janela em que uma reescrita poderia ter acontecido), não duplicado. As três colunas de hash
  (`previous_hash`/`entry_hash` em `audit_entries`, `anchored_hash` em `audit_anchors`) têm
  `CHECK (octet_length(...) = 32)`: `AuditChain.ComputeHash` copia `previousHash` para um slice
  de 32 bytes sem validar o tamanho, e um hash mais curto corromperia o preâmbulo em silêncio em
  vez de falhar.
- `AuditEntryStore.cs` -- Postgres, sem interface (mesma razão de `NoteSignatureStore` e
  `PatientRecordStore`: a prova de RLS e de concorrência precisa de um Postgres real via
  Testcontainers, não há fake em memória para lhe substituir):
  - `AppendAsync(tenantId, action, deviceId, ct)` -- lê a cabeça da cadeia (maior `sequence`
    desse tenant; sem linhas ainda = génese, `sequence` 1 e `AuditChain.GenesisHash`), computa
    `entry_hash` com `AuditChain.ComputeHash`, e insere dentro de
    `OpenTenantScopedTransactionAsync` (`Platform/Data/TenantScopedTransaction.cs:33`) -- sem
    `WHERE tenant_id` em lugar nenhum, a policy RLS é quem isola. Se o `INSERT` colidir contra
    `UNIQUE (tenant_id, previous_hash)` (`PostgresException` com `SqlState` de
    `UniqueViolation`), relê a cabeça (agora avançada) e retenta, até `maxAttempts`
    (parâmetro do construtor, default 8) -- só depois devolve `null`, nunca lança. `action`,
    `deviceId` e o único `recordedAt` capturado antes do laço nunca mudam entre tentativas;
    só `sequence` e `previousHash` mudam, porque são os únicos campos que uma escrita
    concorrente pode invalidar. `recorded_at` é fornecido pela aplicação, não pela migração
    (sem `DEFAULT now()`) -- o instante hasheado em `entry_hash` e o instante gravado têm de
    ser exatamente o mesmo, e só a aplicação, que já computou o hash antes de inserir, pode
    garantir isso.
  - `ListAsync(tenantId, ct)` -- a cadeia inteira de um tenant, mais antiga primeiro, a forma
    que `AuditChain.Verify` espera. Mesma convenção de tenant-scoping sem `WHERE tenant_id`.
  - `CaptureAnchorAsync(tenantId, ct)` -- lê a cabeça da cadeia e grava-a em `audit_anchors`
    (`AnchoredSequence` + `AnchoredHash`) na **mesma transação**, para que a âncora nunca
    testemunhe uma cabeça que um `AppendAsync` concorrente já moveu. Cadeia vazia devolve
    `null` (não há cabeça para testemunhar, e âncora sobre nada afirmaria o que não prova).
    É o único produtor de âncoras -- sem timer, sem `IHostedService`.
  - `ListAnchorsAsync(tenantId, ct)` -- as âncoras do tenant, mais antiga primeiro; o segundo
    argumento de `AuditChain.Verify`. Mesma convenção de tenant-scoping sem `WHERE tenant_id`.
  - `ReadChainHeadAsync` (privado) é partilhado pelos dois: devolve `null` para cadeia vazia e
    cada chamador decide o que isso significa -- `AppendAsync` traduz para a génese (`sequence`
    1, `AuditChain.GenesisHash`), `CaptureAnchorAsync` traduz para "nada a ancorar".

## Decisões relevantes

- **`UNIQUE (tenant_id, previous_hash)`, não `UNIQUE(tenant_id, sequence)`.** Duas escritas
  concorrentes que leem a mesma cabeça `H` da cadeia e tentam `previous_hash = H` só deixam uma
  passar -- imposto pelo Postgres, não lembrado pela aplicação. É o invariante "nenhuma entrada
  tem dois sucessores": a cadeia nunca vira árvore, nem por bug futuro. `AppendAsync` é quem lê
  a cabeça, tenta o insert, e retenta em caso de perda -- nunca devolve a entrada perdida em
  silêncio, porque perder uma linha de auditoria é perda de dados.
- **`AppendAsync` retenta até `maxAttempts`, nunca lança na perda de corrida.** O default 8 é o
  pior caso medido pelo teste de concorrência de oito escritores
  (`AppendAsync_WithEightConcurrentCalls_PersistsEightEntriesAndVerifyStaysIntact`), que corre
  com o default em vez de o contornar -- o argumento completo está no docstring do parâmetro
  `maxAttempts` no construtor de `AuditEntryStore`.
- **Sem trigger de imutabilidade.** O par `GRANT SELECT, INSERT` / `REVOKE UPDATE, DELETE`
  fecha todos os caminhos de escrita que `app_role` tem, e `app_role` é o único papel com que a
  API liga -- mesmo raciocínio de `note_signatures` (0005) e `patient_record_entries` (0002).
  Comentário `ponytail:` completo na migração.
- **`recorded_at` sem `DEFAULT now()`.** O valor hasheado e o valor gravado têm de ser
  exatamente o mesmo instante; se a base decidisse o valor, ele chegaria depois de a aplicação
  já ter computado `entry_hash` a partir de outro. Ver `ADR-S10-01`.
- **O que a âncora prova, e o teto.** Ceiling and upgrade path: see the ponytail comment in
  migration 0006.
- **Ordem de deteção: elo partido ganha da âncora.** A caminhada da cadeia corre primeiro e,
  quando encontra `BrokenLink`/`HashMismatch`, devolve logo. A âncora é a rede para a reescrita
  que não deixa nenhuma quebra interna; reportá-la primeiro apontaria `FirstBrokenSequence`
  para a sequência ancorada em vez da entrada que está de facto errada (o "a partir daí" do
  critério 1). Travado por
  `AuditChainTests.Verify_WhenBothAnEntryAndItsAnchorAreViolated_ReportsTheChainBreakNotTheAnchor`.
- **Uma política de comparação de hash em `AuditChain`.** As três comparações de hash de
  `Verify` (elo, `entry_hash` e `AnchorMismatch`) usam todas
  `CryptographicOperations.FixedTimeEquals` -- o argumento completo está no comentário
  imediatamente acima do `foreach` em `AuditChain.cs`.
- **Critério de aceite 4 provado contra a base, não por regex na migração.**
  `AuditTrailSchemaTests.AuditEntries_HasExactlyTheSevenMetadataColumns` e
  `AuditAnchors_HasExactlyTheFourColumns` comparam o conjunto exato de
  `(column_name, data_type)` em `information_schema.columns` para cada tabela;
  `AuditActionRangeMatchesEnum` insere todos os `Enum.GetValues<AuditAction>()` com sucesso e o
  valor seguinte com `CheckViolation` -- mantém o `CHECK` da migração e o enum em sincronia por
  construção, não por disciplina.

## Fora de âmbito do ticket S10-01 (as sete fatias fecharam)

- **Produtor real de evento e superfície HTTP** -- nada chama `AppendAsync` fora dos testes:
  sem `AuditService`, sem endpoint, sem registo em DI, sem `JsonContext`, sem problem code.
  `AddAudit()` são três linhas quando o primeiro produtor chegar.
- **Timer ou `IHostedService` da âncora** -- `CaptureAnchorAsync` existe e é o único produtor,
  mas quem o invoca hoje é o teste. Agendá-lo é uma linha em `Program.cs` no dia em que houver
  eventos reais para ancorar.
- `actor_id`, `subject_id`, filtro por data/autor, exportação, consentimento, `hash_version`,
  Ed25519/chave pública -- todos explicitamente fora do ticket S10-01, ver a secção "O que não
  entra" do ticket para o argumento de cada um. Se a assinatura assimétrica entrar depois, o
  seam é assinar a **âncora** (uma coluna `anchor_signature` em `audit_anchors`), não cada
  entrada.
