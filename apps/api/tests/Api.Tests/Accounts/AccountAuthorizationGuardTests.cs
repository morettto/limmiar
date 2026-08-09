using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// S02-02 acceptance criterion: "Conta pendente de validação não consegue criar
/// paciente." No patient-creation endpoint exists yet (Spec S03, ticket S03-01, not
/// started) -- this proves the guard itself, pure, so S03-01 has a tested primitive to
/// call from day one. See <see cref="AccountAuthorizationGuard"/>'s own doc comment.
/// </summary>
public sealed class AccountAuthorizationGuardTests
{
    [Theory]
    [InlineData(AccountVerificationStatus.Pending)]
    [InlineData(AccountVerificationStatus.InReview)]
    [InlineData(AccountVerificationStatus.Rejected)]
    public void CanCreatePatientRecords_WithProfessionalNotYetActive_ReturnsFalse(AccountVerificationStatus status)
    {
        var account = ProfessionalWithStatus(status);

        Assert.False(AccountAuthorizationGuard.CanCreatePatientRecords(account));
    }

    [Fact]
    public void CanCreatePatientRecords_WithActiveProfessional_ReturnsTrue()
    {
        var account = ProfessionalWithStatus(AccountVerificationStatus.Active);

        Assert.True(AccountAuthorizationGuard.CanCreatePatientRecords(account));
    }

    [Theory]
    [InlineData(AccountVerificationStatus.Pending)]
    [InlineData(AccountVerificationStatus.InReview)]
    [InlineData(AccountVerificationStatus.Active)]
    [InlineData(AccountVerificationStatus.Rejected)]
    public void CanCreatePatientRecords_WithPatientAccount_AlwaysReturnsFalse(AccountVerificationStatus status)
    {
        // A patient account is never authorized to create patient records, regardless of
        // its (normally-always-Active) VerificationStatus -- this is a professional-only action.
        var account = new Account(Guid.NewGuid(), "patient@example.com", AccountRole.Patient, PasswordVerifier: null, GoogleSubjectId: null, status);

        Assert.False(AccountAuthorizationGuard.CanCreatePatientRecords(account));
    }

    private static Account ProfessionalWithStatus(AccountVerificationStatus status) =>
        new(Guid.NewGuid(), "professional@example.com", AccountRole.Professional, PasswordVerifier: null, GoogleSubjectId: null, status);
}
