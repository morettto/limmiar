namespace Api.Accounts;

public sealed record GoogleIdentity(string Email, string SubjectId);

public interface IGoogleIdentityProvider
{
    Task<GoogleIdentity?> VerifyIdTokenAsync(string idToken, CancellationToken cancellationToken);
}
