# Api.Accounts

## Responsabilidade

Dono da conta (`Account`): registo, login, Google, magic link, recuperação por frase BIP39,
TOTP, WebAuthn, envelope de voz, verificação profissional e o par de chaves X25519
(`KeyPair/AccountKeyPairService`). Cada sub-slice (`Credentials`, `Recovery`, `TwoFactor`,
`WebAuthn`, `MagicLink`, `DevicePairing`, `ProfessionalVerification`, `VoiceEnrollment`,
`Sessions`) mora numa pasta própria atrás da mesma porta `IAccountStore`; ver o README de cada
uma para o seu contrato. `PatientLinks` e `apps/api/README.md` documentam quem mais depende
desta conta.

## Invariantes

- **`PasswordVerifier` e `RecoveryVerifier` nunca são o verifier em si.** O cliente já deriva o
  verifier com uma KDF lenta (Argon2id, `ACCOUNT_VERIFIER_PARAMS` em `packages/crypto`), com alta
  entropia -- por isso só `SHA256(verifier)` é guardado (`RegisterHandler`,
  `RegisterRecoveryVerifierHandler`), nunca o valor que o cliente envia. Um dump do armazenamento
  não dá login: quem lê o dump ainda precisa do verifier original, não só do hash. A comparação
  em `ConstantTimePasswordVerifierComparer` faz `SHA256(submitted)` antes do
  `FixedTimeEquals(., stored)` -- os dois lados da comparação são sempre hashes de 32 bytes,
  igual ao tamanho de `AccountVerifierLengths.Dummy`, para o Google-only e o email desconhecido
  levarem o mesmo tempo que uma tentativa real.
- `IAccountStore` é a única porta: `PostgresAccountStore` (produção, `Infrastructure/`) e
  `InMemoryAccountStore` (fake de teste, `tests/Api.Tests/Fakes/`, git-movido para lá em S11-03
  fatia 6) são as duas implementações -- decisão de infraestrutura, sem mudança de contrato para
  os ~11 handlers que consomem a porta.
- **RLS de `accounts` só impede enumerar, não autoriza.** A política `account_lookup_by_key`
  (migração `0010_create_accounts.sql`) mostra uma linha se `id = app.tenant_id`, `email =
  app.account_email`, ou `app.staff_review = 'on'` e a linha é uma profissional em revisão --
  exatamente as três chaves que `IAccountStore` já usa (`FindByIdAsync`, `FindByEmailAsync`,
  `ListPendingDocumentReviewAsync`). Quem tem um id ou email lê a linha; a autorização de "podes
  chamar isto com este id" continua no middleware e nos handlers, como sempre foi.
- `account_key_pairs` é tabela própria, não colunas de `accounts`: `IAccountStore.UpdateAsync`
  substitui o registo inteiro (TOTP, WebAuthn, voz), e o par de chaves precisa sobreviver a isso
  mesmo sob concorrência com outro `PUT` na mesma conta -- ver `KeyPair/README` (se/quando
  existir) ou o XML doc de `AccountKeyPairService`.

## Armadilhas

- `totp_secret` continua em claro em repouso nesta fatia. Ver `.harness/S11-03-forma.md` §8 --
  cifrar com uma chave da aplicação é uma fatia própria deste mesmo ticket (S11-03, depois da 6).
- `Program.Composition.cs` regista `NpgsqlDataSource` via delegate de fábrica
  (`AddSingleton(_ => ...)`), não uma instância pronta -- só assim o container liberta as ligações
  ao fim de cada `WebApplicationFactory` de teste. Ver `apps/api/README.md` (Platform/Data).
