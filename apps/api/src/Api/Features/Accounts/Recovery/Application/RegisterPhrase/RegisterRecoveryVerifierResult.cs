namespace Api.Accounts;

public enum RegisterRecoveryVerifierFailureReason
{
    AccountNotFound,

    NotAProfessionalAccount,
}

public sealed class RegisterRecoveryVerifierResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public RegisterRecoveryVerifierFailureReason? FailureReason { get; init; }

    public static RegisterRecoveryVerifierResult Success(Account account) =>
        new() { Succeeded = true, Account = account };

    public static RegisterRecoveryVerifierResult Failure(RegisterRecoveryVerifierFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
