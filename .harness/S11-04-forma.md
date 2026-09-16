# S11-04 · Forma — vínculo por código de uso único + par X25519 selado por conta

Decisões e alternativas: `.harness/abordagem/S11-04.md`. Cenário: `Specs/S11 Partilha e espelho P6.md` § Cenário E2E.

## 0. Migração

Nenhuma. Vínculos, convites e par de chaves vivem em memória, tal como as contas (abordagem (c)).
A `0011` fica livre. Não há DDL, grants nem RLS neste ticket.

## 1. API · contrato

```csharp
// Accounts/Sessions/Application/Ports/SessionTokenIssuerAuthorization.cs  (+, cópia literal do S09-03 @2420121)
public static JsonHttpResult<LimmiarProblemDetails>? AccountAccessProblem(string? authorizationHeader, Guid accountId, ISessionTokenIssuer issuer);
//   null = autorizado · 401 auth.access_token_invalid · 403 auth.forbidden
// Accounts/AccountsProblemResults.cs (+ ForbiddenProblem)   AccountsProblemCodes.cs (+ AuthForbidden, KeyPairNotFound, KeyPairPublicKeyConflict)

// Accounts/Domain/Account.cs  (+ último parâmetro)
public sealed record Account(..., VoiceEnrollment? VoiceEnrollment = null, AccountKeyPair? KeyPair = null);
// Accounts/Domain/AccountKeyPair.cs
public sealed record AccountKeyPair(byte[] PublicKey, byte[] WrappedDek, byte[] SealedPrivateKey);

// Accounts/KeyPair/AccountKeyPairService.cs
public enum PublishKeyPairFailure { AccountNotFound, PublicKeyConflict }
public sealed class AccountKeyPairService(IAccountStore accounts) {
  Task<Result<AccountKeyPair, PublishKeyPairFailure>> PublishAsync(Guid accountId, AccountKeyPair pair, CancellationToken ct); // mesma publicKey → substitui envelope
  Task<AccountKeyPair?> GetAsync(Guid accountId, CancellationToken ct);
}

// PatientLinks/PatientLink.cs
public sealed record PatientLink(Guid ProfessionalAccountId, Guid PatientAccountId, Guid PatientId, DateTimeOffset LinkedAt);
public sealed record LinkInvite(string Code, Guid ProfessionalAccountId, Guid PatientId, DateTimeOffset ExpiresAt);

// PatientLinks/PatientLinkStore.cs   (singleton, lock único, sem interface)
public enum RedeemFailure { InviteNotFound, AlreadyLinked }
public sealed class PatientLinkStore(Func<DateTimeOffset>? clock = null) {
  public static readonly TimeSpan InviteLifetime = TimeSpan.FromDays(7);
  LinkInvite CreateInvite(Guid professionalAccountId, Guid patientId);      // RandomNumberGenerator.GetString(Crockford32, 12)
  Result<PatientLink, RedeemFailure> Redeem(string code, Guid patientAccountId); // inválido|expirado|usado → InviteNotFound; consome só no sucesso
  IReadOnlyList<PatientLink> ListFor(Guid accountId);                       // lado profissional OU paciente
  bool Unlink(Guid accountId, Guid peerAccountId);                          // qualquer das partes; false = não existia
}
// ponytail: lock global e memória; teto = reinício perde vínculos (como as contas). Upgrade: tabela quando as contas forem para Postgres.

// PatientLinks/PatientLinkService.cs
public enum CreateInviteFailure { AccountNotFound, NotAuthorized }          // NotAuthorized = !CanCreatePatientRecords
public enum RedeemLinkFailure  { AccountNotFound, NotAPatient, InviteNotFound, AlreadyLinked }
public sealed class PatientLinkService(IAccountStore accounts, PatientLinkStore links) {
  Task<Result<LinkInvite, CreateInviteFailure>> CreateInviteAsync(Guid professionalId, Guid patientId, CancellationToken ct);
  Task<Result<LinkView, RedeemLinkFailure>>     RedeemAsync(Guid patientAccountId, string code, CancellationToken ct);
  Task<IReadOnlyList<LinkView>>                 ListAsync(Guid accountId, CancellationToken ct);
  bool                                          Unlink(Guid accountId, Guid peerAccountId);
}
public sealed record LinkView(Guid ProfessionalAccountId, Guid PatientAccountId, Guid PatientId, DateTimeOffset LinkedAt, byte[]? PeerPublicKey);
```

