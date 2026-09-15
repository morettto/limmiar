# Api.PatientLinks

## Responsabilidade

Vínculo 1:1 profissional-paciente (sem equipa, sem muitos-para-muitos) por código de uso único,
e a superfície HTTP das 4 rotas (fatias 2-3 do ticket S11-04; fatia 1, o par de chaves X25519,
mora em `Accounts/KeyPair` -- ver `apps/api/README.md`). Desde S11-03 (fatias 7-9,
`.harness/abordagem/S11-03.md`), convites, vínculos e preferências de compartilhamento vivem em
Postgres com RLS (migração `0012_create_patient_links_and_sharing.sql`), não em memória.

Desde S11-02, o mesmo `PatientLinkStore` também guarda os envelopes cifrados que a paciente
partilha com a profissional (abordagem (c) de `.harness/abordagem/S11-02.md`) -- o servidor nunca
vê o tipo do item, só `byte[]`. Desde S11-03 fatia 10 (migração `0013`), os envelopes vivem em
`shared_items` (Postgres, append-only), e `GET received-shares` lê tudo o que a profissional
recebeu, inclusive de pares já desfeitos.

## Contrato público

- `POST /accounts/{accountId}/patients/{patientId}/link-invites` -- a profissional (conta ativa,
  `AccountAuthorizationGuard.CanCreatePatientRecords`) gera um código para um `patientId` da sua
  carteira. `201 { code, expiresAt }`.
- `POST /accounts/{accountId}/links` -- a paciente resgata o código. `201 LinkView` com a
  pública do par da profissional (`PeerPublicKey`), se ela já a publicou.
- `GET /accounts/{accountId}/links` -- lista os vínculos de quem pede, cada um com a pública do
  OUTRO lado.
- `DELETE /accounts/{accountId}/links/{peerAccountId}` -- qualquer das partes desvincula. `204`;
  `404 link.not_found` se não havia vínculo entre as duas contas.
- `POST /accounts/{accountId}/links/{peerAccountId}/shared-items` -- `accountId` (a paciente)
  anexa um envelope opaco `{ciphertext}` ao que partilha com `peerAccountId` (a profissional).
  `204`; `400 validation.invalid_field` se `ciphertext` tiver menos de 28 bytes ou mais de 64 KiB;
  `404 link.not_found` sem vínculo `(paciente=accountId, profissional=peerAccountId)` ATIVO.
- `GET /accounts/{accountId}/links/{peerAccountId}/shared-items` -- lista o que `peerAccountId`
  (a paciente) partilhou com `accountId` (a profissional), em ordem de chegada. `200
  SharedItemView[]`; `404 link.not_found` sem vínculo `(profissional=accountId,
  paciente=peerAccountId)` ATIVO. Desvincular esconde a lista (404) sem apagar os itens.
- `GET /accounts/{accountId}/received-shares` -- lista, para `accountId` (a profissional), toda
  paciente com quem ela algum dia esteve vinculada: um item por par (`patientAccountId`,
  `patientId`, `linkedAt`, `unlinkedAt`, `peerPublicKey`, `items[]`). `200 ReceivedShareView[]`,
  `[]` se nunca vinculada -- **nunca 404**: sempre a coleção da própria conta, e um par desfeito
  continua na lista com `unlinkedAt` preenchido. Só pares em que `accountId` é a profissional.
- `GET /accounts/{accountId}/sharing-preferences` -- devolve o blob de preferências de
  compartilhamento da conta. `200 {version, wrappedDek, ciphertext}`; `404
  sharing.preferences_not_found` se a conta nunca gravou.
- `PUT /accounts/{accountId}/sharing-preferences` -- substitui o blob sob concorrência otimista:
  `{expectedVersion, wrappedDek, ciphertext}` só grava se `expectedVersion` bater com a atual
  (0 = nunca gravado), e a versão sempre avança 1. `200 {version}`; `400 validation.invalid_field`
  se `expectedVersion` for negativo ou algum blob fora de 28..64 KiB; `409
  sharing.version_conflict` se a versão não bater -- o chamador relê e tenta de novo.

Autorização: `RequireAccountAccessMiddleware` em todas (rota `{accountId}`, sem guarda no
handler) -- `401` sem token/token inválido, `403 auth.forbidden` com token de outra conta (RFC 9110). `403
link.not_authorized` cobre tanto "não é profissional ativa" (convite) quanto "não é paciente"
(resgate) -- o mesmo código para as duas, para um chamador não distinguir qual falhou.

## Invariantes

- Código: 12 caracteres Crockford-Base32 (`0-9A-HJKMNPQRSTVWXYZ`, exclui I/L/O/U), 60 bits, TTL
  de 7 dias (`PatientLinkStore.InviteLifetime`), uso único -- consumido por `DELETE ...
  RETURNING` na mesma transação do `INSERT` em `patient_links`.
- Só uma paciente resgata um código; inválido, expirado ou já usado colapsam no mesmo
  `link.invite_not_found` (um chamador não distingue "nunca existiu" de "já foi usado"). O
  resgate lê o convite sob o GUC `app.invite_code` (RLS, abordagem (d)) -- quem resgata nunca
  teve sessão na conta que emitiu o código, só o código em mãos.
