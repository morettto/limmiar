namespace Api.Accounts;

/// <summary>
/// E-mail/verifier login (ADR-S02-02). Same "no plaintext password field" contract as
/// <see cref="RegisterRequest"/> -- see Api.Tests/Contracts/AuthRequestContractsTests.
/// </summary>
public sealed record LoginRequest(string Email, byte[] PasswordVerifier);

public sealed record LoginResponse(Guid Id, string Email, AccountRole Role);
