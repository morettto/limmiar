# S11-03 · Forma: espelho P6 da profissional

Ticket: `Tickets/S11-03 Espelho P6 do profissional.md`. Regras: `Specs/S11 Partilha e espelho P6.md` (ADR-S11-01, ADR-S11-02, casos de borda).
Constrói sobre `features/partilha/CheckInsPartilhados.tsx` (S11-02), que já recebe e decifra. Nada toca na API.

## 0. Migração e API

> **Superado pela §5** (decisões do humano, 2026-09-15). As fatias 1–4 não tocam na API. As fatias 5–12 trazem as migrações `0010`/`0011`, contas em Postgres e a rota nova `GET /accounts/{accountId}/received-shares`. `GET links` e `GET shared-items` ficam intactos.

Nenhuma. **Zero mudança de contrato**, por isso sem domínio dotnet:
- sinais: `GET /accounts/{id}/links/{peer}/shared-items` (S11-02), já existe;
- sessões: `GET /accounts/{id}/agenda/sessions?from&to` (`SchedulingEndpoints.cs:35`, janela máx. 7 d `:13`), já existe;
- adoção: calculada no cliente só sobre o que foi partilhado. O servidor não conta nada (uma contagem de check-ins não partilhados seria metadado não partilhado a cruzar a fronteira, o que viola o critério 2).

## 1. Decisões

| Pergunta | Decisão | Porquê |
|---|---|---|
| Onde P6 monta | `CheckInsPartilhados.tsx` passa a `EspelhoP6.tsx` (git mv) em `features/partilha`. Continua só em `/e2e/partilha?papel=profissional` | Não existe página de paciente do lado da profissional nem `KeychainProvider` (`router.tsx:39`, ponytail). É o único ecrã da profissional e já tem a cadeia garantirParDeChaves → listarVinculos → listar → decifrar |
| Sessões da semana | `listarSessoes` (`entities/agenda/api.ts:8`) numa só chamada, com a janela `[meia-noite local de hoje−6, meia-noite de amanhã)`. Filtra por `sessao.patientId === vinculo.patientId` e agrupa por `diaLocal(new Date(inicioEm))` | O `patientId` do vínculo (S11-04) é o mesmo id de registo que a agenda usa. Um pedido por conta, não por vínculo |
| Adoção | `diasComCheckIn` = entradas não nulas de `serieComLacunas(...)` → "Check-in compartilhado em N de 7 dias" | Função só dos itens decifrados. Ver pergunta 1 |
| Revogado após decifrar continua visível | Os envelopes persistem em Postgres (`shared_items`, só ciphertext, `GRANT` sem `UPDATE`/`DELETE`) e sobrevivem à **revogação** (só troca o blob de preferências) e à **desvinculação** (`unlinked_at` soft). A partir da fatia 11, P6 lê `GET /accounts/{id}/received-shares`, que inclui os pares desfeitos com `unlinkedAt`. Nada entra depois do desvínculo (`Share` exige a linha ativa sob `FOR SHARE`). P6 relê em cada montagem. **Sem cache local** (§5) | O servidor retém de forma durável o que já retinha. Um cache local guardaria dados de saúde decifrados em repouso no dispositivo, com resultado igual |
| Item posterior à revogação nunca aparece | Já garantido: `partilharCheckIn` não faz POST sem destinatário (S11-02, prova por propriedade). P6 só prova o lado da leitura | Não é lógica nova |
| Lacunas | `serieComLacunas` (`entities/checkin/checkin.ts:30`), que nunca interpola e em que o último por dia vence. `ultimoPorDia` (`CheckInsPartilhados.tsx:27`) é **apagado** | Reuso: faz o mesmo `Map` por dia |
| "Levados para a sessão" | **Fora.** Não existe tipo partilhável nem entidade (`TipoPartilhavel = 'checkin'`; grep `levar\|pauta` = 0) | A spec põe-no em "ticket próprio, fecha a spec". Ver pergunta 3 |
| Falha da agenda | Isolada: sinais e adoção aparecem na mesma, sem marcas, e surge um `role="alert"` próprio "Não foi possível carregar as sessões." Falha de chaves, vínculos ou decifra continua fail-closed (tudo cai) | O mesmo padrão por fonte do `PainelProfissional` (README §2). Uma sessão em falta não pode esconder os sinais |

## 2. Contrato

