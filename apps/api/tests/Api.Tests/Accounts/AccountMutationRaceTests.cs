using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class AccountMutationRaceTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DeleteVoice_AnotherRequestAlreadyRemovedProfile_LeavesLatestSettings(bool removedAccount)
    {
        var initial = Professional() with { VoiceEnrollment = new(new byte[60], new byte[796]) };
        var latest = initial with { VoiceEnrollment = null, TotpSecret = "concurrent-secret" };
        var store = new ChangingStore(initial, removedAccount ? null : latest);
        Assert.Equal(VoiceEnrollmentFailureReason.NotEnrolled,
            await new VoiceEnrollmentService(store).DeleteAsync(initial.Id, CancellationToken.None));
        Assert.Equal(removedAccount ? null : latest, store.Current);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RegisterRecovery_UsesLatestAccountOrReportsRemoval(bool removedAccount)
    {
        var initial = Professional();
        var latest = initial with { VoiceEnrollment = new(new byte[60], new byte[796]) };
        var store = new ChangingStore(initial, removedAccount ? null : latest);
        var result = await new RegisterRecoveryVerifierHandler(store).Handle(
            new(initial.Id, new byte[32], new byte[120]), CancellationToken.None);
        Assert.Equal(!removedAccount, result.Succeeded);
        if (removedAccount) Assert.Equal(RegisterRecoveryVerifierFailureReason.AccountNotFound, result.FailureReason);
        else Assert.Equal(latest.VoiceEnrollment, result.Account!.VoiceEnrollment);
    }

    [Theory]
    [InlineData("secret-changed")]
    [InlineData("already-confirmed")]
    [InlineData("account-removed")]
    public async Task ConfirmTotp_RefusesToConfirmObsoletePendingEnrollment(string change)
    {
        var initial = Professional() with { TotpSecret = "pending-secret" };
        var latest = change switch
        {
            "secret-changed" => initial with { TotpSecret = "replacement-secret" },
            "already-confirmed" => initial with { TotpEnabledAt = DateTimeOffset.UtcNow, TotpBackupCodeHashes = ["existing-hash"] },
            _ => null,
        };
        var store = new ChangingStore(initial, latest);
        var result = await new ConfirmTotpEnrollmentHandler(store, new ValidTotp(), new SessionTokenIssuer())
            .Handle(new(initial.Id, "123456"), CancellationToken.None);
        Assert.False(result.Succeeded);
        Assert.Equal(ConfirmTotpEnrollmentFailureReason.NotPending, result.FailureReason);
        Assert.Equal(latest, store.Current);
    }

    [Fact]
    public async Task ConfirmTotp_PreservesRecoveryWrittenSinceInitialRead()
    {
        var initial = Professional() with { TotpSecret = "pending-secret" };
        var latest = initial with { RecoveryEnvelope = new byte[120], RecoveryVerifier = new byte[32] };
        var store = new ChangingStore(initial, latest);
        var result = await new ConfirmTotpEnrollmentHandler(store, new ValidTotp(), new SessionTokenIssuer())
            .Handle(new(initial.Id, "123456"), CancellationToken.None);
        Assert.True(result.Succeeded);
        Assert.Equal(latest.RecoveryEnvelope, result.Account!.RecoveryEnvelope);
        Assert.Equal(latest.RecoveryVerifier, result.Account.RecoveryVerifier);
        Assert.NotNull(result.Account.TotpEnabledAt);
    }

    [Theory]
    [InlineData("disabled")]
    [InlineData("no-codes")]
    [InlineData("consumed")]
    [InlineData("removed")]
    public async Task VerifyBackupCode_RefusesCodeNoLongerPresentInLatestEnrollment(string change)
    {
        var initial = Professional() with
        {
            TotpEnabledAt = DateTimeOffset.UtcNow, TotpSecret = "secret",
            TotpBackupCodeHashes = [BackupCodeGenerator.Hash("one-use-code")],
        };
        var latest = change switch
        {
            "disabled" => initial with { TotpEnabledAt = null },
            "no-codes" => initial with { TotpBackupCodeHashes = null },
            "consumed" => initial with { TotpBackupCodeHashes = [] },
            _ => null,
        };
        var store = new ChangingStore(initial, latest);
        var result = await new VerifyTotpChallengeHandler(store, new ValidTotp(), new SessionTokenIssuer())
            .Handle(new(initial.Id, null, "one-use-code"), CancellationToken.None);
        Assert.False(result.Succeeded);
        Assert.Equal(VerifyTotpChallengeFailureReason.InvalidCode, result.FailureReason);
        Assert.Equal(latest, store.Current);
    }

    [Fact]
    public async Task VerifyBackupCode_RetriedMutationConsumesOnlyRequestedCode()
    {
        var initial = Professional() with
        {
            TotpEnabledAt = DateTimeOffset.UtcNow, TotpSecret = "secret",
            TotpBackupCodeHashes = [BackupCodeGenerator.Hash("first"), BackupCodeGenerator.Hash("second")],
        };
        var store = new ChangingStore(initial, initial, retryMutation: true);
        var result = await new VerifyTotpChallengeHandler(store, new ValidTotp(), new SessionTokenIssuer())
            .Handle(new(initial.Id, null, "first"), CancellationToken.None);
        Assert.True(result.Succeeded);
        Assert.Equal([BackupCodeGenerator.Hash("second")], store.Current!.TotpBackupCodeHashes);
    }

    [Fact]
    public async Task SubmitDocument_LatestRejectedAccountCanBeSubmittedAgain()
    {
        var initial = Professional() with { VerificationStatus = AccountVerificationStatus.Pending };
        var latest = initial with { VerificationStatus = AccountVerificationStatus.Rejected, RejectionReason = "missing document" };
        var store = new ChangingStore(initial, latest);
        var result = await new SubmitProfessionalCredentialHandler(store, new VerifiedCouncil())
            .Handle(new(initial.Id, ProfessionalCredentialType.Document, null, null, "replacement-document"), CancellationToken.None);
        Assert.True(result.Succeeded);
        Assert.Equal(AccountVerificationStatus.InReview, result.Account!.VerificationStatus);
        Assert.Null(result.Account.RejectionReason);
    }

    [Theory]
    [InlineData(ProfessionalCredentialType.Document, false)]
    [InlineData(ProfessionalCredentialType.Document, true)]
    [InlineData(ProfessionalCredentialType.Crp, false)]
    [InlineData(ProfessionalCredentialType.Crp, true)]
    public async Task SubmitCredential_RefusesToOverwriteConcurrentVerification(ProfessionalCredentialType type, bool removedAccount)
    {
        var initial = Professional() with { VerificationStatus = AccountVerificationStatus.Pending };
        var latest = initial with { VerificationStatus = AccountVerificationStatus.Active, RecoveryEnvelope = new byte[120] };
        var store = new ChangingStore(initial, removedAccount ? null : latest);
        var result = await new SubmitProfessionalCredentialHandler(store, new VerifiedCouncil())
            .Handle(new(initial.Id, type, "06/123456", "SP", "document-reference"), CancellationToken.None);
        Assert.False(result.Succeeded);
        Assert.Equal(SubmitProfessionalCredentialFailureReason.InvalidStateForSubmission, result.FailureReason);
        Assert.Equal(removedAccount ? null : latest, store.Current);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DecideVerification_RefusesSecondDecision(bool removedAccount)
    {
        var initial = Professional() with { VerificationStatus = AccountVerificationStatus.InReview };
        var latest = initial with { VerificationStatus = AccountVerificationStatus.Rejected, RejectionReason = "previous decision" };
        var store = new ChangingStore(initial, removedAccount ? null : latest);
        var result = await new DecideProfessionalVerificationHandler(store)
            .Handle(new(initial.Id, true, null), CancellationToken.None);
        Assert.False(result.Succeeded);
        Assert.Equal(ProfessionalVerificationDecisionFailureReason.NotInReview, result.FailureReason);
        Assert.Equal(removedAccount ? null : latest, store.Current);
    }

    private static Account Professional() => new(Guid.NewGuid(), "race@example.com", AccountRole.Professional, new byte[32], null);

    private sealed class ChangingStore(Account initial, Account? latest, bool retryMutation = false) : IAccountStore
    {
        public Account? Current { get; private set; } = latest;
        public Task<Account?> FindByIdAsync(Guid id, CancellationToken ct) => Task.FromResult<Account?>(initial);
        public Task<Account?> FindByEmailAsync(string email, CancellationToken ct) => Task.FromResult<Account?>(initial);
        public Task InsertAsync(Account account, CancellationToken ct) => Task.CompletedTask;
        public Task<string?> GetOrCreatePendingTotpSecretAsync(Guid id, string candidate, CancellationToken ct) => Task.FromResult<string?>(candidate);
        public Task<IReadOnlyList<Account>> ListPendingDocumentReviewAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<Account>>([]);
        public Task<Account?> MutateAsync(Guid id, Func<Account, Account?> mutation, CancellationToken ct)
        {
            if (Current is null) return Task.FromResult<Account?>(null);
            if (retryMutation) mutation(Current);
            var updated = mutation(Current);
            if (updated is not null) Current = updated;
            return Task.FromResult(updated);
        }
    }

    private sealed class ValidTotp : ITotpProvider
    {
        public string GenerateSecret() => "secret";
        public string BuildProvisioningUri(string secret, string email, string issuer) => "otpauth://totp/example";
        public bool ValidateCode(string secret, string code, DateTimeOffset timestamp) => true;
    }

    private sealed class VerifiedCouncil : ICouncilRegistryVerifier
    {
        public Task<CouncilRegistryVerificationResult> VerifyAsync(ProfessionalCredentialType type, string number, string uf, CancellationToken ct) =>
            Task.FromResult(CouncilRegistryVerificationResult.CreateVerified());
    }
}
