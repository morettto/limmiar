# Api.PatientLinks

## Responsabilidade

Vínculo 1:1 profissional-paciente (sem equipa, sem muitos-para-muitos) por código de uso único,
e a superfície HTTP das 4 rotas (fatias 2-3 do ticket S11-04; fatia 1, o par de chaves X25519,
mora em `Accounts/KeyPair` -- ver `apps/api/README.md`). Convites e vínculos vivem só em
memória, como as contas de que dependem (abordagem (c), `.harness/abordagem/S11-04.md`).

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

Autorização: `SessionTokenIssuerAuthorization.AccountAccessProblem` em todas -- `401` sem
token/token inválido, `403 auth.forbidden` com token de outra conta (RFC 9110). `403
link.not_authorized` cobre tanto "não é profissional ativa" (convite) quanto "não é paciente"
(resgate) -- o mesmo código para as duas, para um chamador não distinguir qual falhou.

## Invariantes

- Código: 12 caracteres Crockford-Base32 (`0-9A-HJKMNPQRSTVWXYZ`, exclui I/L/O/U), 60 bits, TTL
  de 7 dias (`PatientLinkStore.InviteLifetime`), uso único.
- Só uma paciente resgata um código; inválido, expirado ou já usado colapsam no mesmo
  `link.invite_not_found` (um chamador não distingue "nunca existiu" de "já foi usado").
- `409 link.already_linked` se a mesma `(profissional, conta da paciente)` OU `(profissional,
  patientId)` já está vinculada -- duas invites para o mesmo par nunca duplicam o vínculo.
- A pública de outra conta só sai em `GET links` de quem é parte do vínculo (decisão (d) da
  abordagem) -- não existe rota de chave pública avulsa.
- Desvincular não mexe em pares de chaves nem no que já foi partilhado -- é só a remoção do
  registo de vínculo.
- `PatientLinkStore` é singleton, lock único (`System.Threading.Lock`), sem interface: o volume
  é baixo (um convite por vínculo humano), granularidade por código não compensa a complexidade.

## Armadilhas

- `ponytail`: lock global e tudo em memória; teto = reinício do processo perde vínculos e
  convites, exatamente como as contas de que dependem. Upgrade: tabela Postgres quando as contas
  saírem de `InMemoryAccountStore` (esboço de `patient_links` com RLS dupla em
  `.harness/abordagem/S11-04.md`, alternativa C2).
- `patientId` nunca é validado contra `patient_record_entries` -- exigiria Postgres e partiria o
  E2E (que não tem Docker, `playwright.config.ts`). Um `patientId` errado só prejudica a própria
  profissional que o digitou, não abre acesso a ninguém.
- `PatientLinkService.ToViewAsync` degrada a pública do par para `null` se a conta do outro lado
  não existir -- estruturalmente impossível hoje (não há apagar conta), mas é código defensivo,
  não uma suposição de que a conta sempre existe.

## Fora de âmbito

Fatias 4-6 do ticket S11-04 (`apps/app`): `garantirParDeChaves`, os ecrãs de convite/resgate/
desvincular, o cenário Playwright e o ADR-S11-06 do par de chaves selado. Ver
`.harness/S11-04-forma.md`.