```ts
// features/partilha/espelho.ts   (novo, puro, sem React; conhece CheckIn + SessaoAgendada, permitido em features/)
export interface DiaDoEspelho { dia: DiaLocal; checkin: CheckIn | null; sessoes: readonly SessaoAgendada[] }
export interface Espelho { dias: readonly DiaDoEspelho[]; diasComCheckIn: number }   // dias.length === 7, do mais antigo a hoje
export const DIAS_ESPELHO = 7
export function montarEspelho(p: { checkins: readonly CheckIn[]; sessoes: readonly SessaoAgendada[]; patientId: string; hoje: DiaLocal }): Espelho
//   dias = serieComLacunas(checkins, hoje, 7) + sessoes filtradas por patientId e diaLocal(inicioEm)
//   checkins fora da janela são ignorados · sessões de outro patientId nunca entram
export function janelaDoEspelho(agora: Date): { de: Date; ate: Date }
//   de = new Date(a, m, d-6) · ate = new Date(a, m, d+1)   (campos locais, como diasAntes)
// ponytail: numa semana com mudança de hora a janela tem 7 d ± 1 h e a API dá 400 (MaxListWindow). O Brasil não tem horário de verão. Upgrade: ate = min(ate, de + 7 d).

// features/partilha/EspelhoP6.tsx   (era CheckInsPartilhados.tsx)
export interface EspelhoP6Props { baseUrl: string; accountId: string; accessToken: string; kek: CryptoKey; agora?: Date }
//   Carga = carregando | erro | pronta { grupos: { vinculo; espelho: Espelho }[]; sessoesFalharam: boolean }

// app/routing/E2ePartilhaScaffold.tsx:42-46   papel=profissional → <EspelhoP6 … agora={agora === '' ? undefined : new Date(agora)} />
```

## 3. Árvore e call tree

```
E2ePartilhaScaffold (papel=profissional, agora)
└─ EspelhoP6                                    mount, agora ?? new Date()
   ├─ garantirParDeChaves ─lança→ alert geral
   ├─ listarVinculos ─!ok→ alert geral          filtro: sou a profissional e há pública do par
   ├─ listarSessoes(janelaDoEspelho(agora)) ─!ok/lança→ sessoes=[], sessoesFalharam
   │    (em paralelo com os grupos: Promise.all, com o .catch só na agenda)
   └─ ∀ vínculo: listarItensPartilhados → decifrarItem (tipo≠checkin → lança) → montarEspelho
render ∀ grupo:
   <section><h2>{patientId}</h2>
     <p>Check-in compartilhado em {n} de 7 dias</p>
     <ol aria-label="Últimos 7 dias">
       <li>{dia}: {sono}/{ansiedade} · {frase}  |  {dia}: sem check-in</li>   ← lacuna explícita
         + ∀ sessão do dia: " · Sessão às {horaDaSessao(inicioEm, i18n.locale)}"
   sessoesFalharam → <p role="alert">Não foi possível carregar as sessões.</p>
```

(A partir da fatia 11, `listarVinculos` + `listarItensPartilhados` são substituídos por uma só chamada, `listarPartilhasRecebidas`. Ver §5.5.)

Texto pt-BR (id do macro Lingui, `lingui extract` e os 4 `.po`): "Check-in compartilhado em {n} de 7 dias", "Últimos 7 dias", "sem check-in", "Sessão às {hora}", "Não foi possível carregar as sessões.". Os textos atuais de erro e de "Nenhum check-in compartilhado." (sem vínculos) ficam.

## 4. Seams de teste e fatias TDD

| Seam | Técnica | Prova |
|---|---|---|
| `montarEspelho` / `janelaDoEspelho` (puras) | unitário | 7 dias; lacuna = null; sessão no dia certo; outro `patientId` fora; checkin fora da janela ignorado; `diasComCheckIn`; janela = 7 × 24 h num fuso sem mudança de hora |
| `EspelhoP6` (`vi.mock` das 4 entidades, como em `CheckInsPartilhados.test.tsx:13-24`) | componente | critérios 1-3 no DOM; agenda a falhar ≠ sinais a falhar; `listarSessoes` chamado com a janela |
| Playwright, 2 contextos + API real; **só** `agenda/sessions` com stub via `martaPage.route` | E2E | critérios 1-3 ponta a ponta sobre os passos 6-8 já semeados |

A agenda leva stub no E2E porque a suíte não tinha Postgres (`playwright.config.ts:43`). A partir da fatia 6 passa a ter, e o stub fica porque é mais barato e determinista do que semear uma sessão. Tudo o resto (contas, vínculo, chaves, envelopes) é real.

