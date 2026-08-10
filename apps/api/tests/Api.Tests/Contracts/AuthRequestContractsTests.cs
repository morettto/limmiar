using System.Reflection;
using Api.Accounts;

namespace Api.Tests.Contracts;

/// <summary>S02-01 AC: no endpoint accepts a plaintext password field, in either language or casing. Checked by reflection over the actual request DTO types, not a manual source read, so it fails the moment anyone adds one back.</summary>
public sealed class AuthRequestContractsTests
{
    [Theory]
    [InlineData(typeof(RegisterRequest))]
    [InlineData(typeof(LoginRequest))]
    [InlineData(typeof(GoogleAuthRequest))]
    public void RequestContract_HasNoPlaintextPasswordField(Type requestType)
    {
        var propertyNames = requestType.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(property => property.Name)
            .ToArray();

        Assert.DoesNotContain(propertyNames, name =>
            name.Equals("Password", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("Senha", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData(typeof(RegisterRequest))]
    [InlineData(typeof(LoginRequest))]
    public void RequestContract_CarriesPasswordAsAnOpaqueByteVerifier_NotAString(Type requestType)
    {
        var property = requestType.GetProperty("PasswordVerifier");

        Assert.NotNull(property);
        Assert.Equal(typeof(byte[]), property!.PropertyType);
    }
}