- `409 link.already_linked` se a mesma `(profissional, conta da paciente)` OU `(profissional,
  patientId)` já está vinculada -- garantido pelos índices únicos parciais
  `patient_links_active_account_pair_uq`/`patient_links_active_patient_id_uq`
  (`WHERE unlinked_at IS NULL`), não por lock de aplicação. Duas tentativas concorrentes do
  MESMO código resolvem-se no `DELETE` da invite, não nesse índice: só a primeira encontra a
  linha, as outras já veem `link.invite_not_found` (`PatientLinkStoreTests.RedeemAsync_TwoConcurrentAttemptsOnSameCode_ExactlyOneWins`).
- Desvincular é soft (`patient_links.unlinked_at`, S11-03 fatia 9): a linha sobrevive, só sai dos
  índices únicos parciais e do `WHERE unlinked_at IS NULL` que `ListForAsync`/`ShareAsync`/
  `ListSharedAsync` usam -- por isso `GET links` e `GET shared-items` continuam a dar 404 depois
  de desvincular, sem mudança de comportamento. Revincular cria uma linha nova.
- A pública de outra conta só sai em `GET links` de quem é parte do vínculo (decisão (d) da
  abordagem) -- não existe rota de chave pública avulsa. Em Postgres isso é a política
  `key_pair_ever_linked_read` em `account_key_pairs` (migração `0012`).
- Desvincular não mexe em pares de chaves nem no que já foi partilhado -- é só o soft-unlink do
  vínculo.
- `patient_link_invites`/`patient_links`/`shared_items` têm FK para `accounts`; `patient_id` fica
  sem FK porque não existe tabela `patients`. Convidar/resgatar para conta inexistente falha na
  base, não só na API.
- Um envelope só é aceito se já existir vínculo ATIVO `(paciente=accountId,
  profissional=peerAccountId)`. Desde a fatia 10, a checagem e o `INSERT` em `shared_items` são a
  MESMA instrução SQL (`INSERT ... SELECT ... WHERE EXISTS (... FOR SHARE)`): o `FOR SHARE` trava
  a linha de `patient_links` lida, então um `UnlinkAsync` concorrente (lock exclusivo do `UPDATE`)
  bloqueia até o `Share` terminar, e vice-versa -- serializam em vez de intercalar
  (`ShareAsync_ConcurrentWithUnlink_NeverInsertsAnEnvelopeAfterUnlinkedAt`). Desvincular não apaga
  envelopes; revogar é só trocar o blob de preferências. A tabela é append-only por privilégio
  (`GRANT SELECT, INSERT` sem `UPDATE`/`DELETE`, migração `0012`) -- falha na base, não só na API.
  Duas políticas SELECT permissivas (0012 + 0013) somam com OR: profissional e paciente do par
  leem a linha, uma terceira conta não lê.
- `ListReceivedSharesAsync` agrupa por `patient_account_id` com `DISTINCT ON` (linha mais recente
  de `patient_links` do par, ativa ou desfeita), com a pública atual da paciente e todo envelope
  já trocado -- a leitura que `EspelhoP6` usa desde a fatia 11 em vez de `GET links` + `GET
  shared-items` por vínculo, que continuam a dar 404 depois de desvincular.
- `PutPreferencesAsync` é concorrência otimista como garantia de banco (S11-03 fatia 8): só
  grava se `expectedVersion` bater com a versão atual da conta (0 = nunca gravado, via `INSERT
  ... ON CONFLICT DO NOTHING`; caso contrário via `UPDATE ... WHERE version = @esperado`), e
  sempre avança exatamente 1 no sucesso. Em conflito devolve a versão atual lida na mesma
  transação (não o motivo) -- provado sob 20 chamadas concorrentes em
  `PatientLinkStoreTests.PutPreferencesAsync_ConcurrentSameExpectedVersion_ExactlyOneWins`.

## Armadilhas

- `ponytail`: `ListReceivedSharesAsync` não pagina -- teto = memória do processo e tamanho da
  resposta HTTP. Upgrade: paginar por `patient_account_id` (abordagem (e), E1).
- `Api.Platform.Result<TValue, TFailure>` relaxou a constraint de `TFailure` de `struct, Enum`
  para `struct` (S11-02) para que `PutPreferencesAsync` pudesse devolver
  `Result<SharingPreferences, long>` -- a razão de falha é o próprio número de versão atual, não
  um enum nomeado. Toda constraint anterior (`enum : struct, Enum`) continua satisfazendo
  `struct`, nenhum chamador existente muda de comportamento.
- `patientId` nunca é validado contra `patient_record_entries` -- um `patientId` errado só
  prejudica a própria profissional que o digitou, não abre acesso a ninguém.
- `PatientLinkService.ToViewAsync` degrada a pública do par para `null` só se o par nunca
  publicou chave -- a FK em `patient_links` torna "conta inexistente" impossível desde a fatia 9.

## Fora de âmbito

Fatias 4-6 do ticket S11-04 (`apps/app`): `garantirParDeChaves`, ecrãs de convite/resgate/
desvincular, cenário Playwright e o ADR-S11-06 do par de chaves selado. Ver `.harness/S11-04-forma.md`.
