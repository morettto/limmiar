using System.Security.Cryptography;
using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class AccountServiceRecoveryTests
{
    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);
    private static readonly byte[] SomeEnvelope = Enumerable.Repeat((byte)0x07, 120).ToArray();

    [Fact]
    public async Task RecoverAccess_WithoutClinicalKeyEnvelope_DoesNotPretendToRestoreAccess()
    {
        var account = new Account(Guid.NewGuid(), "old@example.com", AccountRole.Professional, SomeVerifier, null,
            RecoveryVerifier: CreateVerifier(0x02));
        var handler = CreateRecoverAccessHandler(new FakeAccountStore(account), new StubPasswordVerifierComparer(alwaysMatches: true));
        var result = await handler.Handle(new RecoverAccessCommand(account.Email, CreateVerifier(0x02)), CancellationToken.None);
        Assert.False(result.Succeeded);
        Assert.Null(result.Account);
        Assert.Null(result.Session);
    }

    [Fact]
    public async Task RecoverAccessAsync_WithUnknownEmail_ReturnsInvalidRecoveryPhrase()
    {
        var store = new FakeAccountStore();
        var handler = CreateRecoverAccessHandler(store, new StubPasswordVerifierComparer(alwaysMatches: false));

        var result = await handler.Handle(new RecoverAccessCommand("ghost@example.com", SomeVerifier), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountRecoveryFailureReason.InvalidRecoveryPhrase, result.FailureReason);
        Assert.Null(result.Account);
    }

    [Fact]
    public async Task RecoverAccessAsync_WithAccountThatNeverRegisteredARecoveryVerifier_ReturnsInvalidRecoveryPhrase()
    {
        var account = new Account(Guid.NewGuid(), "no-recovery@example.com", AccountRole.Professional, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var handler = CreateRecoverAccessHandler(store, new StubPasswordVerifierComparer(alwaysMatches: true));

        var result = await handler.Handle(new RecoverAccessCommand("no-recovery@example.com", SomeVerifier), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountRecoveryFailureReason.InvalidRecoveryPhrase, result.FailureReason);
    }

    [Fact]
    public async Task RecoverAccessAsync_WithWrongVerifier_ReturnsInvalidRecoveryPhrase()
    {
        var account = new Account(
            Guid.NewGuid(), "known@example.com", AccountRole.Professional, SomeVerifier, null,
            RecoveryVerifier: CreateVerifier(0x02), RecoveryEnvelope: SomeEnvelope);
        var store = new FakeAccountStore(account);
        var handler = CreateRecoverAccessHandler(store, new StubPasswordVerifierComparer(alwaysMatches: false));

        var result = await handler.Handle(new RecoverAccessCommand("known@example.com", CreateVerifier(0xFF)), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountRecoveryFailureReason.InvalidRecoveryPhrase, result.FailureReason);
    }

    [Fact]
    public async Task RecoverAccessAsync_WithUnknownEmail_StillInvokesComparerOnce_WithSameLengthAsRealVerifier()
    {
        var store = new FakeAccountStore();
        var comparer = new RecordingPasswordVerifierComparer(result: false);
        var handler = CreateRecoverAccessHandler(store, comparer);

        await handler.Handle(new RecoverAccessCommand("ghost@example.com", SomeVerifier), CancellationToken.None);

        Assert.Equal(1, comparer.CallCount);
        Assert.Equal(AccountVerifierLengths.PasswordVerifierLength, comparer.LastStoredLength);
    }

    [Fact]
    public async Task RecoverAccessAsync_WithCorrectVerifierAndNoTwoFactorPending_ReturnsSuccessWithSession()
    {
        var account = new Account(
            Guid.NewGuid(), "patient@example.com", AccountRole.Patient, SomeVerifier, null,
            RecoveryVerifier: CreateVerifier(0x02), RecoveryEnvelope: SomeEnvelope);
        var store = new FakeAccountStore(account);
        var handler = CreateRecoverAccessHandler(store, new StubPasswordVerifierComparer(alwaysMatches: true));

        var result = await handler.Handle(new RecoverAccessCommand("patient@example.com", CreateVerifier(0x02)), CancellationToken.None);

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
            RecoveryVerifier: CreateVerifier(0x02), RecoveryEnvelope: SomeEnvelope);
        var store = new FakeAccountStore(account);
        var handler = CreateRecoverAccessHandler(store, new StubPasswordVerifierComparer(alwaysMatches: true));

        var result = await handler.Handle(new RecoverAccessCommand("pro@example.com", CreateVerifier(0x02)), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(TwoFactorRequirement.SetupRequired, result.TwoFactorRequirement);
        Assert.NotNull(result.TwoFactorTicket);
        Assert.Null(result.Session);
    }

    [Fact]
    public async Task RegisterRecoveryVerifierAsync_WithUnknownAccountId_ReturnsAccountNotFound()
    {
        var store = new FakeAccountStore();
        var handler = new RegisterRecoveryVerifierHandler(store);

        var result = await handler.Handle(new RegisterRecoveryVerifierCommand(Guid.NewGuid(), SomeVerifier, SomeEnvelope), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(RegisterRecoveryVerifierFailureReason.AccountNotFound, result.FailureReason);
    }

    [Fact]
    public async Task RegisterRecoveryVerifierAsync_WithPatientAccount_ReturnsNotAProfessionalAccount()
    {
        var account = new Account(Guid.NewGuid(), "patient@example.com", AccountRole.Patient, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var handler = new RegisterRecoveryVerifierHandler(store);

        var result = await handler.Handle(new RegisterRecoveryVerifierCommand(account.Id, SomeVerifier, SomeEnvelope), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(RegisterRecoveryVerifierFailureReason.NotAProfessionalAccount, result.FailureReason);
    }

    [Fact]
    public async Task RegisterRecoveryVerifierAsync_WithProfessionalAccount_StoresVerifierAndReturnsSuccess()
    {
        var account = new Account(Guid.NewGuid(), "pro@example.com", AccountRole.Professional, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var handler = new RegisterRecoveryVerifierHandler(store);

        var result = await handler.Handle(new RegisterRecoveryVerifierCommand(account.Id, SomeVerifier, SomeEnvelope), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(SHA256.HashData(SomeVerifier), result.Account!.RecoveryVerifier);

        var stored = await store.FindByIdAsync(account.Id, CancellationToken.None);
        Assert.Equal(SHA256.HashData(SomeVerifier), stored!.RecoveryVerifier);
        Assert.Equal(SomeEnvelope, stored.RecoveryEnvelope);
    }

    // Same discipline as RegisterHandler: a store dump must never contain the recovery
    // verifier, only its SHA-256.
    [Fact]
    public async Task RegisterRecoveryVerifierAsync_StoresSha256OfVerifier_NotTheVerifier()
    {
        var account = new Account(Guid.NewGuid(), "pro-hash@example.com", AccountRole.Professional, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var handler = new RegisterRecoveryVerifierHandler(store);

        var result = await handler.Handle(new RegisterRecoveryVerifierCommand(account.Id, SomeVerifier, SomeEnvelope), CancellationToken.None);

        Assert.NotEqual(SomeVerifier, result.Account!.RecoveryVerifier);
        Assert.Equal(SHA256.HashData(SomeVerifier), result.Account.RecoveryVerifier);
    }

    [Fact]
    public async Task RegisterRecoveryVerifierAsync_CalledTwice_OverwritesThePreviousVerifier()
    {
        var account = new Account(Guid.NewGuid(), "pro@example.com", AccountRole.Professional, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var handler = new RegisterRecoveryVerifierHandler(store);
        var firstVerifier = CreateVerifier(0x02);
        var secondVerifier = CreateVerifier(0x03);

        await handler.Handle(new RegisterRecoveryVerifierCommand(account.Id, firstVerifier, SomeEnvelope), CancellationToken.None);
        var result = await handler.Handle(new RegisterRecoveryVerifierCommand(account.Id, secondVerifier, SomeEnvelope), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(SHA256.HashData(secondVerifier), result.Account!.RecoveryVerifier);
    }

    private static RecoverAccessHandler CreateRecoverAccessHandler(FakeAccountStore store, IPasswordVerifierComparer comparer) =>
        new(store, comparer, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountVerifierLengths.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }

    private sealed class FakeAccountStore : IAccountStore
    {
        private readonly Dictionary<Guid, Account> _accountsByEmail = new();

        public FakeAccountStore(params Account[] seed)
        {
            foreach (var account in seed)
            {
                _accountsByEmail[account.Id] = account;
            }
        }

        public Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken) =>
            Task.FromResult(_accountsByEmail.Values.FirstOrDefault(account => account.Email == normalizedEmail));

        public Task<Account?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
            Task.FromResult(_accountsByEmail.Values.FirstOrDefault(account => account.Id == id));

        public async Task<string?> GetOrCreatePendingTotpSecretAsync(Guid id, string candidate, CancellationToken cancellationToken)
        {
            var account = await FindByIdAsync(id, cancellationToken);
            if (account is null || account.Role != AccountRole.Professional || account.TotpEnabledAt is not null) return null;
            var secret = account.TotpSecret ?? candidate;
            await MutateAsync(account.Id, current => current with { TotpSecret = secret }, cancellationToken);
            return secret;
        }

        public Task InsertAsync(Account account, CancellationToken cancellationToken)
        {
            _accountsByEmail[account.Id] = account;
            return Task.CompletedTask;
        }

        public Task<Account?> MutateAsync(Guid id, Func<Account, Account?> mutation, CancellationToken cancellationToken)
        {
            if (!_accountsByEmail.TryGetValue(id, out var current)) return Task.FromResult<Account?>(null);
            var updated = mutation(current);
            if (updated is not null) _accountsByEmail[id] = updated;
            return Task.FromResult(updated);
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
}