1. **Vermelho primeiro:** `espelho.test.ts` "um dia sem check-in partilhado é lacuna, nunca interpolado". Verde: `montarEspelho`. Depois "sessão de outro paciente não marca a linha do tempo", "sessão cai no dia local de inicioEm", "diasComCheckIn conta só dias com item", "janelaDoEspelho cobre hoje−6 até ao fim de hoje".
2. `git mv` CheckInsPartilhados → EspelhoP6 (e o teste). Vermelho: `EspelhoP6.test.tsx` "mostra 7 dias com lacunas e a sessão marcada no dia". Depois:
   - "adoção conta só os dias com item partilhado" (listar devolve 2 dias → "em 2 de 7 dias"; nenhuma outra chamada de rede além das 4 mockadas);
   - "item revogado já partilhado continua visível e dia posterior é lacuna" (`agora` = amanhã, listar devolve só hoje);
   - "falha da agenda mostra sinais e alerta de sessões";
   - os testes S11-02 que ficam (alert em falha de par, vínculos ou envelope ≠ checkin; sem vínculos).
3. `E2ePartilhaScaffold.test.tsx:22,79` renomeia o mock e afirma que `agora` chega à EspelhoP6. `lingui extract`.
4. `e2e/partilha-checkin.spec.ts`:
   - teste 7 (`:142-149`): `getByRole('listitem')` passa a 7. Afirmar pelo `li` que contém `fraseHoje` e `3/2`;
   - **teste 9 novo**, depois do 8: `a profissional vê em P6 o check-in de hoje que a paciente revogou depois, amanhã como lacuna, a sessão marcada e a adoção só do que foi partilhado`. A Marta abre com `agora=amanhã` e a rota de agenda com stub (`[{sessionId, patientId: <patientId do convite>, startsAt: agora real, durationMinutes: 50}]`). Afirma: `li` de hoje com `fraseHoje` e "Sessão às"; `li` de amanhã com "sem check-in"; `fraseAmanha` ausente da página; "Check-in compartilhado em 1 de 7 dias". Para isso, o `patientId` do `beforeAll` (`:66`) passa a variável.

## 5. Persistência Postgres (decisão do humano 2026-09-15)

Abordagem: `.harness/abordagem/S11-03.md`:
- **A1:** Npgsql nas classes que já existem;
- **B1:** contas com RLS por chave de procura, verifiers em SHA-256, FKs e `account_key_pairs` em tabela própria;
- **C1:** `unlinked_at`;
- **(d):** GUC do código de convite;
- **E1:** `received-shares`.

Sem ADR.

- `me` = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`, a conta que age (ou a conta alvo, em `accounts`), via `OpenTenantScopedTransactionAsync`.
- Idempotente, porque o runner reaplica tudo em cada arranque: `IF NOT EXISTS`, `DROP POLICY IF EXISTS` + `CREATE POLICY`.
- Expand puro. Rollback = binário anterior, que ignora as tabelas (as contas voltam a viver só em memória).

### 5.1 DDL

```sql
-- 0010_create_accounts.sql
accounts        id uuid PK, email text NN UNIQUE, role text NN CHECK (role IN ('Professional','Patient')),
                password_verifier_sha256 bytea CHECK (octet_length = 32), google_subject_id text,
                verification_status text NN CHECK (IN ('Pending','InReview','Active','Rejected')), rejection_reason text,
                verification_submitted_at timestamptz, totp_secret text, totp_enabled_at timestamptz, totp_backup_code_hashes text[],
                webauthn_credential_id bytea, webauthn_cose_public_key bytea, webauthn_sign_count bigint, webauthn_aaguid uuid,
                recovery_verifier_sha256 bytea CHECK (octet_length = 32), voice_wrapped_dek bytea, voice_sealed_embedding bytea,
                CHECK ((voice_wrapped_dek IS NULL) = (voice_sealed_embedding IS NULL)), created_at timestamptz NN DEFAULT now()
  FOR SELECT USING (id = me OR email = NULLIF(current_setting('app.account_email', true), '')
                    OR (current_setting('app.staff_review', true) = 'on' AND role = 'Professional' AND verification_status = 'InReview'))
  FOR INSERT WITH CHECK (id = me) · FOR UPDATE USING/CHECK (id = me)
  GRANT SELECT, INSERT, UPDATE (todas menos id, email, created_at)       -- email imutável por privilégio; sem DELETE
