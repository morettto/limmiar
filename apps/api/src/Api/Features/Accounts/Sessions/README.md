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
- `SessionTokenIssuerAuthorization` (estático, sem estado) -- lê o header
  `Authorization`, extrai o token depois do prefixo `"Bearer "` e chama
  `ValidateAccess`. Uma implementação, dois vocabulários:
  - `AuthorizeForAccount` -- `AccountAuthorizationOutcome` (`Unauthorized` /
    `ForbiddenOtherAccount` / `Authorized`) -- faz o parse do header e a chamada a
    `ValidateAccess`. Único chamador direto: `SchedulingEndpoints.HandleListAsync` (`GET
    /accounts/{accountId}/agenda/sessions`, S09-02 B4), que precisa de 401 vs 403
    separados por RFC 9110 §15.5.2/§15.5.4. `ForbiddenOtherAccount` só quando o token
    validou para uma conta diferente da do URL -- header ausente, mal formado, ou token
    desconhecido continuam todos a dar `Unauthorized`.
  - `IsAuthorizedForAccount` -- `bool`, delega em `AuthorizeForAccount` e compara com
    `Authorized`. Usada pelos endpoints que só distinguem autorizado/não (a maioria:
    `Scheduling` Schedule/Move/Cancel, `Notes`, `Patients`, `Consent`,
    `VoiceEnrollment`, `ProfessionalVerification`, `DevicePairing`, ...). `Unauthorized`
    e `ForbiddenOtherAccount` colapsam ambos em `false`, sempre 401.
- `SessionsComposition.AddSessions` -- regista `ISessionTokenIssuer` como singleton
  (o estado dos tokens vive em `ConcurrentDictionary` em memória, não em Postgres).

## Decisão relevante

`AuthorizeForAccount` compara `sessionTokenIssuer.ValidateAccess(accessToken) is not {
} tokenAccountId` em vez de guardar o `Guid?` numa variável e comparar com `is null` à
parte (S09-02 B4 etapa 5): a comparação final fica `Guid == Guid` em vez de `Guid? ==
Guid` (branch lifted-nullable morto, inalcançável depois da guarda). `IsAuthorizedForAccount`
delega em `AuthorizeForAccount` (S09-02 R2) em vez de repetir o parse do header e a
chamada a `ValidateAccess` -- um único sítio decide o que é `Authorized`.
