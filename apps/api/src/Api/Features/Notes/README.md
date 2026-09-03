# Api.Notes

## Responsabilidade

Assinatura de nota: uma trava por `(tenant_id, note_id)`, imposta pela chave primária de
`note_signatures` (migração `0005_create_note_signatures.sql`), RLS por tenant como
`Api.Patients` e `Api.Scheduling`. Diferente das duas, esta tabela existe justamente para o
servidor **ver** algo -- a existência da nota, a sua revisão, e o instante da assinatura --
em troca de a trava "uma assinatura por nota, para sempre" -- contra `app_role`, não contra
quem administra a base -- ser garantida pelo Postgres, não apenas lembrada pelo browser (ver
`docs/adr/ADR-S08-01-assinatura-visivel-ao-servidor.md`). O blob de assinatura em si
(`iv(12) || AES-GCM(digest SHA-256 da nota)(32) || tag(16)`, 60 bytes) continua opaco ao
servidor.

## Fluxo principal

- `NoteSignatureStore` -- único ponto de acesso a `note_signatures`, via
  `OpenTenantScopedTransactionAsync` (a mesma extensão que Patients e Scheduling usam).
  `InsertAsync` devolve `null` na `UniqueViolation` do `(tenant_id, note_id)`, em vez de
  lançar exceção -- desvio deliberado do molde de `PatientRecordStore.AppendAsync`: lá a
  corrida é rara e já coberta pela verificação aplicacional, logo excecional; aqui uma
  segunda tentativa de assinatura é o caminho normal do utilizador (duplo clique, estado
  stale após reload), e uma exceção para o caminho normal seria a gambiarra.
  `FindAsync` devolve `null` quando a nota não está assinada sob este tenant -- não filtra por
  `tenant_id` explicitamente na query, confia na policy RLS, mesmo padrão de
  `PatientRecordStore.ListAsync`.
- `NoteService.SignAsync` -- verifica a conta (existe, é Profissional Ativo, reusando
  `AccountAuthorizationGuard.CanCreatePatientRecords`), monta a `NoteSignature` com
  `SignedAt = DateTimeOffset.UtcNow` (o valor real e definitivo vem do `DEFAULT now()` da
  coluna, nunca do corpo do pedido) e traduz o `null` do store em
  `SignNoteFailureReason.AlreadySigned`. `GetSignatureAsync` é uma passagem direta para
  `NoteSignatureStore.FindAsync`.
- `NoteEndpoints` -- `POST /accounts/{accountId}/notes/{noteId}/signature` (`201` + header
  `Location`, sem devolver o próprio blob de assinatura no corpo) e
  `GET /accounts/{accountId}/notes/{noteId}/signature` (`200`/`404`). Reusa
  `TryValidateSealedBlobShape` (piso de 28 bytes) de `Api.Problems.SealedBlobShape`, a mesma
  cópia que `PatientEndpoints` e `VoiceEnrollmentEndpoints` usam, mais uma validação própria
  de `revision >= 0`. O `GET` existe porque, sem ele, a trava só vive na memória do browser e
  desaparece num reload.

## Decisões relevantes

- Sem `patient_id` em `note_signatures`: não tem leitor neste ticket -- a aresta
  nota→paciente já é visível ao servidor por `scheduled_sessions(id, patient_id)` com
  `id = note_id`.
- Sem chave estrangeira de `note_id` para `scheduled_sessions`: validar a existência da sessão
  acrescentaria uma FK e um `404` que nenhum critério de aceite deste ticket pede.
- Sem `id` sintético e sem `signed_by`: a chave primária composta `(tenant_id, note_id)` já
  identifica a linha, e `tenant_id` já É o profissional que assina (mesma convenção de
  `patient_record_entries`) -- ver os comentários na própria migração.
- `ponytail:` sem trigger `BEFORE UPDATE OR DELETE` de imobilidade -- o par `GRANT SELECT,
  INSERT` / `REVOKE UPDATE, DELETE` já fecha todos os caminhos de escrita que `app_role` tem, e
  `app_role` é o único papel com que a API alguma vez liga. Ver o comentário `ponytail:` na
  migração para as três alternativas de imposição avaliadas e rejeitadas. A credencial que
  corre as migrações fica fora dessa garantia -- ver "Consequências" em
  `docs/adr/ADR-S08-01-assinatura-visivel-ao-servidor.md`.
- `NoteEndpoints.MapFailureToProblem` (ronda 1 de correção): `AccountNotFound`/
  `NotAuthorizedToCreateRecords` deixaram de estar provados só a nível de `NoteService`
  (`NoteServiceTests`) e passaram a ter teste HTTP dedicado --
  `PostNoteSignature_WithUnknownAccountId_Returns404WithProblemDetails`/
  `PostNoteSignature_WithUnverifiedProfessional_Returns403WithProblemDetails`
  (`NoteEndpointsTests`), mesma técnica de `session-bypass` (`CreateFactoryWithSessionBypass`)
  que `PatientEndpointsTests` já usava -- duplicada em `NoteEndpointsTests`, não extraída, porque
  `CreateFactory()` em si já é duplicado por ficheiro de teste nesta suite (ver
  `tests/Api.Tests/Notes/NoteEndpointsTests.cs`); partilhar só o `WithSessionBypass` teria
  espalhado um padrão por dois lugares em vez de o deixar inteiro em cada um. `[ExcludeFromCodeCoverage]`
  continua no método (o gap real é só o fallback gerado pelo compilador para o `switch` --
  mesmo motivo de `PatientEndpoints.MapCreateFailureToProblem`), mas a justificação já não
  aponta para a camada de serviço como prova dos ramos nomeados.
