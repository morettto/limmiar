using Api.Accounts;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests.Infrastructure;

internal static class AnonymousAccountFixture
{
    public static async Task<RegisterResponse> CreateAsync(IServiceProvider services)
    {
        var account = new Account(Guid.NewGuid(), null, AccountRole.Patient, null, null);
        await services.GetRequiredService<IAccountStore>().InsertAsync(account, CancellationToken.None);
        var session = services.GetRequiredService<ISessionTokenIssuer>().IssuePair(account.Id);
        return new RegisterResponse(account.Id, null, AccountRole.Patient, TwoFactorRequirement.NotApplicable,
            AccessToken: session.AccessToken, RefreshToken: session.RefreshToken, AccessTokenExpiresAt: session.AccessTokenExpiresAt);
    }
}
