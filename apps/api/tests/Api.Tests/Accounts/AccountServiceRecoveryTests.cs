using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class AccountServiceRecoveryTests
{
    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    [Fact]
    public async Task RecoverAccessAsync_WithUnknownEmail_ReturnsInvalidRecoveryPhrase()
    {
        var store = new FakeAccountStore();
        var service = CreateService(store, new StubPasswordVerifierComparer(alwaysMatches: false));

        var result = await service.RecoverAccessAsync("ghost@example.com", SomeVerifier, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountRecoveryFailureReason.InvalidRecoveryPhrase, result.FailureReason);
        Assert.Null(result.Account);
    }

    [Fact]
    public async Task RecoverAccessAsync_WithAccountThatNeverRegisteredARecoveryVerifier_ReturnsInvalidRecoveryPhrase()
    {
        var account = new Account(Guid.NewGuid(), "no-recovery@example.com", AccountRole.Professional, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var service = CreateService(store, new StubPasswordVerifierComparer(alwaysMatches: true));

        var result = await service.RecoverAccessAsync("no-recovery@example.com", SomeVerifier, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountRecoveryFailureReason.InvalidRecoveryPhrase, result.FailureReason);
    }

    [Fact]
    public async Task RecoverAccessAsync_WithWrongVerifier_ReturnsInvalidRecoveryPhrase()
    {
        var account = new Account(
            Guid.NewGuid(), "known@example.com", AccountRole.Professional, SomeVerifier, null,
            RecoveryVerifier: CreateVerifier(0x02));
        var store = new FakeAccountStore(account);
        var service = CreateService(store, new StubPasswordVerifierComparer(alwaysMatches: false));

        var result = await service.RecoverAccessAsync("known@example.com", CreateVerifier(0xFF), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountRecoveryFailureReason.InvalidRecoveryPhrase, result.FailureReason);
    }

    [Fact]
    public async Task RecoverAccessAsync_WithUnknownEmail_StillInvokesComparerOnce_WithSameLengthAsRealVerifier()
    {
        var store = new FakeAccountStore();
        var comparer = new RecordingPasswordVerifierComparer(result: false);
        var service = CreateService(store, comparer);

        await service.RecoverAccessAsync("ghost@example.com", SomeVerifier, CancellationToken.None);

        Assert.Equal(1, comparer.CallCount);
        Assert.Equal(AccountService.PasswordVerifierLength, comparer.LastStoredLength);
    }

    [Fact]
    public async Task RecoverAccessAsync_WithCorrectVerifierAndNoTwoFactorPending_ReturnsSuccessWithSession()
    {
        var account = new Account(
            Guid.NewGuid(), "patient@example.com", AccountRole.Patient, SomeVerifier, null,
            RecoveryVerifier: CreateVerifier(0x02));
        var store = new FakeAccountStore(account);
        var service = CreateService(store, new StubPasswordVerifierComparer(alwaysMatches: true));

        var result = await service.RecoverAccessAsync("patient@example.com", CreateVerifier(0x02), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Same(account, result.Account);
        Assert.NotNull(result.Session);
        Assert.Null(result.TwoFactorTicket);
    }

    [Fact]
    public async Task RecoverAccessAsync_WithCorrectVerifierAndProfessionalTwoFactorPending_ReturnsTicketWithoutSession()
    {
        var account = new Account(
            Guid.NewGuid(), "pro@example.com", AccountRole.Professional, SomeVerifier, null,
            RecoveryVerifier: CreateVerifier(0x02));
        var store = new FakeAccountStore(account);
        var service = CreateService(store, new StubPasswordVerifierComparer(alwaysMatches: true));

        var result = await service.RecoverAccessAsync("pro@example.com", CreateVerifier(0x02), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(TwoFactorRequirement.SetupRequired, result.TwoFactorRequirement);
        Assert.NotNull(result.TwoFactorTicket);
        Assert.Null(result.Session);
    }

    [Fact]
    public async Task RegisterRecoveryVerifierAsync_WithUnknownAccountId_ReturnsAccountNotFound()
    {
        var store = new FakeAccountStore();
        var service = CreateService(store, new StubPasswordVerifierComparer(alwaysMatches: false));

        var result = await service.RegisterRecoveryVerifierAsync(Guid.NewGuid(), SomeVerifier, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(RegisterRecoveryVerifierFailureReason.AccountNotFound, result.FailureReason);
    }

    [Fact]
    public async Task RegisterRecoveryVerifierAsync_WithPatientAccount_ReturnsNotAProfessionalAccount()
    {
        var account = new Account(Guid.NewGuid(), "patient@example.com", AccountRole.Patient, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var service = CreateService(store, new StubPasswordVerifierComparer(alwaysMatches: false));

        var result = await service.RegisterRecoveryVerifierAsync(account.Id, SomeVerifier, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(RegisterRecoveryVerifierFailureReason.NotAProfessionalAccount, result.FailureReason);
    }

    [Fact]
    public async Task RegisterRecoveryVerifierAsync_WithProfessionalAccount_StoresVerifierAndReturnsSuccess()
    {
        var account = new Account(Guid.NewGuid(), "pro@example.com", AccountRole.Professional, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var service = CreateService(store, new StubPasswordVerifierComparer(alwaysMatches: false));

        var result = await service.RegisterRecoveryVerifierAsync(account.Id, SomeVerifier, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(SomeVerifier, result.Account!.RecoveryVerifier);

        var stored = await store.FindByIdAsync(account.Id, CancellationToken.None);
        Assert.Equal(SomeVerifier, stored!.RecoveryVerifier);
    }

    [Fact]
    public async Task RegisterRecoveryVerifierAsync_CalledTwice_OverwritesThePreviousVerifier()
    {
        var account = new Account(Guid.NewGuid(), "pro@example.com", AccountRole.Professional, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var service = CreateService(store, new StubPasswordVerifierComparer(alwaysMatches: false));
        var firstVerifier = CreateVerifier(0x02);
        var secondVerifier = CreateVerifier(0x03);

        await service.RegisterRecoveryVerifierAsync(account.Id, firstVerifier, CancellationToken.None);
        var result = await service.RegisterRecoveryVerifierAsync(account.Id, secondVerifier, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(secondVerifier, result.Account!.RecoveryVerifier);
    }

    private static AccountService CreateService(FakeAccountStore store, IPasswordVerifierComparer comparer) =>
        new(store, comparer, new StubGoogleIdentityProvider());

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountService.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }

    private sealed class FakeAccountStore : IAccountStore
    {
        private readonly Dictionary<string, Account> _accountsByEmail = new(StringComparer.Ordinal);

        public FakeAccountStore(params Account[] seed)
        {
            foreach (var account in seed)
            {
                _accountsByEmail[account.Email] = account;
            }
        }

        public Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken) =>
            Task.FromResult(_accountsByEmail.GetValueOrDefault(normalizedEmail));

        public Task<Account?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
            Task.FromResult(_accountsByEmail.Values.FirstOrDefault(account => account.Id == id));

        public Task InsertAsync(Account account, CancellationToken cancellationToken)
        {
            _accountsByEmail[account.Email] = account;
            return Task.CompletedTask;
        }

        public Task UpdateAsync(Account account, CancellationToken cancellationToken)
        {
            _accountsByEmail[account.Email] = account;
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<Account>> ListPendingDocumentReviewAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Account>>(_accountsByEmail.Values
                .Where(account => account.Role == AccountRole.Professional && account.VerificationStatus == AccountVerificationStatus.InReview)
                .OrderBy(account => account.VerificationSubmittedAt)
                .ToList());
    }

    private sealed class StubPasswordVerifierComparer : IPasswordVerifierComparer
    {
        private readonly bool _alwaysMatches;

        public StubPasswordVerifierComparer(bool alwaysMatches) => _alwaysMatches = alwaysMatches;

        public bool Matches(byte[] submitted, byte[] stored) => _alwaysMatches;
    }

    private sealed class RecordingPasswordVerifierComparer : IPasswordVerifierComparer
    {
        private readonly bool _result;

        public RecordingPasswordVerifierComparer(bool result) => _result = result;

        public int CallCount { get; private set; }

        public int? LastStoredLength { get; private set; }

        public bool Matches(byte[] submitted, byte[] stored)
        {
            CallCount++;
            LastStoredLength = stored.Length;
            return _result;
        }
    }

    private sealed class StubGoogleIdentityProvider : IGoogleIdentityProvider
    {
        public Task<GoogleIdentity?> VerifyIdTokenAsync(string idToken, CancellationToken cancellationToken) =>
            Task.FromResult<GoogleIdentity?>(null);
    }
}
