namespace Api.Accounts;

/// <summary>The Google identity a verified ID token resolves to.</summary>
public sealed record GoogleIdentity(string Email, string SubjectId);

/// <summary>
/// Verifies a Google Sign-In ID token and resolves the identity it asserts. Returns null
/// for a token that fails verification (expired, wrong audience, bad signature, etc.) --
/// <see cref="AccountService.GoogleAuthAsync"/> treats that as an
/// <see cref="AccountGoogleAuthFailureReason.InvalidGoogleToken"/> failure, never an
/// exception, so callers don't need a try/catch around this.
/// </summary>
public interface IGoogleIdentityProvider
{
    Task<GoogleIdentity?> VerifyIdTokenAsync(string idToken, CancellationToken cancellationToken);
}
