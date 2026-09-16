namespace Api.Accounts;

public static class TwoFactorComposition
{

    public static void AddTwoFactor(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<ITotpProvider, TotpProvider>();
        services.AddSingleton<ITwoFactorTicketIssuer, TwoFactorTicketIssuer>();
        try
        {
            services.AddSingleton(new TotpSecretCipher(ReadEncryptionKey(configuration)));
        }
        catch (ArgumentException ex)
        {
            throw new InvalidOperationException("Totp:EncryptionKey must decode to exactly 32 bytes.", ex);
        }
    }

    // Fails closed unconditionally, same discipline as WebAuthn:RelyingPartyId/ExpectedOrigin
    // and StaffAccess:ApiKey: there is no "unless it's a test" branch here, tests configure a
    // real (test) key via UseSetting just like every other required secret.
    private static byte[] ReadEncryptionKey(IConfiguration configuration)
    {
        var base64Key = configuration["Totp:EncryptionKey"];
        if (string.IsNullOrEmpty(base64Key))
        {
            throw new InvalidOperationException("Missing required configuration: Totp:EncryptionKey");
        }

        byte[] key;
        try
        {
            key = Convert.FromBase64String(base64Key);
        }
        catch (FormatException ex)
        {
            throw new InvalidOperationException("Totp:EncryptionKey must be valid base64.", ex);
        }

        return key;
    }

    public static void MapTwoFactor(this IEndpointRouteBuilder app)
    {
        app.MapTwoFactorEndpoints();
    }
}
