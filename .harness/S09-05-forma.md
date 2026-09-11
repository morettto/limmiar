# S09-05 — forma curta

## Ronda 2 (reviewer-lang bloqueante): filtro → middleware

`IEndpointFilter` corre **depois** do binding dos parâmetros do handler (route values, query,
corpo). Um corpo JSON estruturalmente malformado (`{`) sem token rebentava o binding antes do
filtro correr, caindo num 500/400 do próprio framework em vez do 401 exigido pelo critério 4.
Correção: a guarda passa a um middleware de pipeline, registado uma vez, que corre depois do
routing selecionar o endpoint mas antes de esse endpoint (e o seu binding) executar.

`apps/api/src/Api/Features/Accounts/Sessions/Presentation/RequireAccountAccessMiddleware.cs`

```csharp
namespace Api.Accounts;

public sealed class RequireAccountAccessMetadata
{
    public static readonly RequireAccountAccessMetadata Instance = new();
    // marcador; sem estado, sem chamador fora deste ficheiro e do middleware.
}

public static class RequireAccountAccessEndpointFilterExtensions
{
    public static RouteHandlerBuilder RequireAccountAccess(this RouteHandlerBuilder builder);
        // .WithMetadata(RequireAccountAccessMetadata.Instance)
        // .Produces<LimmiarProblemDetails>(401, "application/problem+json")
        // .Produces<LimmiarProblemDetails>(403, "application/problem+json")
}

public sealed class RequireAccountAccessMiddleware(RequestDelegate next, ISessionTokenIssuer sessionTokenIssuer)
{
    public Task InvokeAsync(HttpContext context);
        // sem RequireAccountAccessMetadata no endpoint corrente -> await next(context), sai.
        // TryGetAccountIdRouteValue (Guid.TryParse(RouteValues["accountId"] as string, out _))
        // falha -> InvalidOperationException (composição errada: rota sem {accountId:guid}).
        // 401 sem header/"Bearer "/token inválido (ExecuteAsync do IResult direto no HttpContext);
        // 403 token válido de outra conta; caso contrário await next(context).
}
```

Injeção por construtor (`ISessionTokenIssuer` é singleton em `SessionsComposition`, sem captive
dependency) -- não há `RequestServices.GetRequiredService` na nova versão.

Registo único, em `Program.Composition.cs`, logo a seguir a `app.UseCors()` e antes de qualquer
`app.MapXEndpoints()`: `app.UseMiddleware<RequireAccountAccessMiddleware>();`. Como o
`WebApplication` insere `UseRouting()` implicitamente antes de qualquer `app.Use...`, e o
endpoint-terminal implicitamente no fim, `context.GetEndpoint()` já está preenchido em qualquer
posição onde este middleware seja registado.

## Tipos alterados

- `AccountsProblemResults.AccessTokenUnauthorizedProblem()` → `AccessTokenUnauthorizedProblem(HttpContext httpContext)`,
  escreve `httpContext.Response.Headers.WWWAuthenticate = "Bearer"` antes de devolver o 401.
  (inalterado desde a ronda 1)
- `AccountsProblemResults.ForbiddenProblem()` inalterado.

## Tipos apagados

- `Api.Accounts.SessionTokenIssuerAuthorization` (`Application/Ports/SessionTokenIssuerAuthorization.cs`) — único
  chamador era ele próprio; confirmado sem outro uso legítimo. (ronda 1)
- `Api.Accounts.RequireAccountAccessEndpointFilter` (ronda 1) — substituído pelo middleware acima na ronda 2.

## Call tree (por rota, antes → depois)

Antes (S09-03): `Handler(..., authorization, sessionTokenIssuer, ...)` → `if (AccountAccessProblem(authorization,
accountId, sessionTokenIssuer) is { } p) return p;` → resto do handler.

Ronda 1 (rejeitada pelo review): `MapX(...).RequireAccountAccess()` adicionava um `IEndpointFilter` — corria depois
do binding, tarde demais para um corpo malformado.

Ronda 2 (atual): `MapX(...).RequireAccountAccess()` só marca metadata + `.Produces`. O pipeline corre
`UseRouting (implícito) → ... → UseCors → RequireAccountAccessMiddleware → ... → endpoint.Handler(...)` — a guarda
decide 401/403 antes do binding do handler correr, `Handler(...)` já sem `authorization`/`sessionTokenIssuer`.

## 20 rotas (8 ficheiros)

- SchedulingEndpoints.cs — Schedule (POST), Move (PATCH), List (GET), Cancel (DELETE) — 4
- ConsentEndpoints.cs — Record (POST), Get (GET) — 2
- NoteEndpoints.cs — Sign (POST), Get (GET) — 2
- PatientEndpoints.cs — Create (POST), AppendEntry (POST), GetPatient (GET), ListPatients (GET) — 4
- DevicePairingEndpoints.cs — Create (POST), GetClaimStatus (GET), SubmitPayload (POST) — 3
- RecoveryEndpoints.cs — RegisterRecoveryVerifier (POST) — 1
- ProfessionalVerificationEndpoints.cs — Submit (POST) — 1
- VoiceEnrollmentEndpoints.cs — Put, Get, Delete — 3

Total 20. Fora: TwoFactor (nenhuma rota com {accountId} usava o helper), DevicePairing.Claim/FetchPayload
(deliberadamente sem auth), ProfessionalVerification.ListQueue/Decide (staff-only, X-Staff-Api-Key).
