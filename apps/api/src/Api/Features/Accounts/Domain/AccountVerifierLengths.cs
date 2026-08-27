namespace Api.Accounts;

public static class AccountVerifierLengths
{
    public const int PasswordVerifierLength = 32;

    // Always compare against a real or dummy verifier of equal length before branching:
    // keeps unknown-email/wrong-verifier timing identical to a real match attempt.
    public static readonly byte[] Dummy = new byte[PasswordVerifierLength];
}