| Verbo · rota | Corpo → resposta | Estados |
|---|---|---|
| `PUT /accounts/{accountId}/key-pair` | `{publicKey(32), wrappedDek, sealedPrivateKey}` → — | 204 · 400 (`publicKey`≠32 bytes, blob < 28) · 401 · 403 · 404 conta · 409 outra `publicKey` |
| `GET /accounts/{accountId}/key-pair` | → `{publicKey, wrappedDek, sealedPrivateKey}` | 200 · 401 · 403 · 404 sem par |
| `POST /accounts/{accountId}/patients/{patientId}/link-invites` | — → `{code, expiresAt}` | 201 · 401 · 403 (token alheio, ou não é profissional ativa) · 404 conta |
| `POST /accounts/{accountId}/links` | `{code}` → `LinkView` | 201 · 400 `code` vazio · 401 · 403 (token alheio, ou não é paciente) · 404 `link.invite_not_found` · 409 `link.already_linked` |
| `GET /accounts/{accountId}/links` | → `LinkView[]` | 200 · 401 · 403 |
| `DELETE /accounts/{accountId}/links/{peerAccountId}` | — → — | 204 · 401 · 403 (token alheio) · 404 `link.not_found` (não há vínculo entre as duas contas) |

`409 already_linked` = já existe vínculo com a mesma `(profissional, conta da paciente)` ou `(profissional, patientId)`.
Sem rota de chave pública: a única resposta com a pública de outra conta é `LinkView.PeerPublicKey`.

## 2. Call trees

```
PUT key-pair ── AccountAccessProblem ─401/403─┐
             ├─ publicKey.Length==32, TryValidateSealedBlobShape×2 ─400
             └─ AccountKeyPairService.PublishAsync ─ accounts.FindById ─404
                  └─ existing?.PublicKey ≠ new ─409 │ accounts.UpdateAsync(account with {KeyPair}) ─204
GET key-pair ── AccountAccessProblem ── service.GetAsync ── null→404 │ 200
POST link-invites ── AccountAccessProblem ── service.CreateInviteAsync
                       ├─ accounts.FindById ─404 ├─ CanCreatePatientRecords ─403
                       └─ links.CreateInvite ─201
POST links ── AccountAccessProblem ── code vazio ─400 ── service.RedeemAsync
               ├─ accounts.FindById ─404 ├─ Role≠Patient ─403
               └─ links.Redeem (lock: vivo? duplicado? → grava, remove convite) ─404/409 │ ToView ─201
DELETE links/{peer} ── AccountAccessProblem ── service.Unlink ── links.Unlink ── false→404 │ 204
GET links ── AccountAccessProblem ── service.ListAsync ── links.ListFor ── ∀ peer: accounts.FindById(peer)?.KeyPair?.PublicKey ─200
```

## 3. App · contrato

```ts
// entities/vinculo/api.ts   (request() de shared/api; bytes em base64 como os outros blobs)
export interface ParDeChavesSelado { publicKey: Uint8Array; wrappedDek: Uint8Array; sealedPrivateKey: Uint8Array }
export interface Vinculo { profissionalAccountId: string; pacienteAccountId: string; patientId: string; vinculadoEm: string; chavePublicaDoPar: Uint8Array | null }
publicarParDeChaves(baseUrl, accountId, accessToken, par: ParDeChavesSelado): Promise<{ ok: true } | ProblemResult>
obterParDeChaves(baseUrl, accountId, accessToken): Promise<{ ok: true; par: ParDeChavesSelado } | ProblemResult>
criarConviteVinculo(baseUrl, accountId, accessToken, patientId): Promise<{ ok: true; codigo: string; expiraEm: string } | ProblemResult>
resgatarConviteVinculo(baseUrl, accountId, accessToken, codigo): Promise<{ ok: true; vinculo: Vinculo } | ProblemResult>
listarVinculos(baseUrl, accountId, accessToken): Promise<{ ok: true; vinculos: Vinculo[] } | ProblemResult>
desvincular(baseUrl, accountId, accessToken, outraContaId): Promise<{ ok: true } | ProblemResult>

// entities/vinculo/par-de-chaves.ts   (o módulo profundo do lado do cliente; o S11-02 importa daqui)
// GET → 200: unwrapDek+decrypt · 404: generateKeyPair → generateWrappedDek(kek, aad) → encrypt(dek, privada) → PUT · 409: GET outra vez
// AAD `limmiar/chave-x25519/v1|${accountId}`. A privada só existe em memória; nada vai para storage local.
export function garantirParDeChaves(p: { baseUrl: string; accountId: string; accessToken: string; kek: CryptoKey }):
  Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }>
```

