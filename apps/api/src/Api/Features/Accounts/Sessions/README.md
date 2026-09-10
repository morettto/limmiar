# Api.Accounts.Sessions

## Responsabilidade

Emite, valida e renova os tokens de sessão (access/refresh) usados por toda a API, e
decide se um `Authorization: Bearer` bate com a conta do URL. Não sabe nada de
credenciais/login -- só do par de tokens depois de uma conta já ter sido autenticada
noutro lado (`Api.Accounts.Credentials`, `Api.Accounts.MagicLink`, etc.).

## Fluxo principal

- `ISessionTokenIssuer` (porta) / `SessionTokenIssuer` (única implementação,
  `Infrastructure/`) -- `IssuePair` gera um `SessionTokenPair` novo (access 15 min,
  refresh 30 dias, tokens aleatórios de 32 bytes via `RandomNumberGenerator`, não JWT).
  `Refresh` troca um refresh token válido por um par novo da MESMA família
  (`FamilyId`); reutilizar um refresh já trocado revoga a família inteira (deteção de
  roubo por reuso). `ValidateAccess` devolve `Guid?` -- a conta dona do token, ou `null`
  se o token não existe, a família foi revogada, ou expirou.
- `SessionTokenIssuerAuthorization.AccountAccessProblem` (estático, sem estado) -- lê o
  header `Authorization`, extrai o token depois do prefixo `"Bearer "` e chama
  `ValidateAccess`. Devolve `null` (autorizado), ou o problem já pronto: 401
  `auth.access_token_invalid` (RFC 9110 §15.5.2) quando o header falta, não começa por
  `"Bearer "`, ou o token não resolve a nenhuma conta; 403 `auth.forbidden` (§15.5.4)
  quando o token é válido mas resolve a uma conta diferente da do URL. Chamador escreve
  `if (AccountAccessProblem(...) is { } accessProblem) { return accessProblem; }`.
- `SessionsComposition.AddSessions` -- regista `ISessionTokenIssuer` como singleton
  (o estado dos tokens vive em `ConcurrentDictionary` em memória, não em Postgres).

## Decisão relevante

`AccountAccessProblem` compara `sessionTokenIssuer.ValidateAccess(accessToken) is not {
} tokenAccountId` em vez de guardar o `Guid?` numa variável e comparar com `is null` à
parte: a comparação final fica `Guid == Guid` em vez de `Guid? == Guid` (branch
lifted-nullable morto, inalcançável depois da guarda). Um único helper decide os dois
status -- não há mais um par booleano/enum a manter em sincronia.
