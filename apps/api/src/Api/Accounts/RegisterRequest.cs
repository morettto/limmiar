namespace Api.Accounts;

/// <summary>
/// Cadastro por e-mail (ADR-S02-02): the client derives <see cref="PasswordVerifier"/>
/// locally (Argon2id -- see packages/crypto) and this is the ONLY password-shaped field
/// this contract accepts. There is deliberately no "password"/"senha" property anywhere
/// in this file -- see Api.Tests/Contracts/AuthRequestContractsTests for the guard test
/// that keeps it that way.
/// </summary>
public sealed record RegisterRequest(string Email, byte[] PasswordVerifier, AccountRole Role);

public sealed record RegisterResponse(Guid Id, string Email, AccountRole Role);