```
router.tsx  /e2e/vinculo?baseUrl&accountId&accessToken&kek&papel&patientId   (atrás de VITE_ENABLE_E2E_TEST_ROUTES)
└─ E2eVinculoScaffold          importKek(kek) → por papel:
   ├─ GerarConviteVinculo      (Professional) mount: garantirParDeChaves → botão "Gerar código de vínculo" → mostra código + validade
   ├─ ResgatarConviteVinculo   (Patient)      mount: garantirParDeChaves → input "Código de vínculo" + "Vincular" → "Vinculada" | alerta 404/409
   └─ ambos: lista de vínculos com botão "Desvincular" por vínculo (DesvincularVinculo, um só componente partilhado)
```

Sem hook novo nem montagem em rota de produção: não há `KeychainProvider` (mesmo `ponytail:` de `/hoje`, `router.tsx:283`).

## 4. Seams de teste e fatias TDD

| Seam | Técnica | Prova |
|---|---|---|
| HTTP (`WebApplicationFactory`, fixture existente) | integração | estados da tabela §1, incluindo 401/403 em todas as rotas |
| `PatientLinkStore` (clock injetado) | unitário, sem Docker | uso único, expiração, corrida de dois resgates (`Parallel.For`, um só vence), 409 duplicado |
| `garantirParDeChaves` (fetch falso, KEK real de teste) | unitário vitest | 404→PUT com privada selada; 200→sem PUT; 409→adota a do servidor; nenhum corpo contém a privada |
| Playwright, 3 contextos + API | E2E | cada passo S11-04 do cenário |

1. **Vermelho primeiro:** `AccountKeyPairEndpointsTests.PutKeyPair_ThenGet_ReturnsSameEnvelope`. Verde: `AccountKeyPair`, serviço, endpoints, helper 401/403. Depois 400/401/403/404/409.
2. `PatientLinkStoreTests.Redeem_SameCodeTwice_SecondIsInviteNotFound` → expiração, corrida, `AlreadyLinked`, `Unlink` (qualquer parte; depois não lista; relink com código novo).
3. `PatientLinkEndpointsTests.InviteThenRedeem_BothSidesListLinkWithPeerPublicKey` → 403 não profissional ativa / não paciente / token alheio, 401, 404, 409; `Delete_ThenList_PeerKeyGone` → 404 repetido, 403, 401.
4. `par-de-chaves.test.ts` "gera, sela e publica quando o servidor não tem par" → restantes ramos; `vinculo/api.test.ts`.
5. `GerarConviteVinculo.test.tsx`, `ResgatarConviteVinculo.test.tsx`, `DesvincularVinculo.test.tsx`, `E2eVinculoScaffold.test.tsx`, rota; `lingui extract`.
6. `e2e/vinculo-chave-publica.spec.ts` (nomes no cenário) + `e2e/fixtures/contas.ts`; READMEs; ADR-S11-06.

## 5. ficheiros_previstos

