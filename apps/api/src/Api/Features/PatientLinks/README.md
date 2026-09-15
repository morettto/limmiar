# Api.PatientLinks

## Responsabilidade

Vínculo 1:1 profissional-paciente (sem equipa, sem muitos-para-muitos) por código de uso único,
e a superfície HTTP das 4 rotas (fatias 2-3 do ticket S11-04; fatia 1, o par de chaves X25519,
mora em `Accounts/KeyPair` -- ver `apps/api/README.md`). Desde S11-03 (fatias 7-9,
`.harness/abordagem/S11-03.md`), convites, vínculos e preferências de compartilhamento vivem em
Postgres com RLS (migração `0012_create_patient_links_and_sharing.sql`), não em memória.

Desde S11-02 (fatias 1-2), o mesmo `PatientLinkStore` também guarda os envelopes cifrados que a
paciente partilha com a profissional -- ver abordagem (c) de `.harness/abordagem/S11-02.md`. O
servidor nunca vê o tipo do item partilhado, só `byte[]`. Os envelopes continuam em memória até
à fatia 10 (S11-03, lote 3, junto da rota `GET received-shares`); a tabela `shared_items` já
existe na migração `0012` para essa fatia usar.

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
  `204`; `400 validation.invalid_field` se `ciphertext` tiver menos de 28 bytes
  (`SealedBlobShape`) ou mais de 64 KiB; `404 link.not_found` se não houver vínculo com
  `accountId` como paciente e `peerAccountId` como profissional -- a direção importa.
- `GET /accounts/{accountId}/links/{peerAccountId}/shared-items` -- lista o que
  `peerAccountId` (a paciente) partilhou com `accountId` (a profissional), em ordem de chegada.
  `200 SharedItemView[]`; `404 link.not_found` se não houver vínculo com `accountId` como
  profissional e `peerAccountId` como paciente. Desvincular esconde a lista (404) sem apagar os
  itens; revincular volta a mostrá-los.
- `GET /accounts/{accountId}/sharing-preferences` -- devolve o blob de preferências de
  compartilhamento da conta. `200 {version, wrappedDek, ciphertext}`; `404
  sharing.preferences_not_found` se a conta nunca gravou.
- `PUT /accounts/{accountId}/sharing-preferences` -- substitui o blob sob concorrência
  otimista: `{expectedVersion, wrappedDek, ciphertext}` só grava se `expectedVersion` bater com
  a versão atual (0 = nunca gravado), e a versão sempre avança exatamente 1. `200 {version}`
  (só a versão nova; o chamador já tem o resto, `GET` devolve o blob completo); `400
  validation.invalid_field` se `expectedVersion` for negativo ou algum blob tiver menos de 28
  bytes ou mais de 64 KiB; `409 sharing.version_conflict` se a versão atual não bater -- o
  chamador relê e tenta de novo.

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
- `patient_link_invites`/`patient_links`/`shared_items` têm FK para `accounts` (professional e
  patient); `patient_id` fica sem FK porque não existe tabela `patients`. Convidar ou resgatar
  para uma conta inexistente falha na base, não só na API.
- Um envelope partilhado só é aceito se já existir vínculo ATIVO `(paciente=accountId,
  profissional=peerAccountId)` -- a checagem em si já corre contra Postgres (`IsLinkedAsync`),
  mas o `append` continua num dicionário em memória (ver Armadilhas). Desvincular não apaga
  envelopes; revogar o compartilhamento é só uma troca do blob de preferências.
- `PutPreferencesAsync` é concorrência otimista como garantia de banco (S11-03 fatia 8): só
  grava se `expectedVersion` bater com a versão atual da conta (0 = nunca gravado, via `INSERT
  ... ON CONFLICT DO NOTHING`; caso contrário via `UPDATE ... WHERE version = @esperado`), e
  sempre avança exatamente 1 no sucesso. Em conflito devolve a versão atual lida na mesma
  transação (não o motivo) -- provado sob 20 chamadas concorrentes em
  `PatientLinkStoreTests.PutPreferencesAsync_ConcurrentSameExpectedVersion_ExactlyOneWins`.

## Armadilhas

- `ponytail`: os envelopes partilhados (`ShareAsync`/`ListSharedAsync`) ainda vivem num
  dicionário em memória, sem teto além da memória do processo -- teto = reinício perde o que foi
  partilhado (a tabela `shared_items` já existe, migração `0012`). Upgrade: fatia 10 (S11-03,
  lote 3), junto da rota `GET received-shares`.
- `ponytail`: o par "checar vínculo ativo + anexar envelope" já não é atômico -- a checagem
  corre numa transação Postgres, o append num lock em memória à parte, deixando uma janela
  estreita para um `Unlink` concorrente se intercalar entre as duas. Sem teste que a exercite;
  aceitável até a fatia 10 mover o envelope para dentro da mesma transação do vínculo.
- `Api.Platform.Result<TValue, TFailure>` relaxou a constraint de `TFailure` de `struct, Enum`
  para `struct` (S11-02) para que `PutPreferencesAsync` pudesse devolver
  `Result<SharingPreferences, long>` -- a razão de falha é o próprio número de versão atual, não
  um enum nomeado. Toda constraint anterior (`enum : struct, Enum`) continua satisfazendo
  `struct`, nenhum chamador existente muda de comportamento.
- `patientId` nunca é validado contra `patient_record_entries` -- não existe tabela `patients`
  (ver acima). Um `patientId` errado só prejudica a própria profissional que o digitou, não abre
  acesso a ninguém.
- `PatientLinkService.ToViewAsync` degrada a pública do par para `null` se o par nunca publicou
  chave -- não se a conta não existir: a FK em `patient_links` torna isso estruturalmente
  impossível desde a fatia 9 (antes era só "impossível hoje", sem imposição da base).

## Fora de âmbito

Fatias 4-6 do ticket S11-04 (`apps/app`): `garantirParDeChaves`, os ecrãs de convite/resgate/
desvincular, o cenário Playwright e o ADR-S11-06 do par de chaves selado. Ver
`.harness/S11-04-forma.md`.
