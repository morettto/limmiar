namespace Api.Accounts;

/// <summary>
/// Deliberately the only member -- collapses ticket-invalid/ticket-expired/ticket-already-used
/// plus every <see cref="WebAuthnCeremonyFailureReason"/> the underlying
/// <see cref="IWebAuthnCeremonyVerifier"/> call can produce into one outcome. See
/// <c>Api.Problems.ProblemCodes.AuthWebAuthnCeremonyFailed</c> for the full reasoning.
/// </summary>
public enum CompleteMagicLinkFailureReason
{
    CeremonyFailed,
}

/// <summary>Result of <see cref="AccountService.CompleteMagicLinkWebAuthnAsync"/>.</summary>
public sealed class CompleteMagicLinkResult
{
    public required bool Succeeded { get; init; }

    public CompleteMagicLinkFailureReason? FailureReason { get; init; }

    public Account? Account { get; init; }

    /// <summary>
    /// The session issued by this call. Always present on success -- unlike
    /// <see cref="AccountRegistrationResult.Session"/>/<see cref="AccountLoginResult.Session"/>,
    /// there is no "still owes 2FA" branch here: every account this method can produce or
    /// touch is <see cref="AccountRole.Patient"/>, for which
    /// <see cref="TwoFactorPolicy.Determine"/> is always <see cref="TwoFactorRequirement.NotApplicable"/>.
    /// </summary>
    public SessionTokenPair? Session { get; init; }

    public static CompleteMagicLinkResult Success(Account account, SessionTokenPair session) =>
        new() { Succeeded = true, Account = account, Session = session };

    public static CompleteMagicLinkResult Failure() =>
        new() { Succeeded = false, FailureReason = CompleteMagicLinkFailureReason.CeremonyFailed };
}
