# Api.Audit

## Responsabilidade

Trilha de auditoria encadeada por hash: cada evento (`SignIn`, `SignOut`, `RecordOpened`,
`RecordAppended`, `NoteSigned`, `ExportRequested`) vira uma linha de `audit_entries` cujo
`entry_hash` cobre os seus próprios campos mais o `entry_hash` da linha anterior -- alterar
qualquer entrada passada faz o encadeamento falhar a partir daí (critério de aceite 1). Este
ticket entrega a estrutura de dados pura e a base persistente, testadas antes de existir
qualquer produtor real de evento -- não há `AuditService`, endpoint HTTP, nem chamador. Ver
`docs/adr/ADR-S10-01-campos-do-hash-da-trilha.md` para exatamente que campos entram no hash e
porquê, e o ticket S10-01 para as três decisões duras (concorrência, âncora, prova do
critério 4) que o desenho já fechou.

## Fluxo principal

- `AuditEntry.cs` -- `enum AuditAction` (as seis ações fechadas, ordinal = valor `smallint`
  hasheado e o que o `CHECK audit_action_range` da migração permite), `record AuditEntry`
  (uma linha de `audit_entries`), `record AuditAnchor` (uma linha futura de `audit_anchors`;
  sem produtor ainda -- ver "Fora de âmbito" abaixo).
- `AuditChain.cs` -- puro, zero I/O, zero DI:
  - `GenesisHash` -- 32 bytes zero, a raiz da cadeia (nunca `NULL`, ver a migração).
  - `ComputeHash(tenantId, sequence, action, deviceId, recordedAt, previousHash)` -- SHA-256
    sobre o preâmbulo de 82 bytes big-endian de largura fixa (`ADR-S10-01`).
  - `Verify(chain, anchors)` -- percorre a cadeia desde a génese, recalculando cada hash e
    conferindo o encadeamento; para no primeiro elo partido e devolve
    `AuditVerification.Broken(sequence, kind)`. `anchors` é aceite na assinatura (fixada pelo
    ticket) mas ainda não consultado -- ver "Fora de âmbito".
- `AuditVerification.cs` -- resultado (molde de `Api.Notes.SignNoteResult`):
  `Intact`/`FirstBrokenSequence`/`BreakKind` (`HashMismatch`, `BrokenLink`, `AnchorMismatch`),
  mais os construtores `Ok()`/`Broken(sequence, kind)`.
- Migração `0006_create_audit_trail.sql` -- cria só `audit_entries` (não `audit_anchors`, ver
  abaixo). RLS `tenant_isolation` com `FORCE` (mesmo padrão de `note_signatures`, migração
  `0005`), `GRANT SELECT, INSERT` / `REVOKE UPDATE, DELETE` para `app_role`. A imposição do
  não-fork da cadeia é `UNIQUE (tenant_id, previous_hash)`, não uma trava de aplicação -- ver
  o comentário na própria migração e a secção "Decisões relevantes".

## Decisões relevantes

- **`UNIQUE (tenant_id, previous_hash)`, não `UNIQUE(tenant_id, sequence)`.** Duas escritas
  concorrentes que leem a mesma cabeça `H` da cadeia e tentam `previous_hash = H` só deixam uma
  passar -- imposto pelo Postgres, não lembrado pela aplicação. É o invariante "nenhuma entrada
  tem dois sucessores": a cadeia nunca vira árvore, nem por bug futuro. `AppendAsync` (fatia 5,
  fora deste ticket parcial) é quem lê a cabeça, tenta o insert, e retenta em caso de perda.
- **Sem trigger de imutabilidade.** O par `GRANT SELECT, INSERT` / `REVOKE UPDATE, DELETE`
  fecha todos os caminhos de escrita que `app_role` tem, e `app_role` é o único papel com que a
  API liga -- mesmo raciocínio de `note_signatures` (0005) e `patient_record_entries` (0002).
  Comentário `ponytail:` completo na migração.
- **`recorded_at` sem `DEFAULT now()`.** O valor hasheado e o valor gravado têm de ser
  exatamente o mesmo instante; se a base decidisse o valor, ele chegaria depois de a aplicação
  já ter computado `entry_hash` a partir de outro. Ver `ADR-S10-01`.
- **Critério de aceite 4 provado contra a base, não por regex na migração.**
  `AuditEntries_HasExactlyTheSevenMetadataColumns` compara o conjunto exato de
  `(column_name, data_type)` em `information_schema.columns`; `AuditActionRangeMatchesEnum`
  insere todos os `Enum.GetValues<AuditAction>()` com sucesso e o valor seguinte com
  `CheckViolation` -- mantém o `CHECK` da migração e o enum em sincronia por construção, não
  por disciplina.

## Fora de âmbito nesta fatia (1-4 de 7)

- `AuditEntryStore.cs` (`AppendAsync`, `ListAsync`, `CaptureAnchorAsync`, `ListAnchorsAsync`) --
  fatias 5-7, sessão seguinte. `AuditChain.Verify` já aceita `IReadOnlyList<AuditAnchor>` para
  não exigir mudança de assinatura quando a checagem de âncora entrar, mas hoje não a consulta
  -- `AuditBreakKind.AnchorMismatch` não é produzido por nenhum caminho de código atual.
- Tabela `audit_anchors` -- não criada por esta migração; a fatia 7 é quem a desenha (o teto do
  que ela prova está descrito no ticket, secção "Âncora").
- `actor_id`, `subject_id`, filtro por data/autor, exportação, consentimento, `hash_version`,
  Ed25519/chave pública -- todos explicitamente fora do ticket S10-01, ver a secção "O que não
  entra" do ticket para o argumento de cada um.
