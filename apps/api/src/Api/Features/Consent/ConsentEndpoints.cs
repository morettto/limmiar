using Api.Accounts;
using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using static Api.Accounts.AccountsProblemResults;
using static Api.Accounts.SessionTokenIssuerAuthorization;
using static Api.Problems.ProblemResults;

namespace Api.Consent;

public static class ConsentEndpoints
{
    public static void MapConsentEndpoints(this WebApplication app)
    {
        app.MapPost("/accounts/{accountId:guid}/patients/{patientId:guid}/consents", HandleRecordAsync)
            .WithName("PostConsent")
            .WithSummary("Record a consent decision for one purpose")
            .WithDescription("Appends one event to the append-only consent log for (patientId, purpose). Revoking is the same route with decision \"revogado\" -- there is no DELETE or PUT, revoking never updates or deletes the earlier grant. Requires an Authorization: Bearer access token for this exact account, and the account must be an active Professional (same guard as Notes/Patients).")
            .Produces<RecordConsentResponse>(StatusCodes.Status201Created)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");

        app.MapGet("/accounts/{accountId:guid}/patients/{patientId:guid}/consents", HandleGetAsync)
            .WithName("GetConsents")
            .WithSummary("Read the current consent status for both purposes")
            .WithDescription("The current status for Gravacao and AnaliseIa, each an independent fold over the same append-only event log -- Pendente with no events, otherwise the decision of the most recent event for that purpose. Requires an Authorization: Bearer access token for this exact account.")
            .Produces<ConsentSnapshot>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json");
    }

    private static async Task<Results<Created<RecordConsentResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleRecordAsync(
        Guid accountId,
        Guid patientId,
        RecordConsentRequest request,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        ConsentService consentService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        if (!TryParseDefinedEnum<ConsentPurpose>(request.Purpose, out var purpose))
        {
            return ValidationProblem("purpose");
        }

        if (!TryParseDefinedEnum<ConsentDecision>(request.Decision, out var decision))
        {
            return ValidationProblem("decision");
        }

        var result = await consentService.RecordAsync(accountId, patientId, purpose, decision, cancellationToken);
        if (!result.TryGetValue(out var evt, out var failureReason))
        {
            return MapFailureToProblem(failureReason);
        }

        return TypedResults.Created(
            $"/accounts/{accountId}/patients/{patientId}/consents",
            new RecordConsentResponse(patientId, LowerFirst(purpose.ToString()), LowerFirst(decision.ToString()), evt.RecordedAt));
    }

    private static async Task<Results<Ok<ConsentSnapshot>, JsonHttpResult<LimmiarProblemDetails>>> HandleGetAsync(
        Guid accountId,
        Guid patientId,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        ConsentService consentService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        var snapshot = await consentService.SnapshotAsync(accountId, patientId, cancellationToken);
        return TypedResults.Ok(snapshot);
    }

    /// <summary>
    /// Purposes and decisions travel on the wire as strings ("gravacao"/"analiseIa",
    /// "concedido"/"revogado"), not <c>JsonStringEnumConverter</c> -- not for AOT reasons (the
    /// closed-generic overload is AOT-safe, and ConsentStatus uses it on the response), but to
    /// keep control of the error shape: a converter turns an unknown string into a generic
    /// <c>JsonException</c>, losing the <c>400 validation.invalid_field</c> with the exact
    /// <c>params.field</c> this endpoint is specified to return.
    /// <see cref="Enum.TryParse{TEnum}(string?, bool, out TEnum)"/> alone is not enough: it also
    /// accepts an arbitrary in-range numeric string (e.g. "1") even when the caller only ever
    /// meant to send a name, so <see cref="Enum.IsDefined{TEnum}(TEnum)"/> is required on top to
    /// reject an out-of-range ordinal string (e.g. "99").
    /// </summary>
    private static bool TryParseDefinedEnum<TEnum>(string? value, out TEnum result) where TEnum : struct, Enum =>
        Enum.TryParse(value, ignoreCase: true, out result) && Enum.IsDefined(result);

    private static string LowerFirst(string value) =>
        char.ToLowerInvariant(value[0]) + value[1..];

    // [ExcludeFromCodeCoverage] justification: every named RecordConsentFailureReason arm is
    // exercised by a dedicated HTTP-layer test (same technique as
    // NoteEndpoints.MapFailureToProblem) --
    //   AccountNotFound              -> PostConsent_WithUnknownAccountId_Returns404WithProblemDetails
    //   NotAuthorizedToCreateRecords -> PostConsent_WithUnverifiedProfessional_Returns403WithProblemDetails
    // The remaining gap is the compiler-generated unreachable fallback for the switch
    // expression, same reasoning as NoteEndpoints.MapFailureToProblem /
    // PatientEndpoints.MapCreateFailureToProblem.
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(Justification =
        "Every named case is covered by a dedicated HTTP test (see comment above); the " +
        "remaining gap is the compiler-generated unreachable fallback for the switch " +
        "expression.")]
    private static JsonHttpResult<LimmiarProblemDetails> MapFailureToProblem(RecordConsentFailureReason reason) =>
        reason switch
        {
            RecordConsentFailureReason.AccountNotFound =>
                ProblemJson(StatusCodes.Status404NotFound, "Account not found", AccountsProblemCodes.AuthAccountNotFound),
            RecordConsentFailureReason.NotAuthorizedToCreateRecords =>
                ProblemJson(StatusCodes.Status403Forbidden, "Account is not authorized to record consent", ConsentProblemCodes.ConsentNotAuthorizedToRecord),
            _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
        };
}

public sealed record RecordConsentRequest(string Purpose, string Decision);

public sealed record RecordConsentResponse(Guid PatientId, string Purpose, string Decision, DateTimeOffset RecordedAt);

public sealed record ConsentSnapshot(ConsentStatus Gravacao, ConsentStatus AnaliseIa);