account_key_pairs  account_id uuid PK FK→accounts, public_key bytea NN CHECK (=32), wrapped_dek bytea NN, sealed_private_key bytea NN (≥28),
                   published_at, updated_at timestamptz NN DEFAULT now()
  FOR ALL USING/CHECK (account_id = me)   · GRANT SELECT, INSERT, UPDATE (wrapped_dek, sealed_private_key, updated_at)   -- public_key imutável
-- 0011_create_patient_links_and_sharing.sql
patient_link_invites  code text PK CHECK (~ '^[0-9A-HJKMNP-TV-Z]{12}$'), professional_account_id uuid NN FK→accounts, patient_id uuid NN,
                      expires_at timestamptz NN, created_at timestamptz NN DEFAULT now()
  FOR SELECT/DELETE USING (professional_account_id = me OR code = NULLIF(current_setting('app.invite_code', true), ''))
  FOR INSERT WITH CHECK (professional_account_id = me)                     GRANT SELECT, INSERT, DELETE
patient_links   id uuid PK DEFAULT gen_random_uuid(), professional_account_id uuid NN FK→accounts, patient_account_id uuid NN FK→accounts,
                patient_id uuid NN, linked_at timestamptz NN, unlinked_at timestamptz,
                CHECK (professional_account_id <> patient_account_id), CHECK (unlinked_at IS NULL OR unlinked_at >= linked_at)
  UNIQUE (professional_account_id, patient_account_id) WHERE unlinked_at IS NULL · UNIQUE (professional_account_id, patient_id) WHERE unlinked_at IS NULL
  INDEX (patient_account_id)
  FOR SELECT/UPDATE USING/CHECK (professional_account_id = me OR patient_account_id = me) · FOR INSERT WITH CHECK (patient_account_id = me)
  GRANT SELECT, INSERT, UPDATE (unlinked_at)
shared_items    id bigint GENERATED ALWAYS AS IDENTITY PK, patient_account_id uuid NN FK→accounts, professional_account_id uuid NN FK→accounts,
                shared_at timestamptz NN, ciphertext bytea NN CHECK (octet_length BETWEEN 28 AND 65536)
  INDEX (professional_account_id, patient_account_id, id)                  -- sem FK a patient_links: sobrevive ao desvínculo
  FOR SELECT USING (professional_account_id = me) · FOR INSERT WITH CHECK (patient_account_id = me) · GRANT SELECT, INSERT
sharing_preferences  account_id uuid PK FK→accounts, version bigint NN CHECK (>= 1), wrapped_dek bytea NN, ciphertext bytea NN (28..65536),
                     updated_at timestamptz NN DEFAULT now()
  FOR ALL USING/CHECK (account_id = me) · GRANT SELECT, INSERT, UPDATE (version, wrapped_dek, ciphertext, updated_at)
account_key_pairs  + política permissiva FOR SELECT key_pair_ever_linked_read: EXISTS (SELECT 1 FROM patient_links l WHERE
                   (l.professional_account_id = me AND l.patient_account_id = account_id) OR (l.patient_account_id = me AND l.professional_account_id = account_id))
-- todas: ENABLE + FORCE. RowLevelSecurityCoverageTests cobre-as sem alteração.
```

### 5.2 Assinaturas C# e rota nova

```csharp
// Accounts
public sealed class PostgresAccountStore(NpgsqlDataSource dataSource) : IAccountStore     // IAccountStore inalterada
//   FindById/Insert/Update → OpenTenantScopedTransactionAsync(id) · FindByEmail → set_config('app.account_email')
//   ListPendingDocumentReview → set_config('app.staff_review','on')
// InMemoryAccountStore: git mv → tests/Api.Tests/Fakes/ (fake da porta). Account.KeyPair: APAGADO
public sealed class AccountKeyPairService(IAccountStore accounts, NpgsqlDataSource dataSource)   // PublishAsync/GetAsync iguais; SemaphoreSlim APAGADO
// ConstantTimePasswordVerifierComparer.Matches(submitted, stored) => FixedTimeEquals(SHA256.HashData(submitted), stored)
// RegisterHandler, RegisterRecoveryVerifierHandler guardam SHA256.HashData(verifier)   (Dummy continua com 32 bytes)
// NpgsqlDataSourceFactory: builder.EnableArrays()   (text[] no slim builder)

