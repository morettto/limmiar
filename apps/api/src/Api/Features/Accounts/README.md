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
- `IAccountStore` é a única porta: quem a implementa (memória em testes, Postgres em produção)
  é decisão de infraestrutura, sem mudança de contrato para os ~11 handlers que a consomem.

## Armadilhas

- `totp_secret` continua em claro em repouso nesta fatia. Ver `.harness/S11-03-forma.md` §8 --
  cifrar com uma chave da aplicação é uma fatia própria deste mesmo ticket.
