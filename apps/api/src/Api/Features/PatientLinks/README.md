# Api.PatientLinks

## Responsabilidade

Vínculo 1:1 profissional-paciente (sem equipa, sem muitos-para-muitos) por código de uso único,
e a superfície HTTP das 4 rotas (fatias 2-3 do ticket S11-04; fatia 1, o par de chaves X25519,
mora em `Accounts/KeyPair` -- ver `apps/api/README.md`). Convites e vínculos vivem só em
memória, como as contas de que dependem (abordagem (c), `.harness/abordagem/S11-04.md`).

Desde S11-02 (fatias 1-2), o mesmo `PatientLinkStore` também guarda os envelopes cifrados que a
paciente partilha com a profissional e o blob opaco de preferências de compartilhamento de cada
conta -- ver abordagem (c) de `.harness/abordagem/S11-02.md`. O servidor nunca vê o tipo do item
partilhado nem o estado do compartilhamento, só `byte[]`.

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
  a versão atual (0 = nunca gravado), e a versão sempre avança exatamente 1. `200
  {version, wrappedDek, ciphertext}`; `400 validation.invalid_field` se `expectedVersion` for
  negativo ou algum blob tiver menos de 28 bytes ou mais de 64 KiB; `409
  sharing.version_conflict` se a versão atual não bater -- o chamador relê e tenta de novo.

Autorização: `RequireAccountAccessMiddleware` em todas (rota `{accountId}`, sem guarda no
handler) -- `401` sem token/token inválido, `403 auth.forbidden` com token de outra conta (RFC 9110). `403
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
- Um envelope partilhado só é aceito se já existir vínculo `(paciente=accountId,
  profissional=peerAccountId)`, verificado sob o mesmo lock do `append` -- sem corrida com
  `Unlink`. Desvincular não apaga envelopes, só esconde a lista (404) até haver vínculo de novo
  entre as mesmas duas contas; revogar o compartilhamento é só uma troca do blob de preferências,
  nunca um apagão de envelopes já enviados.
- `PutPreferences` é concorrência otimista de um único contador: só grava se `expectedVersion`
  bater com a versão atual da conta (0 = nunca gravado), e sempre avança exatamente 1 no sucesso.
  Em conflito devolve a versão atual (não o motivo), para o chamador reler e tentar de novo --
  provado sob `Parallel.For` com o mesmo `expectedVersion` em
  `PatientLinkStoreTests.PutPreferences_ConcurrentSameExpectedVersion_ExactlyOneWins`.

## Armadilhas

- `ponytail`: lock global e tudo em memória; teto = reinício do processo perde vínculos e
  convites, exatamente como as contas de que dependem. Upgrade: tabela Postgres quando as contas
  saírem de `InMemoryAccountStore` (esboço de `patient_links` com RLS dupla em
  `.harness/abordagem/S11-04.md`, alternativa C2).
- `ponytail`: sem teto de itens partilhados por vínculo além da memória do processo. Upgrade:
  tabela junto com `patient_links` quando as contas saírem de memória.
- `Api.Platform.Result<TValue, TFailure>` relaxou a constraint de `TFailure` de `struct, Enum`
  para `struct` (S11-02) para que `PutPreferences` pudesse devolver
  `Result<SharingPreferences, long>` -- a razão de falha é o próprio número de versão atual, não
  um enum nomeado. Toda constraint anterior (`enum : struct, Enum`) continua satisfazendo
  `struct`, nenhum chamador existente muda de comportamento.
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
