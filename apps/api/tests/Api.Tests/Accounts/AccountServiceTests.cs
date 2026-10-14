using System.Security.Cryptography;
using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class AccountServiceTests
{
    [Fact]
    public async Task GoogleAuth_ProfessionalRequestCannotReuseAPatientIdentity()
    {
        var patient = new Account(Guid.NewGuid(), "invalid-stored-identity@example.test", AccountRole.Patient, null, null);
        var handler = new ContinueWithGoogleHandler(new StubGoogleIdentityProvider(new GoogleIdentity(patient.Email!, "subject")),
            new FakeAccountStore(patient), new TwoFactorTicketIssuer(), new SessionTokenIssuer());
        var result = await handler.Handle(new ContinueWithGoogleCommand("token", AccountRole.Professional), CancellationToken.None);
        Assert.False(result.TryGetValue(out _));
    }
    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    [Fact]
    public async Task RegisterAsync_WithNewEmail_CreatesAccountWithRequestedRoleAndVerifier()
    {
        var store = new FakeAccountStore();
        var handler = new RegisterHandler(store, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new RegisterCommand("new@example.com", SomeVerifier, AccountRole.Professional), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.NotNull(result.Account);
        Assert.Equal("new@example.com", result.Account!.Email);
        Assert.Equal(AccountRole.Professional, result.Account.Role);
        Assert.Equal(SHA256.HashData(SomeVerifier), result.Account.PasswordVerifier);
        Assert.NotEqual(Guid.Empty, result.Account.Id);
    }

    // A dump of the store (or a Postgres backup) must never contain the verifier itself --
    // only SHA256(verifier). The verifier is already the output of a slow client-side KDF
    // (Argon2id, ACCOUNT_VERIFIER_PARAMS in packages/crypto), so a fast hash on top is enough
    // to keep a raw dump from being replayable as a login, without re-deriving a second slow
    // KDF server-side. See ConstantTimePasswordVerifierComparer, which re-hashes what the
    // client submits before comparing.
    [Fact]
    public async Task RegisterAsync_StoresSha256OfVerifier_NotTheVerifier()
    {
        var store = new FakeAccountStore();
        var handler = new RegisterHandler(store, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new RegisterCommand("hashed@example.com", SomeVerifier, AccountRole.Professional), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.NotEqual(SomeVerifier, result.Account!.PasswordVerifier);
        Assert.Equal(SHA256.HashData(SomeVerifier), result.Account.PasswordVerifier);
    }

    [Fact]
    public async Task RegisterAsync_WithEmailAlreadyRegistered_ReturnsFailure_AndDoesNotOverwriteExistingAccount()
    {
        var existingAccount = new Account(Guid.NewGuid(), "taken@example.com", AccountRole.Patient, CreateVerifier(0x02), null);
        var store = new FakeAccountStore(existingAccount);
        var handler = new RegisterHandler(store, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new RegisterCommand("taken@example.com", SomeVerifier, AccountRole.Professional), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(AccountRegistrationFailureReason.EmailAlreadyRegistered, result.FailureReason);
        Assert.Null(result.Account);

        var stored = await store.FindByEmailAsync("taken@example.com", CancellationToken.None);
        Assert.Same(existingAccount, stored);
    }

    [Fact]
    public async Task LoginAsync_WithCorrectVerifier_ReturnsSuccessWithAccount()
    {
        var existingAccount = new Account(Guid.NewGuid(), "known@example.com", AccountRole.Professional, SomeVerifier, null);
        var store = new FakeAccountStore(existingAccount);
        var handler = new LoginHandler(store, new StubPasswordVerifierComparer(alwaysMatches: true), new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new LoginCommand("known@example.com", SomeVerifier), CancellationToken.None);

        Assert.True(result.TryGetValue(out var success));
        Assert.Same(existingAccount, success.Account);
    }

    [Fact]
    public async Task LoginAsync_WithWrongVerifier_ReturnsInvalidCredentials()
    {
        var existingAccount = new Account(Guid.NewGuid(), "known@example.com", AccountRole.Patient, SomeVerifier, null);
        var store = new FakeAccountStore(existingAccount);
        var handler = new LoginHandler(store, new StubPasswordVerifierComparer(alwaysMatches: false), new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new LoginCommand("known@example.com", CreateVerifier(0xFF)), CancellationToken.None);

        var failureReason = result.Match(
            _ => throw new InvalidOperationException("expected a failure"),
            reason => reason);
        Assert.Equal(AccountLoginFailureReason.InvalidCredentials, failureReason);
    }

    [Fact]
    public async Task LoginAsync_WithUnknownEmail_ReturnsSameFailureAsWrongVerifier()
    {
        var store = new FakeAccountStore();
        var handler = new LoginHandler(store, new StubPasswordVerifierComparer(alwaysMatches: false), new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new LoginCommand("ghost@example.com", SomeVerifier), CancellationToken.None);

        var failureReason = result.Match(
            _ => throw new InvalidOperationException("expected a failure"),
            reason => reason);
        Assert.Equal(AccountLoginFailureReason.InvalidCredentials, failureReason);
    }

    // Guards against a shortcut like `if (account is null) return Failure(...);` before the
    // comparison, which would drop the unknown-email call count to zero.
    [Fact]
    public async Task LoginAsync_WithUnknownEmail_StillInvokesComparerOnce_WithSameLengthAsRealVerifier()
    {
        var store = new FakeAccountStore();
        var comparer = new RecordingPasswordVerifierComparer(result: false);
        var handler = new LoginHandler(store, comparer, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        await handler.Handle(new LoginCommand("ghost@example.com", SomeVerifier), CancellationToken.None);

        Assert.Equal(1, comparer.CallCount);
        Assert.Equal(AccountVerifierLengths.PasswordVerifierLength, comparer.LastStoredLength);
    }

    [Fact]
    public async Task LoginAsync_WithWrongVerifier_InvokesComparerOnce_WithSameLengthAsUnknownEmailCase()
    {
        var existingAccount = new Account(Guid.NewGuid(), "known@example.com", AccountRole.Patient, SomeVerifier, null);
        var store = new FakeAccountStore(existingAccount);
        var comparer = new RecordingPasswordVerifierComparer(result: false);
        var handler = new LoginHandler(store, comparer, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        await handler.Handle(new LoginCommand("known@example.com", CreateVerifier(0xFF)), CancellationToken.None);

        Assert.Equal(1, comparer.CallCount);
        Assert.Equal(AccountVerifierLengths.PasswordVerifierLength, comparer.LastStoredLength);
    }

    [Fact]
    public async Task LoginAsync_WithGoogleOnlyAccount_ReturnsInvalidCredentials()
    {
        var googleOnlyAccount = new Account(Guid.NewGuid(), "google-only@example.com", AccountRole.Patient, PasswordVerifier: null, "google-subject-1");
        var store = new FakeAccountStore(googleOnlyAccount);
        var comparer = new RecordingPasswordVerifierComparer(result: false);
        var handler = new LoginHandler(store, comparer, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new LoginCommand("google-only@example.com", SomeVerifier), CancellationToken.None);

        var failureReason = result.Match(
            _ => throw new InvalidOperationException("expected a failure"),
            reason => reason);
        Assert.Equal(AccountLoginFailureReason.InvalidCredentials, failureReason);
        Assert.Equal(1, comparer.CallCount);
        Assert.Equal(AccountVerifierLengths.PasswordVerifierLength, comparer.LastStoredLength);
    }

    // Regression: an all-zero submitted verifier used to match the all-zero DummyVerifier
    // fallback byte-for-byte for a Google-only account. Uses the real
    // ConstantTimePasswordVerifierComparer, since a stubbed comparer would not catch this.
    [Fact]
    public async Task LoginAsync_WithGoogleOnlyAccount_AllZeroVerifierDoesNotMatchDummyVerifier()
    {
        var googleOnlyAccount = new Account(Guid.NewGuid(), "google-only@example.com", AccountRole.Professional, PasswordVerifier: null, "google-subject-1");
        var store = new FakeAccountStore(googleOnlyAccount);
        var handler = new LoginHandler(store, new ConstantTimePasswordVerifierComparer(), new TwoFactorTicketIssuer(), new SessionTokenIssuer());
        var allZeroVerifier = new byte[AccountVerifierLengths.PasswordVerifierLength];

        var result = await handler.Handle(new LoginCommand("google-only@example.com", allZeroVerifier), CancellationToken.None);

        var failureReason = result.Match(
            _ => throw new InvalidOperationException("expected a failure"),
            reason => reason);
        Assert.Equal(AccountLoginFailureReason.InvalidCredentials, failureReason);
    }

    [Fact]
    public async Task GoogleAuthAsync_WithNewEmail_CreatesAccountWithRequestedRole_AndReportsNewAccount()
    {
        var store = new FakeAccountStore();
        var identity = new GoogleIdentity("new-via-google@example.com", "google-subject-1");
        var handler = new ContinueWithGoogleHandler(new StubGoogleIdentityProvider(identity), store, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new ContinueWithGoogleCommand("valid-id-token", AccountRole.Professional), CancellationToken.None);

        Assert.True(result.TryGetValue(out var success));
        Assert.True(success.IsNewAccount);
        Assert.Equal("new-via-google@example.com", success.Account.Email);
        Assert.Equal(AccountRole.Professional, success.Account.Role);
        Assert.Equal("google-subject-1", success.Account.GoogleSubjectId);
        Assert.Null(success.Account.PasswordVerifier);
    }

    [Fact]
    public async Task GoogleAuthAsync_WithEmailAlreadyRegistered_UsesExistingProfessionalAccount()
    {
        var existingAccount = new Account(Guid.NewGuid(), "already-here@example.com", AccountRole.Professional, SomeVerifier, null);
        var store = new FakeAccountStore(existingAccount);
        var identity = new GoogleIdentity("already-here@example.com", "google-subject-2");
        var handler = new ContinueWithGoogleHandler(new StubGoogleIdentityProvider(identity), store, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new ContinueWithGoogleCommand("valid-id-token", AccountRole.Professional), CancellationToken.None);

        Assert.True(result.TryGetValue(out var success));
        Assert.False(success.IsNewAccount);
        Assert.Same(existingAccount, success.Account);
        Assert.Equal(AccountRole.Professional, success.Account.Role);
    }

    [Fact]
    public async Task GoogleAuthAsync_WithInvalidGoogleToken_ReturnsFailure()
    {
        var store = new FakeAccountStore();
        var handler = new ContinueWithGoogleHandler(new StubGoogleIdentityProvider(identity: null), store, new TwoFactorTicketIssuer(), new SessionTokenIssuer());

        var result = await handler.Handle(new ContinueWithGoogleCommand("bad-id-token", AccountRole.Professional), CancellationToken.None);

        var failureReason = result.Match(
            _ => throw new InvalidOperationException("expected a failure"),
            reason => reason);
        Assert.Equal(AccountGoogleAuthFailureReason.InvalidGoogleToken, failureReason);
    }

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

    private sealed class StubGoogleIdentityProvider : IGoogleIdentityProvider
    {
        private readonly GoogleIdentity? _identity;

        public StubGoogleIdentityProvider(GoogleIdentity? identity = null) => _identity = identity;

        public Task<GoogleIdentity?> VerifyIdTokenAsync(string idToken, CancellationToken cancellationToken) =>
            Task.FromResult(_identity);
    }
}