```
apps/api/src/Api/Features/Accounts/Domain/Account.cs                       + KeyPair
apps/api/src/Api/Features/Accounts/Domain/AccountKeyPair.cs                 record do envelope
apps/api/src/Api/Features/Accounts/KeyPair/AccountKeyPairService.cs          publicar (pública imutável) e ler
apps/api/src/Api/Features/Accounts/KeyPair/AccountKeyPairEndpoints.cs        PUT/GET key-pair + records de fio
apps/api/src/Api/Features/Accounts/AccountsComposition.cs                   regista serviço e rotas
apps/api/src/Api/Features/Accounts/AccountsJsonContext.cs                   + 2 tipos
apps/api/src/Api/Features/Accounts/AccountsProblemCodes.cs                  + auth.forbidden, key_pair.*
apps/api/src/Api/Features/Accounts/AccountsProblemResults.cs                + ForbiddenProblem
apps/api/src/Api/Features/Accounts/Sessions/Application/Ports/SessionTokenIssuerAuthorization.cs  + AccountAccessProblem
apps/api/src/Api/Features/PatientLinks/PatientLink.cs                       PatientLink, LinkInvite
apps/api/src/Api/Features/PatientLinks/PatientLinkStore.cs                  convites e vínculos em memória
apps/api/src/Api/Features/PatientLinks/PatientLinkService.cs                papéis, resgate, LinkView com pública do par
apps/api/src/Api/Features/PatientLinks/PatientLinkEndpoints.cs              4 rotas
apps/api/src/Api/Features/PatientLinks/PatientLinksComposition.cs           AddPatientLinks/MapPatientLinks + JsonContext
apps/api/src/Api/Features/PatientLinks/PatientLinksProblemCodes.cs          link.invite_not_found, link.already_linked, link.not_found, link.not_authorized
apps/api/src/Api/Features/PatientLinks/README.md                            novo
apps/api/src/Api/Program.Composition.cs                                     AddPatientLinks/MapPatientLinks
apps/api/tests/Api.Tests/Accounts/AccountKeyPairEndpointsTests.cs
apps/api/tests/Api.Tests/PatientLinks/PatientLinkStoreTests.cs
apps/api/tests/Api.Tests/PatientLinks/PatientLinkEndpointsTests.cs
apps/api/README.md · ARCHITECTURE.md                                        índice
apps/app/src/entities/vinculo/{api,api.test,par-de-chaves,par-de-chaves.test}.ts
apps/app/src/entities/vinculo/README.md
apps/app/src/features/vinculo/{GerarConviteVinculo,ResgatarConviteVinculo,DesvincularVinculo}{,.test}.tsx
apps/app/src/features/vinculo/README.md
apps/app/src/app/routing/{E2eVinculoScaffold,E2eVinculoScaffold.test}.tsx · router.tsx
apps/app/src/locales/{pt-BR,en-US,es-419,it-IT}/messages.po
apps/app/e2e/vinculo-chave-publica.spec.ts · apps/app/e2e/fixtures/contas.ts
docs/adr/ADR-S11-06-par-x25519-estatico-por-conta.md
```

## 6. READMEs

- `Features/PatientLinks/README.md` (novo): responsabilidade (vínculo 1:1 profissional-paciente, sem equipa);
  invariantes (código de uso único, 60 bits, TTL 7 d; só uma paciente resgata; a pública do par só sai em
  `GET links` de quem é parte); memória com o mesmo teto das contas; fora de âmbito (validar
  `patientId` contra o prontuário, persistência).
- `apps/api/README.md`: item `PatientLinks` e sub-fatia `Accounts/KeyPair` (pública imutável, envelope substituível).
- `ARCHITECTURE.md`: uma linha de índice para `PatientLinks`.
- `entities/vinculo/README.md`: `garantirParDeChaves` é a única porta para a privada; AAD; nunca em storage local.
- `features/vinculo/README.md`: os dois ecrãs, sem montagem de produção até existir `KeychainProvider`.

## Decisões do humano (2026-09-14)

1. Forma aprovada como está.
2. O ADR da privada selada no servidor é o **ADR-S11-06**, porque o S11-05 já está reservado para "apagar check-ins no logout".
3. **Desvincular entra no S11-04.** Qualquer das partes pode desvincular. Desvincular não mexe nos pares de chaves nem no que já foi partilhado. Cenário: passos 14 e 15.
