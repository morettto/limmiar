namespace Api.Accounts;

public interface ITotpProvider
{
    string GenerateSecret();

    string BuildProvisioningUri(string secret, string accountEmail, string issuer);

    bool ValidateCode(string secret, string code, DateTimeOffset timestamp);
}