// PatientLinks (ctor: NpgsqlDataSource dataSource, Func<DateTimeOffset>? clock = null)
Task<LinkInvite>                        CreateInviteAsync(Guid professionalAccountId, Guid patientId, CancellationToken ct)
Task<Result<LinkView, RedeemFailure>>   RedeemAsync(string code, Guid patientAccountId, CancellationToken ct)
Task<IReadOnlyList<LinkView>>           ListForAsync(Guid accountId, CancellationToken ct)          // só ativos; LEFT JOIN account_key_pairs
Task<bool>                              UnlinkAsync(Guid accountId, Guid peerAccountId, CancellationToken ct)   // SET unlinked_at
Task<bool>                              ShareAsync(Guid patientAccountId, Guid professionalAccountId, byte[] ciphertext, CancellationToken ct)
Task<IReadOnlyList<SharedItem>?>        ListSharedAsync(Guid professionalAccountId, Guid patientAccountId, CancellationToken ct)  // null sem vínculo ATIVO (404 igual)
Task<IReadOnlyList<ReceivedShare>>      ListReceivedSharesAsync(Guid professionalAccountId, CancellationToken ct)                  // novo
Task<SharingPreferences?>               GetPreferencesAsync(Guid accountId, CancellationToken ct)
Task<Result<SharingPreferences, long>>  PutPreferencesAsync(Guid accountId, long expectedVersion, byte[] wrappedDek, byte[] ciphertext, CancellationToken ct)
public sealed record ReceivedShare(Guid PatientAccountId, Guid PatientId, DateTimeOffset LinkedAt, DateTimeOffset? UnlinkedAt, byte[]? PeerPublicKey, IReadOnlyList<SharedItem> Items);
// LinkView igual (move para PatientLink.cs). PatientLink record e PatientLinkService.ToViewAsync: APAGADOS (join no store)
```

```
GET /accounts/{accountId}/received-shares            name ListReceivedShares, em SharedItemEndpoints
200 [{ patientAccountId, patientId, linkedAt, unlinkedAt: string|null, peerPublicKey: base64|null,
       items: [{ sharedAt, ciphertext }] }]           um por paciente (linha mais recente do par: DISTINCT ON … ORDER BY linked_at DESC),
                                                      items de todas as linhas do par por id; [] se nenhum. Nunca 404
401 sem token / token inválido · 403 auth.forbidden token de outra conta   (RequireAccountAccessMiddleware, RFC 9110)
```

```ts
// entities/partilha/api.ts
export interface PartilhaRecebida { pacienteAccountId: string; patientId: string; vinculadoEm: string; desvinculadoEm: string | null;
                                    chavePublicaDoPar: Uint8Array<ArrayBuffer> | null; itens: { partilhadoEm: string; ciphertext: Uint8Array<ArrayBuffer> }[] }
