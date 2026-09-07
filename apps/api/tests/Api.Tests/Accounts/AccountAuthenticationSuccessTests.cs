using Api.Accounts;

namespace Api.Tests.Accounts;

// S08-28: TwoFactorRequirement deixou de ter um sítio único quando o record ganhou um parâmetro
// explícito. Estes testes provam que AccountLoginSuccess.For / AccountGoogleAuthSuccess.For são
// as únicas fábricas -- os construtores são privados -- e que TwoFactorRequirement é sempre
// derivado da Account que vai no mesmo objeto, nunca passado à parte.
public sealed class AccountAuthenticationSuccessTests
{
    [Fact]
    public void AccountLoginSuccess_For_TwoFactorRequirement_MatchesAccountPassedIn()
    {
        var professionalWithTotp = new Account(
            Guid.NewGuid(), "pro-coherent@example.com", AccountRole.Professional, PasswordVerifier: null, GoogleSubjectId: null,
            TotpEnabledAt: DateTimeOffset.UtcNow);

        var success = AccountLoginSuccess.For(professionalWithTotp, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        Assert.Equal(TwoFactorPolicy.Determine(professionalWithTotp), success.TwoFactorRequirement);
    }

    [Fact]
    public void AccountLoginSuccess_For_WithPatientAccount_ReturnsNotApplicable()
    {
        var patient = new Account(Guid.NewGuid(), "patient-coherent@example.com", AccountRole.Patient, PasswordVerifier: null, GoogleSubjectId: null);

        var success = AccountLoginSuccess.For(patient, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        Assert.Equal(TwoFactorRequirement.NotApplicable, success.TwoFactorRequirement);
    }

    [Fact]
    public void AccountGoogleAuthSuccess_For_TwoFactorRequirement_MatchesAccountPassedIn()
    {
        var professionalWithTotp = new Account(
            Guid.NewGuid(), "pro-google-coherent@example.com", AccountRole.Professional, PasswordVerifier: null, GoogleSubjectId: "sub-1",
            TotpEnabledAt: DateTimeOffset.UtcNow);

        var success = AccountGoogleAuthSuccess.For(professionalWithTotp, isNewAccount: false, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        Assert.Equal(TwoFactorPolicy.Determine(professionalWithTotp), success.TwoFactorRequirement);
    }

    [Fact]
    public void AccountGoogleAuthSuccess_For_WithPatientAccount_ReturnsNotApplicable()
    {
        var patient = new Account(Guid.NewGuid(), "patient-google-coherent@example.com", AccountRole.Patient, PasswordVerifier: null, GoogleSubjectId: "sub-2");

        var success = AccountGoogleAuthSuccess.For(patient, isNewAccount: true, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        Assert.Equal(TwoFactorRequirement.NotApplicable, success.TwoFactorRequirement);
    }

    [Fact]
    public void AccountRegistrationResult_Success_TwoFactorRequirement_MatchesAccountPassedIn()
    {
        var professionalWithTotp = new Account(
            Guid.NewGuid(), "pro-register-coherent@example.com", AccountRole.Professional, PasswordVerifier: null, GoogleSubjectId: null,
            TotpEnabledAt: DateTimeOffset.UtcNow);

        var success = AccountRegistrationResult.Success(professionalWithTotp, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        Assert.Equal(TwoFactorPolicy.Determine(professionalWithTotp), success.TwoFactorRequirement);
    }

    [Fact]
    public void AccountRegistrationResult_Success_WithPatientAccount_ReturnsNotApplicable()
    {
        var patient = new Account(Guid.NewGuid(), "patient-register-coherent@example.com", AccountRole.Patient, PasswordVerifier: null, GoogleSubjectId: null);

        var success = AccountRegistrationResult.Success(patient, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        Assert.Equal(TwoFactorRequirement.NotApplicable, success.TwoFactorRequirement);
    }

    [Fact]
    public void AccountRecoveryResult_Success_TwoFactorRequirement_MatchesAccountPassedIn()
    {
        var professionalWithTotp = new Account(
            Guid.NewGuid(), "pro-recovery-coherent@example.com", AccountRole.Professional, PasswordVerifier: null, GoogleSubjectId: null,
            TotpEnabledAt: DateTimeOffset.UtcNow);

        var success = AccountRecoveryResult.Success(professionalWithTotp, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        Assert.Equal(TwoFactorPolicy.Determine(professionalWithTotp), success.TwoFactorRequirement);
    }

    [Fact]
    public void AccountRecoveryResult_Success_WithPatientAccount_ReturnsNotApplicable()
    {
        var patient = new Account(Guid.NewGuid(), "patient-recovery-coherent@example.com", AccountRole.Patient, PasswordVerifier: null, GoogleSubjectId: null);

        var success = AccountRecoveryResult.Success(patient, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        Assert.Equal(TwoFactorRequirement.NotApplicable, success.TwoFactorRequirement);
    }
}
