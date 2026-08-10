namespace Api.Accounts;

// Placeholder: real Google ID token verification is not wired up yet.
// Tests override IGoogleIdentityProvider with a fake; production should never reach this.
public sealed class GoogleIdentityProvider : IGoogleIdentityProvider
{
    public Task<GoogleIdentity?> VerifyIdTokenAsync(string idToken, CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "Google ID token verification is not implemented yet (S02-01 backend seam scope). " +
            "See the TODO on Api.Accounts.GoogleIdentityProvider.");
}
