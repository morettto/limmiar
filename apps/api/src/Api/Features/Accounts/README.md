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
- **`totp_secret` nunca em claro em repouso.** `accounts.totp_secret_encrypted` (migração
  `0011_encrypt_totp_secret.sql`) guarda `nonce(12) || ciphertext || tag(16)` via AES-256-GCM
  (`TotpSecretCipher`, `TwoFactor/Infrastructure/`). A chave vem de `Totp:EncryptionKey`
  (configuração, base64 de 32 bytes) -- `TwoFactorComposition.AddTwoFactor` lê-a no arranque e
  falha fechado (`InvalidOperationException`) se faltar, não for base64 válido, ou não tiver
  32 bytes, sem exceção para testes (mesma disciplina de `WebAuthn:RelyingPartyId`/
  `StaffAccess:ApiKey`/`AbacatePay:WebhookSecret` -- ver `Features/Billing/README.md`). Só
  `PostgresAccountStore` cifra/decifra; `TotpProvider` e os handlers de `TwoFactor` continuam a
  ver `Account.TotpSecret` em claro, sem saber que a persistência cifra por baixo. A coluna
  antiga `accounts.totp_secret` (texto, claro) fica sem `GRANT UPDATE` nem `GRANT SELECT` --
  ronda 1 de review do S11-03 fechou a leitura também, porque um `REVOKE` de coluna nunca anula
  um `GRANT SELECT` de tabela inteira no Postgres: a 0011 agora troca esse grant por
  `GRANT SELECT (lista de colunas sem totp_secret)`, provado por
  `AccountsRlsTests.SelectingTotpSecretColumn_IsDeniedByColumnPrivilege` -- a coluna não é
  apagada, migração é expand, nunca destrutiva. `TotpSecretCipher.Decrypt` valida o tamanho
  mínimo do blob (nonce + tag = 28 bytes) antes de fatiar o array, e lança `ArgumentException`
  em vez de `ArgumentOutOfRangeException` para um blob curto.

## Armadilhas

- `Program.Composition.cs` regista `NpgsqlDataSource` via delegate de fábrica
  (`AddSingleton(_ => ...)`), não uma instância pronta -- só assim o container liberta as ligações
  ao fim de cada `WebApplicationFactory` de teste. Ver `apps/api/README.md` (Platform/Data).
