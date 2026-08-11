namespace Api.Accounts;

public static class WebAuthnComposition
{
    public static void AddWebAuthn(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IWebAuthnCeremonyVerifier, WebAuthnCeremonyVerifier>();

        var relyingPartyId = configuration["WebAuthn:RelyingPartyId"];
        if (string.IsNullOrEmpty(relyingPartyId))
        {
            throw new InvalidOperationException("Missing required configuration: WebAuthn:RelyingPartyId");
        }

        var expectedOrigin = configuration["WebAuthn:ExpectedOrigin"];
        if (string.IsNullOrEmpty(expectedOrigin))
        {
            throw new InvalidOperationException("Missing required configuration: WebAuthn:ExpectedOrigin");
        }

        services.AddSingleton(new WebAuthnRelyingPartyOptions(relyingPartyId, expectedOrigin));
    }
}
