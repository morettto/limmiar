using Api.Accounts;
using Api.Problems;
using Api.Scheduling;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using static Api.Accounts.AccountsProblemResults;
using static Api.Problems.ProblemResults;

namespace Api.Billing;

public static class BookingProblemCodes
{
    public const string PublicBookingLinkInvalid = "booking.link_invalid";
}

public static class PublicBookingEndpoints
{
    public static void MapPublicBookingEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/p/{token}/reserve", HandleReserveAsync)
            .WithName("PostPublicReserve")
            .WithSummary("Reservar por link público")
            .WithDescription("Deliberately unauthenticated: quem apresenta o token opaco de 256 bits tem a capacidade (molde DevicePairingEndpoints claim). Link desconhecido dá o mesmo 404 de link revogado.")
            .Produces<PublicReserveResponse>(StatusCodes.Status201Created)
            .Produces<PublicReserveResponse>(StatusCodes.Status200OK)
            .Produces<PublicReserveResponse>(StatusCodes.Status202Accepted)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapPost("/sessions/{sessionId:guid}/no-show", HandleNoShowAsync)
            .WithName("PostSessionNoShow")
            .WithSummary("Marcar falta de uma sessão")
            .WithDescription("Idempotente: repetir devolve o mesmo veredito. O veredito segue a política única global (primeira falta desculpada). Requer Bearer do próprio tenant; sessão alheia dá 404.")
            .Produces<NoShowResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");
    }

    private static async Task<Results<Created<PublicReserveResponse>, Ok<PublicReserveResponse>, JsonHttpResult<PublicReserveResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleReserveAsync(
        string token,
        PublicReserveRequest request,
        IPublicBooking booking,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name)
            || string.IsNullOrWhiteSpace(request.Contact)
            || request.StartsAt <= DateTimeOffset.UtcNow)
        {
            var field = string.IsNullOrWhiteSpace(request.Name)
                ? "name"
                : string.IsNullOrWhiteSpace(request.Contact) ? "contact" : "startsAt";
            return ValidationProblem(field);
        }

        var result = await booking.ReserveAsync(token, request, cancellationToken);
        var response = new PublicReserveResponse(result.SessionId, result.CheckoutUrl);
        return result.Outcome switch
        {
            ReserveOutcome.SlotTaken =>
                ProblemJson(StatusCodes.Status409Conflict, "Slot already taken", SchedulingProblemCodes.AgendaSlotTaken),
            ReserveOutcome.LinkInvalidOrExpired =>
                ProblemJson(StatusCodes.Status404NotFound, "Booking link is invalid or expired", BookingProblemCodes.PublicBookingLinkInvalid),
            _ when result.IsDuplicate => TypedResults.Ok(response),
            _ when result.CheckoutUrl is null => TypedResults.Json(
                response, AbacatePayJsonContext.Default.PublicReserveResponse, statusCode: StatusCodes.Status202Accepted),
            _ => TypedResults.Created($"/p/{token}/sessions/{result.SessionId}", response),
        };
    }

    private static async Task<Results<Ok<NoShowResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleNoShowAsync(
        Guid sessionId,
        HttpContext httpContext,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        ScheduledSessionStore sessions,
        CancellationToken cancellationToken)
    {
        var accountId = authorization?.StartsWith("Bearer ", StringComparison.Ordinal) is true
            ? sessionTokenIssuer.ValidateAccess(authorization!["Bearer ".Length..])
            : null;
        if (accountId is null)
        {
            return AccessTokenUnauthorizedProblem(httpContext);
        }

        var marked = await sessions.TryMarkNoShowAsync(accountId.Value, sessionId, cancellationToken);
        if (!marked)
        {
            return ProblemJson(StatusCodes.Status404NotFound, "Session not found", SchedulingProblemCodes.AgendaSessionNotFound);
        }

        var previas = await sessions.CountPriorNoShowsAsync(accountId.Value, sessionId, cancellationToken);
        return TypedResults.Ok(new NoShowResponse(NoShowPolicy.Decide(previas)));
    }
}
