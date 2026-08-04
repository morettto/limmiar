using System.Reflection;
using Api.Accounts;

namespace Api.Tests.Contracts;

/// <summary>
/// S02-01 acceptance criterion: "Nenhum endpoint aceita senha em claro -- nem sequer tem
/// campo password/senha no contrato de request". Operationalized here as a reflection
/// check over the actual request DTO types AuthEndpoints binds from the HTTP body -- not
/// a manual read of the source, so it fails the moment anyone adds a "Password"/"Senha"
/// property back, in either language, in any casing.
/// </summary>
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
