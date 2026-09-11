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
- `RequireAccountAccessMiddleware` (`Presentation/RequireAccountAccessMiddleware.cs`) -- a
  fronteira HTTP, fechada por omissão: protege TODO `RouteEndpoint` cujo `RoutePattern` declare
  `{accountId}`, sem nenhum marcador por rota. Registado uma única vez em
  `Program.Composition.cs` (`app.UseMiddleware<RequireAccountAccessMiddleware>()`, logo a
  seguir a `UseCors()`, antes do routing mapear qualquer rota), lê
  `context.GetEndpoint()` em toda a request; se não for um `RouteEndpoint` com `accountId` no
  padrão, passa direto ao `next`. Um middleware registado depois do routing mas antes do
  endpoint é o único sítio do pipeline onde isto pode correr **antes** do binding dos
  parâmetros do handler (route values, query, corpo) -- um `IEndpointFilter` só corre depois de
  esse binding já ter sucedido, o que deixava um corpo JSON estruturalmente malformado (ex.
  `{`) cair na resposta de erro do próprio framework em vez do 401 esperado.

  Uma rota que precisa de autorizar de outra forma opta explicitamente por fora com
  `.AllowWithoutAccountToken()` (`AccountAccessEndpointConventions`, mesmo ficheiro), com um
  comentário no local a dizer porquê -- hoje só 4 rotas: as 3 de TOTP
  (`TwoFactorEndpoints`, gate é o ticket de dois fatores) e
  `POST /accounts/{accountId}/professional-verification/decision`
  (`ProfessionalVerificationEndpoints`, gate é o `X-Staff-Api-Key`). Todas as outras rotas com
  `{accountId}` -- hoje Scheduling, Notes, Consent, Patients, DevicePairing, VoiceEnrollment,
  Recovery, ProfessionalVerification/submit -- estão protegidas sem precisar de dizer nada na
  rota; uma rota nova com `{accountId}` nasce protegida. O nome do parâmetro compara-se sem
  distinguir maiúsculas, como o routing faz, por isso `{AccountId}` também fica protegida.

  Limite: a guarda só vê `accountId` como parâmetro de rota. Um endpoint que receba o
  `accountId` pela query ou pelo corpo não fica protegido por ela; hoje nenhum o faz.

  Contrato:
  - Sem header, header sem prefixo `Bearer ` (comparado sem distinguir maiúsculas/minúsculas,
    RFC 9110 §11.1), ou token que `ValidateAccess` não resolve -- `401
    auth.access_token_invalid` (RFC 9110 §15.5.2), com `WWW-Authenticate: Bearer`.
  - Token válido mas de outra conta, ou o valor de `accountId` na rota não é um GUID válido --
    `403 auth.forbidden` (§15.5.4); para "outra conta", mesmo corpo quer a conta do URL exista
    quer não.
  - Token válido para a própria conta -- o handler corre, sem nenhum parâmetro de autorização
    na sua assinatura.

  `AccountAccessEndpointConventions.DeclareAccountAccessOpenApiResponses()`, aplicada uma
  única vez ao grupo de rotas raiz em `Program.Composition.cs`
  (`app.MapGroup("").DeclareAccountAccessOpenApiResponses()`), acrescenta
  `.Produces<LimmiarProblemDetails>(401)`/`(403)` a toda rota protegida -- via
  `IEndpointConventionBuilder.Finally`, que corre depois de qualquer `.AllowWithoutAccountToken()`
  da própria rota, para a decisão de "está protegida" ser sempre a mesma no runtime e no
  OpenAPI. Não há chamada por rota a esquecer.
- `SessionsComposition.AddSessions` -- regista `ISessionTokenIssuer` como singleton (o estado
  dos tokens vive em `ConcurrentDictionary` em memória, não em Postgres).

## Pontos de entrada

- `app.UseMiddleware<RequireAccountAccessMiddleware>()` em `Program.Composition.cs` -- registo
  único; protege qualquer rota `{accountId}` mapeada depois, em qualquer ficheiro.
- `app.MapGroup("").DeclareAccountAccessOpenApiResponses()`, também em
  `Program.Composition.cs` -- todo `Map*Endpoints` corre através deste grupo raiz, para a
  documentação OpenAPI nunca ficar atrás da proteção real.
- `.AllowWithoutAccountToken()` (`RouteHandlerBuilder`) -- só para a exceção deliberada: uma
  rota `{accountId}` que autoriza de outra forma.

## Decisões relevantes

- O middleware compara `sessionTokenIssuer.ValidateAccess(accessToken) is not { }
  tokenAccountId` em vez de guardar o `Guid?` numa variável e comparar com `is null` à parte: a
  comparação final fica `Guid == Guid` em vez de `Guid? == Guid` (branch lifted-nullable morto,
  inalcançável depois da guarda). Uma única peça decide os dois status -- não há mais um par
  booleano/enum a manter em sincronia, nem uma guarda copiada em cada handler.
- `TryGetAccountIdRouteValue` faz `Guid.TryParse(RouteValues["accountId"] as string, out
  accountId)` num único passo: o `as string` já devolve `null` tanto quando a chave não existe
  como quando o valor não é uma string, e `Guid.TryParse` aceita `string?` -- um só branch
  (parseou ou não), em vez de três (chave existe? é string? é um GUID válido?). Toda rota real
  fixa `{accountId:guid}`, logo o routing nunca seleciona o endpoint para um segmento que não
  seja um GUID; se uma rota futura esquecer a restrição `:guid`, o `TryParse` falha fechado
  (403) em vez de rebentar com uma exceção.
- `RequiresAccountAccess(RoutePattern, hasOptOut)` (`AccountAccessEndpointConventions`) é o
  único sítio que decide "esta rota está protegida" -- o middleware (runtime) e
  `DeclareAccountAccessOpenApiResponses()` (OpenAPI) chamam a mesma função, para nunca poderem
  divergir.
