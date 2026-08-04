namespace Api.Accounts;

/// <summary>
/// A registered account. <see cref="PasswordVerifier"/> is null for accounts created
/// exclusively through Google sign-in that have never set an e-mail/password credential
/// (ADR-S02-02: the server only ever stores the client-derived verifier, never a
/// password). <see cref="GoogleSubjectId"/> is null for accounts created through e-mail
/// registration that have never linked Google.
/// </summary>
public sealed record Account(
    Guid Id,
    string Email,
    AccountRole Role,
    byte[]? PasswordVerifier,
    string? GoogleSubjectId);