export function listarPartilhasRecebidas(baseUrl, accountId, accessToken): Promise<{ ok: true; partilhas: PartilhaRecebida[] } | ProblemResult>
// listarItensPartilhados: APAGADA do front (único consumidor era EspelhoP6); a rota fica
// EspelhoP6: garantirParDeChaves → listarPartilhasRecebidas → filtro chavePublicaDoPar !== null → decifrarItem → montarEspelho
//            Grupo = { partilha: PartilhaRecebida; espelho }. Deixa de importar listarVinculos
```

Consumidores afectados:
- **Composição:** `AccountsComposition.cs:9,21` e `NpgsqlDataSourceFactory.cs`.
- **Verifiers:** `RegisterHandler.cs`, `RegisterRecoveryVerifierHandler.cs`, `ConstantTimePasswordVerifierComparer.cs`.
- **PatientLinks:** `PatientLinkService.cs` (4 chamadas), `PatientLinkEndpoints.HandleUnlink` (passa a async), os 4 handlers de `SharedItemEndpoints.cs` (async), `PatientLinksJsonContext` (+`ReceivedShareView`).
- **Front:** `EspelhoP6.tsx` e `entities/partilha/api.ts`.
- **Inalterados:** os outros 17 consumidores de `IAccountStore` (a porta é a mesma).

### 5.3 Exactly-one-wins

| Garantia | Hoje | Passa a |
|---|---|---|
| Email único no registo | `FindByEmail` + `Insert` (a corrida sobrescreve) | `UNIQUE (email)`. A corrida dá 500 e nunca duplica. ponytail: mapear para `EmailAlreadyRegistered` se aparecer |
| Redeem do mesmo código | `lock` | `set_config('app.invite_code')` → `DELETE … WHERE code AND expires_at > @now RETURNING` → `INSERT patient_links`. `23505` → rollback → `AlreadyLinked` |
| Share × Unlink | `lock` | `SELECT … unlinked_at IS NULL FOR SHARE` + `INSERT` na mesma transação |
| PutPreferences CAS | `lock` | `expected=0`: `INSERT … ON CONFLICT DO NOTHING RETURNING` · `>0`: `UPDATE … WHERE version=@e RETURNING`. Sem linha → versão atual = Failure |
| Publish do par | `SemaphoreSlim` (um processo) | `INSERT … ON CONFLICT (account_id) DO UPDATE … WHERE public_key = EXCLUDED.public_key RETURNING`. Sem linha → `PublicKeyConflict` |

### 5.4 Seams

| Seam | Técnica |
|---|---|
| `PostgresContainerFixture.NewDatabaseAsync()` → `CREATE DATABASE t_<guid> TEMPLATE limmiar_template` (migrada 1×, sem ligações) | uma base isolada por factory, os emails literais ficam |
| `PostgresAccountStore`, `PatientLinkStore`, `AccountKeyPairService` sobre essa base (`app_role`) | integração real; concorrência com `Task.WhenAll` |
| `AccountsRlsTests`, `PatientLinksRlsTests`: SQL cru como `app_role` | sem chave → 0 contas; staff só em revisão; terceira conta → 0 linhas; código errado → 0 convites |
| Os ~16 `*EndpointsTests` que sobem a app: `UseSetting("ConnectionStrings:AppDb", await fixture.NewDatabaseAsync())` + `[Collection("Database")]` | HTTP |
| `InMemoryAccountStore` (fake em `tests/`) | unitários de handlers e serviços, sem mudança |
| `entities/partilha/api.test.ts`, `EspelhoP6.test.tsx` | frontend |

### 5.5 Fatias TDD (vermelho primeiro)

5. **Hash dos verifiers** (antes de qualquer conta chegar à base). 🔴 `AccountServiceTests.Register_StoresSha256OfVerifier_NotTheVerifier`. Depois `Login…MatchesAgainstHash`, `RecoverAccess…MatchesAgainstHash`.
6. **Contas e pares de chaves em Postgres** (`0010`, fixture template, E2E com Postgres §5.6). 🔴 `PostgresAccountStoreTests.InsertThenFindByEmail_FromANewStoreInstance_ReturnsEveryField` (inclui `text[]` e voz). Depois:
   - `AccountsRlsTests.WithoutLookupKey_SeesNoAccounts`, `…StaffReview_SeesOnlyInReviewProfessionals`;
   - `AccountKeyPairServiceTests.PublishAsync_TwoConcurrentDifferentKeys_ExactlyOneWins` e `…VoiceEnrollmentUpdateAfterPublish_KeepsThePair`;
   - composição e os ~16 factories; apagar `InMemoryAccountStoreTests`.
7. **`0011` + RLS das 4 tabelas.** 🔴 `PatientLinksRlsTests.ThirdAccount_SeesNoRowsInAnyTable`. Depois `PatientWithWrongCode_SeesNoInvites`, `PeerPublicKey_VisibleOnlyToEverLinkedAccount`.
8. **Preferências.** 🔴 `PutPreferencesAsync_ConcurrentSameExpectedVersion_ExactlyOneWins`.
9. **Convites e vínculos.** 🔴 `RedeemAsync_TwoConcurrentAttemptsOnSameCode_ExactlyOneWins`. Depois:
   - AlreadyLinked ×2 via índice e expiração com relógio;
   - `ListForAsync_ExcludesUnlinked` e `…IncludesPeerPublicKeyViaJoin`;
   - apagar `PatientLinkEndpointsTests:299`, que a FK torna impossível.
10. **Envelopes e rota nova.** 🔴 `ListReceivedSharesAsync_AfterUnlink_ReturnsPriorItemsWithUnlinkedAt`. Depois:
    - `ShareAsync_AfterUnlink_ReturnsFalse`;
    - `ListShared_AfterUnlink_Returns404` continua verde;
    - endpoint `ReceivedShares_AfterPatientUnlinks_Returns200WithUnlinkedAt`, `…OnlyPairsWhereCallerIsProfessional`, `…WithTokenOfAnotherAccount_Returns403`.
11. **Front.** 🔴 `entities/partilha/api.test.ts` "listarPartilhasRecebidas decodifica unlinkedAt nulo ou data, chave e itens". Depois:
    - `EspelhoP6.test.tsx` "paciente desvinculada continua no espelho com o que partilhou antes";
    - os mocks passam a `listarPartilhasRecebidas`, e "uma só chamada além de chaves e agenda";
    - apagar `listarItensPartilhados` e o seu teste.
12. **E2E teste 10**, depois do 9: 🔴 "a paciente desvincula e a profissional continua a ver em P6 o check-in de hoje". READMEs: `Accounts`, `PatientLinks`, `apps/api` (Platform/Data e o teste de template), `entities/partilha`, `features/partilha`, e a consequência final do ADR-S11-06.

### 5.6 Impacto no E2E, CI e deploy

- **`playwright.config.ts:41-51`:**
  - o comando passa a `dotnet run --no-launch-profile --project … -- --migrate-only && dotnet run --no-launch-profile --project …`;
  - env `ConnectionStrings__AdminDb=Host=127.0.0.1;…;Username=postgres;Password=postgres` e `AppDb` com `Username=app_role;Password=limmiar_e2e`;
  - `url` passa a `/health/db`.
- **`deploy.yml`:** `services: postgres: image postgres:17-alpine` (`POSTGRES_DB=limmiar_e2e`, `POSTGRES_PASSWORD=postgres`, porta 5432) antes de `test:e2e`. Localmente, quem corre o Playwright precisa de um Postgres igual.
- **Emails:** já são aleatórios, por isso não há limpeza entre corridas. A fila de staff acumula profissionais em revisão entre corridas locais, e os testes filtram por id.
- **`quality-gates.yml` `api-tests`:** sem mudança, já tem Docker. Fica mais lento: um `CREATE DATABASE` por factory e as classes do `Database` em série.
- **`pact-provider-verify` e `api-aot-publish`:** sem mudança. O `EnableArrays()` do slim builder é AOT-safe.
- **Fly:** a migração corre no `release_command` que já existe (`--migrate-only`).

### 5.7 Ficheiros

```
apps/api/migrations/{0010_create_accounts,0011_create_patient_links_and_sharing}.sql
apps/api/src/Api/Platform/Data/NpgsqlDataSourceFactory.cs                     EnableArrays
apps/api/src/Api/Features/Accounts/{AccountsComposition, Infrastructure/PostgresAccountStore(novo), Domain/Account, KeyPair/AccountKeyPairService,
  Credentials/{Register/RegisterHandler, Infrastructure/ConstantTimePasswordVerifierComparer}, Recovery/…/RegisterRecoveryVerifierHandler}.cs, README.md
