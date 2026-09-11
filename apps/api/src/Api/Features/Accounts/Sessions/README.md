# Api.Accounts.Sessions

## Responsabilidade

Emite, valida e renova os tokens de sessão (access/refresh) usados por toda a API, e decide se
um `Authorization: Bearer` bate com a conta do `{accountId}` da rota. Não sabe nada de
credenciais/login -- só do par de tokens depois de uma conta já ter sido autenticada noutro
lado (`Api.Accounts.Credentials`, `Api.Accounts.MagicLink`, etc.).

## Fluxo principal

- `ISessionTokenIssuer` (porta, `Application/Ports`) / `SessionTokenIssuer` (única
  implementação, `Infrastructure/`) -- `IssuePair` gera um `SessionTokenPair` novo (access 15
  min, refresh 30 dias, tokens aleatórios de 32 bytes via `RandomNumberGenerator`, não JWT).
  `Refresh` troca um refresh token válido por um par novo da MESMA família (`FamilyId`);
  reutilizar um refresh já trocado revoga a família inteira (deteção de roubo por reuso).
  `ValidateAccess` devolve `Guid?` -- a conta dona do token, ou `null` se o token não existe, a
  família foi revogada, ou expirou.
- `RouteHandlerBuilder.RequireAccountAccess()` (`Presentation/RequireAccountAccessMiddleware.cs`)
  -- a fronteira HTTP, em duas partes:
  - A extensão marca o endpoint com `RequireAccountAccessMetadata` (`.WithMetadata(...)`) e
    acrescenta `.Produces<LimmiarProblemDetails>(401)`/`(403)` (`application/problem+json`),
    para o OpenAPI não divergir do comportamento real.
  - `RequireAccountAccessMiddleware`, registado uma única vez em `Program.Composition.cs`
    (`app.UseMiddleware<RequireAccountAccessMiddleware>()`, logo a seguir a `UseCors()`), lê
    `context.GetEndpoint()?.Metadata` em toda a request; se o endpoint não tiver a metadata,
    passa direto ao `next`. Se tiver, lê o `accountId` do `RouteValues` e o header
    `Authorization`, resolve `ISessionTokenIssuer` por injeção no construtor (singleton, sem
    service locator), e decide antes do endpoint correr.

  Um middleware registado depois do routing mas antes do endpoint é o único sítio do pipeline
  onde isto pode correr **antes** do binding dos parâmetros do handler (route values, query,
  corpo) -- um `IEndpointFilter` só corre depois de esse binding já ter sucedido, o que deixava
  um corpo JSON estruturalmente malformado (ex. `{`) cair na resposta de erro do próprio
  framework em vez do 401 esperado (S09-05 ronda 2).

  Contrato:
  - Sem header, header sem prefixo `"Bearer "`, ou token que `ValidateAccess` não resolve --
    `401 auth.access_token_invalid` (RFC 9110 §15.5.2), com `WWW-Authenticate: Bearer`.
  - Token válido mas de outra conta -- `403 auth.forbidden` (§15.5.4), mesmo corpo quer a conta
    do URL exista quer não.
  - Token válido para a própria conta -- o handler corre, sem nenhum parâmetro de autorização
    na sua assinatura.
  - Rota marcada com `RequireAccountAccess()` mas sem segmento `{accountId:guid}` -- erro de
    composição, não um 401/403: `InvalidOperationException` (falha alto e cedo em vez de
    reportar um status errado ao chamador).

  Usada pelas 20 rotas com `{accountId}` que só precisam de provar "o token é desta conta"
  (Scheduling, Notes, Consent, Patients, DevicePairing, VoiceEnrollment, Recovery,
  ProfessionalVerification/submit). TwoFactor e as rotas staff-only (`X-Staff-Api-Key`) não a
  usam.
- `SessionsComposition.AddSessions` -- regista `ISessionTokenIssuer` como singleton (o estado
  dos tokens vive em `ConcurrentDictionary` em memória, não em Postgres).

## Ponto de entrada

- `app.MapPost(...).RequireAccountAccess()` (ou `MapGet`/`MapPatch`/`MapDelete`) em qualquer
  rota com `{accountId:guid}` que precise só da guarda de conta.
- `app.UseMiddleware<RequireAccountAccessMiddleware>()` em `Program.Composition.cs` -- só
  precisa de ser registado uma vez; não há nada a fazer por rota além do `.RequireAccountAccess()`.

## Decisões relevantes

- O middleware compara `sessionTokenIssuer.ValidateAccess(accessToken) is not { }
  tokenAccountId` em vez de guardar o `Guid?` numa variável e comparar com `is null` à parte: a
  comparação final fica `Guid == Guid` em vez de `Guid? == Guid` (branch lifted-nullable morto,
  inalcançável depois da guarda). Uma única peça decide os dois status -- não há mais um par
  booleano/enum a manter em sincronia, nem uma guarda copiada em cada handler.
- `TryGetAccountIdRouteValue` faz `Guid.TryParse(RouteValues["accountId"] as string, out
  accountId)` num único passo: o `as string` já devolve `null` tanto quando a chave não existe
  como quando o valor não é uma string, e `Guid.TryParse` aceita `string?` -- um só branch
  (parseou ou não), em vez de três (chave existe? é string? é um GUID válido?).
