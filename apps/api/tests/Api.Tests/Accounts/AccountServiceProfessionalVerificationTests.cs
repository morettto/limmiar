using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class AccountServiceProfessionalVerificationTests
{
    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    [Fact]
    public async Task RegisterAsync_WithPatientRole_CreatesAccountAlreadyActive()
    {
        var store = new FakeAccountStore();
        var handler = new RegisterHandler(store, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new RegisterCommand("patient@example.com", SomeVerifier, AccountRole.Patient), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(AccountVerificationStatus.Active, result.Account!.VerificationStatus);
    }

    [Fact]
    public async Task RegisterAsync_WithProfessionalRole_CreatesAccountPending()
    {
        var store = new FakeAccountStore();
        var handler = new RegisterHandler(store, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new RegisterCommand("pro@example.com", SomeVerifier, AccountRole.Professional), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(AccountVerificationStatus.Pending, result.Account!.VerificationStatus);
    }

    [Fact]
    public async Task GoogleAuthAsync_WithNewProfessionalAccount_CreatesAccountPending()
    {
        var store = new FakeAccountStore();
        var identity = new GoogleIdentity("new-pro-via-google@example.com", "google-subject-1");
        var handler = new ContinueWithGoogleHandler(new StubGoogleIdentityProvider(identity), store, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new ContinueWithGoogleCommand("valid-id-token", AccountRole.Professional), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(AccountVerificationStatus.Pending, result.Account!.VerificationStatus);
    }

    [Fact]
    public async Task GoogleAuthAsync_WithNewPatientAccount_CreatesAccountActive()
    {
        var store = new FakeAccountStore();
        var identity = new GoogleIdentity("new-patient-via-google@example.com", "google-subject-2");
        var handler = new ContinueWithGoogleHandler(new StubGoogleIdentityProvider(identity), store, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new ContinueWithGoogleCommand("valid-id-token", AccountRole.Patient), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(AccountVerificationStatus.Active, result.Account!.VerificationStatus);
    }

    [Fact]
    public async Task SubmitProfessionalCredentialAsync_WithCrpVerifiedByCouncil_MovesToActive()
    {
        var account = PendingProfessional("pending-crp@example.com");
        var store = new FakeAccountStore(account);
        var verifier = new StubCouncilRegistryVerifier(verified: true);
        var handler = new SubmitProfessionalCredentialHandler(store, verifier);

        var result = await handler.Handle(
            new SubmitProfessionalCredentialCommand(account.Id, ProfessionalCredentialType.Crp, "06/123456", "SP", DocumentReference: null),
            CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(AccountVerificationStatus.Active, result.Account!.VerificationStatus);
        Assert.Null(result.Account.RejectionReason);
        Assert.Equal(ProfessionalCredentialType.Crp, verifier.LastRequestedType);
    }

    [Fact]
    public async Task SubmitProfessionalCredentialAsync_WithCrmRejectedByCouncil_MovesToRejected_WithReadableReason()
    {
        var account = PendingProfessional("pending-crm@example.com");
        var store = new FakeAccountStore(account);
        var verifier = new StubCouncilRegistryVerifier(verified: false, failureReason: "Número de CRM não encontrado na base do conselho.");
        var handler = new SubmitProfessionalCredentialHandler(store, verifier);

        var result = await handler.Handle(
            new SubmitProfessionalCredentialCommand(account.Id, ProfessionalCredentialType.Crm, "123456-SP", "SP", DocumentReference: null),
            CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(AccountVerificationStatus.Rejected, result.Account!.VerificationStatus);
        Assert.Equal("Número de CRM não encontrado na base do conselho.", result.Account.RejectionReason);
    }

    [Fact]
    public async Task SubmitProfessionalCredentialAsync_WithDocument_MovesToInReview_AndNeverCallsCouncilVerifier()
    {
        var account = PendingProfessional("pending-doc@example.com");
        var store = new FakeAccountStore(account);
        var verifier = new StubCouncilRegistryVerifier(verified: true);
        var handler = new SubmitProfessionalCredentialHandler(store, verifier);

        var result = await handler.Handle(
            new SubmitProfessionalCredentialCommand(account.Id, ProfessionalCredentialType.Document, RegistryNumber: null, RegistryUf: null, "doc-ref-1"),
            CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(AccountVerificationStatus.InReview, result.Account!.VerificationStatus);
        Assert.NotNull(result.Account.VerificationSubmittedAt);
        Assert.Equal(0, verifier.CallCount);
    }

    [Fact]
    public async Task SubmitProfessionalCredentialAsync_WithUnknownAccountId_ReturnsAccountNotFound()
    {
        var store = new FakeAccountStore();
        var handler = new SubmitProfessionalCredentialHandler(store, new StubCouncilRegistryVerifier(verified: true));

        var result = await handler.Handle(
            new SubmitProfessionalCredentialCommand(Guid.NewGuid(), ProfessionalCredentialType.Crp, "06/123456", "SP", DocumentReference: null),
            CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(SubmitProfessionalCredentialFailureReason.AccountNotFound, result.FailureReason);
    }

    [Fact]
    public async Task SubmitProfessionalCredentialAsync_WithPatientAccount_ReturnsNotAProfessionalAccount()
    {
        var account = new Account(Guid.NewGuid(), "patient@example.com", AccountRole.Patient, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var handler = new SubmitProfessionalCredentialHandler(store, new StubCouncilRegistryVerifier(verified: true));

        var result = await handler.Handle(
            new SubmitProfessionalCredentialCommand(account.Id, ProfessionalCredentialType.Crp, "06/123456", "SP", DocumentReference: null),
            CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(SubmitProfessionalCredentialFailureReason.NotAProfessionalAccount, result.FailureReason);
    }

    [Fact]
    public async Task SubmitProfessionalCredentialAsync_WithAlreadyActiveAccount_ReturnsInvalidStateForSubmission()
    {
        var account = new Account(Guid.NewGuid(), "active-pro@example.com", AccountRole.Professional, SomeVerifier, null, AccountVerificationStatus.Active);
        var store = new FakeAccountStore(account);
        var handler = new SubmitProfessionalCredentialHandler(store, new StubCouncilRegistryVerifier(verified: true));

        var result = await handler.Handle(
            new SubmitProfessionalCredentialCommand(account.Id, ProfessionalCredentialType.Crp, "06/123456", "SP", DocumentReference: null),
            CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(SubmitProfessionalCredentialFailureReason.InvalidStateForSubmission, result.FailureReason);
    }

    [Fact]
    public async Task SubmitProfessionalCredentialAsync_WithRejectedAccount_AllowsResubmission()
    {
        var account = new Account(
            Guid.NewGuid(), "rejected-pro@example.com", AccountRole.Professional, SomeVerifier, null,
            AccountVerificationStatus.Rejected, RejectionReason: "motivo anterior");
        var store = new FakeAccountStore(account);
        var verifier = new StubCouncilRegistryVerifier(verified: true);
        var handler = new SubmitProfessionalCredentialHandler(store, verifier);

        var result = await handler.Handle(
            new SubmitProfessionalCredentialCommand(account.Id, ProfessionalCredentialType.Crp, "06/123456", "SP", DocumentReference: null),
            CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(AccountVerificationStatus.Active, result.Account!.VerificationStatus);
        Assert.Null(result.Account.RejectionReason);
    }

    [Fact]
    public async Task DecideProfessionalVerificationAsync_WithApprovedFromInReview_MovesToActive()
    {
        var account = new Account(
            Guid.NewGuid(), "doc-review@example.com", AccountRole.Professional, SomeVerifier, null,
            AccountVerificationStatus.InReview, VerificationSubmittedAt: DateTimeOffset.UtcNow);
        var store = new FakeAccountStore(account);
        var handler = new DecideProfessionalVerificationHandler(store);

        var result = await handler.Handle(new DecideProfessionalVerificationCommand(account.Id, Approved: true, RejectionReason: null), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(AccountVerificationStatus.Active, result.Account!.VerificationStatus);
    }

    [Fact]
    public async Task DecideProfessionalVerificationAsync_WithRejectedFromInReview_MovesToRejected_WithReason()
    {
        var account = new Account(
            Guid.NewGuid(), "doc-review-2@example.com", AccountRole.Professional, SomeVerifier, null,
            AccountVerificationStatus.InReview, VerificationSubmittedAt: DateTimeOffset.UtcNow);
        var store = new FakeAccountStore(account);
        var handler = new DecideProfessionalVerificationHandler(store);

        var result = await handler.Handle(
            new DecideProfessionalVerificationCommand(account.Id, Approved: false, RejectionReason: "Documento ilegível, reenvie em PDF."),
            CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(AccountVerificationStatus.Rejected, result.Account!.VerificationStatus);
        Assert.Equal("Documento ilegível, reenvie em PDF.", result.Account.RejectionReason);
    }

    [Fact]
    public async Task DecideProfessionalVerificationAsync_WithAccountNotInReview_ReturnsNotInReview()
    {
        var account = PendingProfessional("not-in-review@example.com");
        var store = new FakeAccountStore(account);
        var handler = new DecideProfessionalVerificationHandler(store);

        var result = await handler.Handle(new DecideProfessionalVerificationCommand(account.Id, Approved: true, RejectionReason: null), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(ProfessionalVerificationDecisionFailureReason.NotInReview, result.FailureReason);
    }

    [Fact]
    public async Task DecideProfessionalVerificationAsync_WithUnknownAccountId_ReturnsAccountNotFound()
    {
        var store = new FakeAccountStore();
        var handler = new DecideProfessionalVerificationHandler(store);

        var result = await handler.Handle(new DecideProfessionalVerificationCommand(Guid.NewGuid(), Approved: true, RejectionReason: null), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(ProfessionalVerificationDecisionFailureReason.AccountNotFound, result.FailureReason);
    }

    [Fact]
    public async Task ListPendingProfessionalVerificationsAsync_ReturnsOnlyInReviewAccounts()
    {
        var inReview = new Account(
            Guid.NewGuid(), "queued@example.com", AccountRole.Professional, SomeVerifier, null,
            AccountVerificationStatus.InReview, VerificationSubmittedAt: DateTimeOffset.UtcNow);
        var pending = PendingProfessional("still-pending@example.com");
        var store = new FakeAccountStore(inReview, pending);

        var queue = await store.ListPendingDocumentReviewAsync(CancellationToken.None);

        var queuedAccount = Assert.Single(queue);
        Assert.Equal(inReview.Id, queuedAccount.Id);
    }

    private static Account PendingProfessional(string email) =>
        new(Guid.NewGuid(), email, AccountRole.Professional, SomeVerifier, null, AccountVerificationStatus.Pending);

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountVerifierLengths.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }

    private sealed class FakeAccountStore : IAccountStore
    {
        private readonly Dictionary<Guid, Account> _accountsById = new();

        public FakeAccountStore(params Account[] seed)
        {
            foreach (var account in seed)
            {
                _accountsById[account.Id] = account;
            }
        }

        public Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken) =>
            Task.FromResult(_accountsById.Values.SingleOrDefault(a => a.Email == normalizedEmail));

        public Task<Account?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
            Task.FromResult(_accountsById.GetValueOrDefault(id));

        public Task InsertAsync(Account account, CancellationToken cancellationToken)
        {
            _accountsById[account.Id] = account;
            return Task.CompletedTask;
        }

        public Task UpdateAsync(Account account, CancellationToken cancellationToken)
        {
            _accountsById[account.Id] = account;
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<Account>> ListPendingDocumentReviewAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Account>>(_accountsById.Values
                .Where(a => a.Role == AccountRole.Professional && a.VerificationStatus == AccountVerificationStatus.InReview)
                .OrderBy(a => a.VerificationSubmittedAt)
                .ToList());
    }

    private sealed class StubGoogleIdentityProvider : IGoogleIdentityProvider
    {
        private readonly GoogleIdentity? _identity;

        public StubGoogleIdentityProvider(GoogleIdentity? identity = null) => _identity = identity;

        public Task<GoogleIdentity?> VerifyIdTokenAsync(string idToken, CancellationToken cancellationToken) =>
            Task.FromResult(_identity);
    }

    private sealed class StubCouncilRegistryVerifier : ICouncilRegistryVerifier
    {
        private readonly bool _verified;
        private readonly string? _failureReason;

        public StubCouncilRegistryVerifier(bool verified, string? failureReason = null)
        {
            _verified = verified;
            _failureReason = failureReason;
        }

        public int CallCount { get; private set; }

        public ProfessionalCredentialType? LastRequestedType { get; private set; }

        public Task<CouncilRegistryVerificationResult> VerifyAsync(
            ProfessionalCredentialType type, string registryNumber, string registryUf, CancellationToken cancellationToken)
        {
            CallCount++;
            LastRequestedType = type;
            return Task.FromResult(_verified
                ? CouncilRegistryVerificationResult.CreateVerified()
                : CouncilRegistryVerificationResult.NotVerified(_failureReason ?? "Registro não encontrado."));
        }
    }
}
