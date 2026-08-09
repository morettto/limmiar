using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class AccountServiceTests
{
    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    [Fact]
    public async Task RegisterAsync_WithNewEmail_CreatesAccountWithRequestedRoleAndVerifier()
    {
        var store = new FakeAccountStore();
        var service = new AccountService(store, new StubPasswordVerifierComparer(alwaysMatches: false), new StubGoogleIdentityProvider());

        var result = await service.RegisterAsync("new@example.com", SomeVerifier, AccountRole.Professional, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.NotNull(result.Account);
        Assert.Equal("new@example.com", result.Account!.Email);
        Assert.Equal(AccountRole.Professional, result.Account.Role);
        Assert.Equal(SomeVerifier, result.Account.PasswordVerifier);
        Assert.NotEqual(Guid.Empty, result.Account.Id);
    }

    [Fact]
    public async Task RegisterAsync_WithEmailAlreadyRegistered_ReturnsFailure_AndDoesNotOverwriteExistingAccount()
    {
        var existingAccount = new Account(Guid.NewGuid(), "taken@example.com", AccountRole.Patient, CreateVerifier(0x02), null);
        var store = new FakeAccountStore(existingAccount);
        var service = new AccountService(store, new StubPasswordVerifierComparer(alwaysMatches: false), new StubGoogleIdentityProvider());

        var result = await service.RegisterAsync("taken@example.com", SomeVerifier, AccountRole.Professional, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountRegistrationFailureReason.EmailAlreadyRegistered, result.FailureReason);
        Assert.Null(result.Account);

        var stored = await store.FindByEmailAsync("taken@example.com", CancellationToken.None);
        Assert.Same(existingAccount, stored);
    }

    [Fact]
    public async Task LoginAsync_WithCorrectVerifier_ReturnsSuccessWithAccount()
    {
        var existingAccount = new Account(Guid.NewGuid(), "known@example.com", AccountRole.Patient, SomeVerifier, null);
        var store = new FakeAccountStore(existingAccount);
        var service = new AccountService(store, new StubPasswordVerifierComparer(alwaysMatches: true), new StubGoogleIdentityProvider());

        var result = await service.LoginAsync("known@example.com", SomeVerifier, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Same(existingAccount, result.Account);
    }

    [Fact]
    public async Task LoginAsync_WithWrongVerifier_ReturnsInvalidCredentials()
    {
        var existingAccount = new Account(Guid.NewGuid(), "known@example.com", AccountRole.Patient, SomeVerifier, null);
        var store = new FakeAccountStore(existingAccount);
        var service = new AccountService(store, new StubPasswordVerifierComparer(alwaysMatches: false), new StubGoogleIdentityProvider());

        var result = await service.LoginAsync("known@example.com", CreateVerifier(0xFF), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountLoginFailureReason.InvalidCredentials, result.FailureReason);
        Assert.Null(result.Account);
    }

    [Fact]
    public async Task LoginAsync_WithUnknownEmail_ReturnsSameFailureAsWrongVerifier()
    {
        var store = new FakeAccountStore();
        var service = new AccountService(store, new StubPasswordVerifierComparer(alwaysMatches: false), new StubGoogleIdentityProvider());

        var result = await service.LoginAsync("ghost@example.com", SomeVerifier, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountLoginFailureReason.InvalidCredentials, result.FailureReason);
        Assert.Null(result.Account);
    }

    /// <summary>
    /// S02-01 acceptance criterion: "Resposta idêntica, no mesmo tempo, para e-mail
    /// inexistente e senha errada". Identical response shape is covered by the two tests
    /// above (both return the single AccountLoginFailureReason.InvalidCredentials value).
    /// This pair proves the "no shortcut" half of the guarantee: LoginAsync must call the
    /// comparer exactly once on BOTH paths, with an equal-length stored side both times --
    /// never skipping the comparison because the account wasn't found. A regression that
    /// adds `if (account is null) return Failure(...);` before the comparison would fail
    /// this by dropping the unknown-email call count to zero.
    /// </summary>
    [Fact]
    public async Task LoginAsync_WithUnknownEmail_StillInvokesComparerOnce_WithSameLengthAsRealVerifier()
    {
        var store = new FakeAccountStore();
        var comparer = new RecordingPasswordVerifierComparer(result: false);
        var service = new AccountService(store, comparer, new StubGoogleIdentityProvider());

        await service.LoginAsync("ghost@example.com", SomeVerifier, CancellationToken.None);

        Assert.Equal(1, comparer.CallCount);
        Assert.Equal(AccountService.PasswordVerifierLength, comparer.LastStoredLength);
    }

    [Fact]
    public async Task LoginAsync_WithWrongVerifier_InvokesComparerOnce_WithSameLengthAsUnknownEmailCase()
    {
        var existingAccount = new Account(Guid.NewGuid(), "known@example.com", AccountRole.Patient, SomeVerifier, null);
        var store = new FakeAccountStore(existingAccount);
        var comparer = new RecordingPasswordVerifierComparer(result: false);
        var service = new AccountService(store, comparer, new StubGoogleIdentityProvider());

        await service.LoginAsync("known@example.com", CreateVerifier(0xFF), CancellationToken.None);

        Assert.Equal(1, comparer.CallCount);
        Assert.Equal(AccountService.PasswordVerifierLength, comparer.LastStoredLength);
    }

    [Fact]
    public async Task LoginAsync_WithGoogleOnlyAccount_ReturnsInvalidCredentials()
    {
        // An account created via Google sign-in and never given a password has a null
        // PasswordVerifier -- attempting e-mail/verifier login against it must fail the
        // same way as any other wrong-credentials case, not throw or succeed.
        var googleOnlyAccount = new Account(Guid.NewGuid(), "google-only@example.com", AccountRole.Patient, PasswordVerifier: null, "google-subject-1");
        var store = new FakeAccountStore(googleOnlyAccount);
        var comparer = new RecordingPasswordVerifierComparer(result: false);
        var service = new AccountService(store, comparer, new StubGoogleIdentityProvider());

        var result = await service.LoginAsync("google-only@example.com", SomeVerifier, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountLoginFailureReason.InvalidCredentials, result.FailureReason);
        Assert.Equal(1, comparer.CallCount);
        Assert.Equal(AccountService.PasswordVerifierLength, comparer.LastStoredLength);
    }

    /// <summary>
    /// Security-review regression (S02-01): LoginAsync's account-enumeration fallback
    /// compares against a constant all-zero DummyVerifier whenever there's no real stored
    /// verifier -- which used to be reachable not just for an unknown e-mail (where
    /// `account is null` still forces failure) but also for a real, existing Google-only
    /// account (PasswordVerifier null). Submitting an all-zero verifier used to match
    /// DummyVerifier byte-for-byte and log in as that account with no password ever set.
    /// Uses the REAL <see cref="ConstantTimePasswordVerifierComparer"/> deliberately --
    /// the other Google-only test above stubs the comparer to always return false, which
    /// would never have caught this (the bug is in what gets compared, not in trusting the
    /// comparer's stubbed result).
    /// </summary>
    [Fact]
    public async Task LoginAsync_WithGoogleOnlyAccount_AllZeroVerifierDoesNotMatchDummyVerifier()
    {
        var googleOnlyAccount = new Account(Guid.NewGuid(), "google-only@example.com", AccountRole.Professional, PasswordVerifier: null, "google-subject-1");
        var store = new FakeAccountStore(googleOnlyAccount);
        var service = new AccountService(store, new ConstantTimePasswordVerifierComparer(), new StubGoogleIdentityProvider());
        var allZeroVerifier = new byte[AccountService.PasswordVerifierLength];

        var result = await service.LoginAsync("google-only@example.com", allZeroVerifier, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountLoginFailureReason.InvalidCredentials, result.FailureReason);
        Assert.Null(result.Account);
    }

    [Fact]
    public async Task GoogleAuthAsync_WithNewEmail_CreatesAccountWithRequestedRole_AndReportsNewAccount()
    {
        var store = new FakeAccountStore();
        var identity = new GoogleIdentity("new-via-google@example.com", "google-subject-1");
        var service = new AccountService(store, new StubPasswordVerifierComparer(alwaysMatches: false), new StubGoogleIdentityProvider(identity));

        var result = await service.GoogleAuthAsync("valid-id-token", AccountRole.Professional, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.True(result.IsNewAccount);
        Assert.Equal("new-via-google@example.com", result.Account!.Email);
        Assert.Equal(AccountRole.Professional, result.Account.Role);
        Assert.Equal("google-subject-1", result.Account.GoogleSubjectId);
        Assert.Null(result.Account.PasswordVerifier);
    }

    /// <summary>S02-01 acceptance criterion: "Google resolve o papel sozinho quando o
    /// e-mail já existe" -- the requestedRole the caller sends must be ignored, and the
    /// account's existing role returned instead, with no new account created.</summary>
    [Fact]
    public async Task GoogleAuthAsync_WithEmailAlreadyRegistered_ResolvesExistingRole_IgnoringRequestedRole()
    {
        var existingAccount = new Account(Guid.NewGuid(), "already-here@example.com", AccountRole.Professional, SomeVerifier, null);
        var store = new FakeAccountStore(existingAccount);
        var identity = new GoogleIdentity("already-here@example.com", "google-subject-2");
        var service = new AccountService(store, new StubPasswordVerifierComparer(alwaysMatches: false), new StubGoogleIdentityProvider(identity));

        var result = await service.GoogleAuthAsync("valid-id-token", AccountRole.Patient, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.False(result.IsNewAccount);
        Assert.Same(existingAccount, result.Account);
        Assert.Equal(AccountRole.Professional, result.Account!.Role);
    }

    [Fact]
    public async Task GoogleAuthAsync_WithInvalidGoogleToken_ReturnsFailure()
    {
        var store = new FakeAccountStore();
        var service = new AccountService(store, new StubPasswordVerifierComparer(alwaysMatches: false), new StubGoogleIdentityProvider(identity: null));

        var result = await service.GoogleAuthAsync("bad-id-token", AccountRole.Patient, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountGoogleAuthFailureReason.InvalidGoogleToken, result.FailureReason);
        Assert.Null(result.Account);
    }

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
        private readonly GoogleIdentity? _identity;

        public StubGoogleIdentityProvider(GoogleIdentity? identity = null) => _identity = identity;

        public Task<GoogleIdentity?> VerifyIdTokenAsync(string idToken, CancellationToken cancellationToken) =>
            Task.FromResult(_identity);
    }
}
