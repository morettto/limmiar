namespace Api.Problems;

/// <summary>Stable, machine-readable error codes returned in <see cref="LimmiarProblemDetails.Code"/>.</summary>
public static class ProblemCodes
{
    public const string HealthDatabaseUnreachable = "health.database_unreachable";

    /// <summary>Fallback code for any exception not otherwise mapped to a specific problem code.</summary>
    public const string UnexpectedError = "unexpected_error";

    /// <summary>Request body failed a field-level validation check (e.g. missing/malformed field).</summary>
    public const string ValidationInvalidField = "validation.invalid_field";

    public const string AuthEmailAlreadyRegistered = "auth.email_already_registered";

    /// <summary>
    /// Returned for BOTH "no account with this e-mail" and "wrong password verifier" --
    /// deliberately the same code (and same status, title, body shape) for both, so a
    /// caller cannot tell them apart. See AccountService.LoginAsync.
    /// </summary>
    public const string AuthInvalidCredentials = "auth.invalid_credentials";

    public const string AuthGoogleTokenInvalid = "auth.google_token_invalid";
}
