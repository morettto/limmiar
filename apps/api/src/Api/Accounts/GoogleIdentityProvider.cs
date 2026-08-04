namespace Api.Accounts;

/// <summary>
/// TODO: integrate with real Google ID token verification (validate the JWT signature
/// against Google's published JWKS, and check iss/aud/exp) once this ticket's scope is
/// extended to real Google OAuth. Out of scope for S02-01's confirmed backend seams,
/// which only require the /auth/google endpoint's CONTRACT to be complete with an
/// injectable/fake <see cref="IGoogleIdentityProvider"/> for tests -- see the ticket's
/// own text: "não precisa integrar Google de verdade agora". Every test that reaches
/// /auth/google overrides the DI registration of <see cref="IGoogleIdentityProvider"/>
/// with a fake; nothing in production traffic should reach this placeholder until the
/// real integration lands.
/// </summary>
public sealed class GoogleIdentityProvider : IGoogleIdentityProvider
{
    public Task<GoogleIdentity?> VerifyIdTokenAsync(string idToken, CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "Google ID token verification is not implemented yet (S02-01 backend seam scope). " +
            "See the TODO on Api.Accounts.GoogleIdentityProvider.");
}