apps/api/src/Api/Features/PatientLinks/{PatientLinkStore,PatientLink,PatientLinkService,PatientLinkEndpoints,SharedItemEndpoints,PatientLinksJsonContext}.cs, README.md
apps/api/tests/Api.Tests/Infrastructure/PostgresContainerFixture.cs          NewDatabaseAsync + template
apps/api/tests/Api.Tests/Fakes/InMemoryAccountStore.cs                        git mv de src
apps/api/tests/Api.Tests/{Accounts/PostgresAccountStoreTests(novo), Rls/{AccountsRlsTests,PatientLinksRlsTests}(novos)}.cs + ~16 *EndpointsTests
apps/app/src/entities/partilha/{api.ts,api.test.ts,README.md} · features/partilha/{EspelhoP6.tsx,EspelhoP6.test.tsx,README.md}
apps/app/{playwright.config.ts, e2e/partilha-checkin.spec.ts} · .github/workflows/deploy.yml · docs/adr/ADR-S11-06 (consequência final)
```

### 5.8 Perguntas ao humano

Nenhuma bloqueante. Os riscos aceites estão em §8.

### Decisões pós-forma (humano, 2026-09-15)

1. **Verifier (fatia 5).** Confirmado antes de escrever: o verifier já sai de uma KDF lenta no
   cliente -- Argon2id via `@noble/hashes` (`packages/crypto/src/argon2id.ts`), consumido por
   `apps/app/src/entities/account/password-verifier.ts:8` e `recovery-verifier.ts:8` com
   `ACCOUNT_VERIFIER_PARAMS`. Por isso a base guarda `SHA256(verifier)`, não PBKDF2 nem outra KDF
   do lado do servidor -- um hash rápido por cima de uma saída já de alta entropia basta para um
   dump não servir de login, e evita pagar o custo de uma segunda KDF lenta em cada pedido.
   `ConstantTimePasswordVerifierComparer.Matches` faz `FixedTimeEquals(SHA256.HashData(submitted),
   stored)`; os dois writers (`RegisterHandler`, `RegisterRecoveryVerifierHandler`) guardam o hash.
2. **TOTP cifrado.** `totp_secret` passa a AES-GCM (`System.Security.Cryptography.AesGcm`, nonce
   de 12 bytes aleatório por cifra, guardado junto do ciphertext e da tag) em vez de claro. Chave
   da aplicação por configuração (`Totp__EncryptionKey`, base64 de 32 bytes); arranque falha
   fechado se a chave faltar ou tiver o tamanho errado fora de testes. Documentado nos secrets de
   deploy do `fly/README` sem valores.

## 6. ficheiros_previstos

```
apps/app/src/features/partilha/espelho.ts                   montarEspelho, janelaDoEspelho (novo)
apps/app/src/features/partilha/espelho.test.ts
apps/app/src/features/partilha/EspelhoP6.tsx                git mv de CheckInsPartilhados.tsx + agenda + render P6
apps/app/src/features/partilha/EspelhoP6.test.tsx           git mv de CheckInsPartilhados.test.tsx
apps/app/src/features/partilha/README.md                    EspelhoP6, invariantes P6
apps/app/src/app/routing/E2ePartilhaScaffold.tsx            profissional → EspelhoP6 com agora
apps/app/src/app/routing/E2ePartilhaScaffold.test.tsx
apps/app/src/app/routing/README.md                          linha 43
apps/app/src/locales/{pt-BR,en-US,es-419,it-IT}/messages.po
apps/app/e2e/partilha-checkin.spec.ts                       teste 7 ajustado + teste 9
ARCHITECTURE.md                                             linha 8: CheckInsPartilhados → EspelhoP6
```

Fatias 5–12: ver §5.7.

## 7. READMEs

- `features/partilha/README.md`: `EspelhoP6` substitui a entrada `CheckInsPartilhados`. Invariantes novos:
  - lacuna explícita, via `serieComLacunas`;
  - adoção só sobre itens decifrados, sem contagem vinda do servidor;
  - "revogado continua visível" depende de o servidor nunca apagar envelopes, e P6 não guarda cache local de propósito;
  - a falha da agenda é isolada, a das chaves e envelopes é fail-closed.
- `entities/checkin`, `entities/agenda`: sem mudança. `Accounts`, `PatientLinks`, `entities/partilha`: ver §5.5 fatia 12.

## 8. Riscos

- ~~**Desvincular esconde P6 inteiro**~~ **Resolvido pela §5**: envelopes em Postgres, `unlinked_at` soft e P6 sobre `received-shares`.
- **Meia-noite no E2E:** `startsAt` = agora real e o dia de hoje calculado no browser. Uma corrida que atravesse a meia-noite pode falhar. É o mesmo risco que o teste 8 já tem com `amanha`.
- **Sessão sem vínculo:** uma sessão agendada para um registo sem conta ligada não aparece em P6. Não há grupo para ela e isso está certo, porque não há sinais.
- **ADR:** nenhum. Nada é difícil de reverter: trocar a definição de adoção ou juntar um cache é local a `espelho.ts` e `EspelhoP6.tsx`. Persistência: ver `.harness/abordagem/S11-03.md`.
- **Retenção:** os envelopes não têm caminho de apagar (`GRANT` sem `DELETE`). Um pedido de eliminação LGPD precisa de um ticket próprio.
- **RLS de `accounts` só impede enumerar.** Quem tem um id ou um email lê a linha. A autorização por chave continua no middleware e nos handlers, como hoje.
- **`totp_secret` fica em claro em repouso.** Com os verifiers em hash, um dump sozinho não dá login. Cifrar com uma chave da aplicação fica para um ticket de endurecimento.
- **`UpdateAsync` é last-write-wins sobre o registo inteiro** (TOTP × voz × WebAuthn em corrida): igual a hoje, agora entre máquinas. ponytail: concorrência otimista por `xmin` se aparecer. O par de chaves já está fora deste risco (tabela própria).
- **Os emissores em memória** (magic link, device pairing, tickets 2FA) continuam por processo. Não é novo neste ticket.

## Perguntas ao humano

1. **Definição de adoção.** Recomendo "dias com check-in **partilhado** nos últimos 7" (N de 7). A alternativa, "dias com check-in feito, partilhado ou não", exige que o servidor receba uma contagem, e isso expõe metadado do que a paciente não partilhou (colide com o critério 2 e com o ADR-S11-01).
2. ~~**"Persistido lá"**~~ **Resolvida (humano, 2026-09-15):** os envelopes ficam em Postgres e sobrevivem à revogação e à desvinculação. As contas também vão para Postgres, e P6 tem uma rota nova. Ver §5.
3. **"Levados para a sessão".** Recomendo tirar do S11-03. Não existe o lado da paciente (nem tipo partilhável nem entidade), e a spec já o marca como ticket próprio que fecha a spec. P6 não mostra placeholder.
