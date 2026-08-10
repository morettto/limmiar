using Api.Accounts;

namespace Api.Tests.Accounts;

// No patient-creation endpoint exists yet (S03-01); this tests the guard in isolation.
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
        var account = new Account(Guid.NewGuid(), "patient@example.com", AccountRole.Patient, PasswordVerifier: null, GoogleSubjectId: null, status);

        Assert.False(AccountAuthorizationGuard.CanCreatePatientRecords(account));
    }

    private static Account ProfessionalWithStatus(AccountVerificationStatus status) =>
        new(Guid.NewGuid(), "professional@example.com", AccountRole.Professional, PasswordVerifier: null, GoogleSubjectId: null, status);
}
