using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>Spec S02, ADR-S02-03/S02-04: 2FA is mandatory for Professional accounts only, never for Patient.</summary>
public sealed class TwoFactorPolicyTests
{
    [Fact]
    public void Determine_WithPatientAccount_ReturnsNotApplicable()
    {
        var account = new Account(Guid.NewGuid(), "patient@example.com", AccountRole.Patient, PasswordVerifier: null, GoogleSubjectId: null);

        Assert.Equal(TwoFactorRequirement.NotApplicable, TwoFactorPolicy.Determine(account));
    }

    [Fact]
    public void Determine_WithProfessionalAccount_AndNoTotpEnabledAt_ReturnsSetupRequired()
    {
        var account = new Account(Guid.NewGuid(), "pro@example.com", AccountRole.Professional, PasswordVerifier: null, GoogleSubjectId: null);

        Assert.Equal(TwoFactorRequirement.SetupRequired, TwoFactorPolicy.Determine(account));
    }

    [Fact]
    public void Determine_WithProfessionalAccount_AndTotpEnabledAtSet_ReturnsChallengeRequired()
    {
        var account = new Account(
            Guid.NewGuid(), "pro-2fa@example.com", AccountRole.Professional, PasswordVerifier: null, GoogleSubjectId: null,
            TotpEnabledAt: DateTimeOffset.UtcNow);

        Assert.Equal(TwoFactorRequirement.ChallengeRequired, TwoFactorPolicy.Determine(account));
    }

    /// <summary>A pending (secret generated, not yet confirmed) enrollment must still report SetupRequired, not some third state.</summary>
    [Fact]
    public void Determine_WithProfessionalAccount_AndPendingEnrollment_StillReturnsSetupRequired()
    {
        var account = new Account(
            Guid.NewGuid(), "pro-pending@example.com", AccountRole.Professional, PasswordVerifier: null, GoogleSubjectId: null,
            TotpSecret: "JBSWY3DPEHPK3PXP");

        Assert.Equal(TwoFactorRequirement.SetupRequired, TwoFactorPolicy.Determine(account));
    }
}
