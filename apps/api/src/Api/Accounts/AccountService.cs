namespace Api.Accounts;

/// <summary>
/// Domain logic for account registration, e-mail/verifier login, and Google sign-in.
/// Deliberately has no HTTP knowledge -- <c>Api.Endpoints.AuthEndpoints</c> is the only
/// caller in production and owns request validation/HTTP status mapping; this class
/// works entirely in already-validated domain values.
/// </summary>
public sealed class AccountService
{
    /// <summary>
    /// Expected length, in bytes, of a client-derived password verifier (ADR-S02-02).
    /// Matches this repo's existing AES-256 key length convention (see
    /// packages/crypto/src/aes-gcm.ts's AES_256_KEY_LENGTH) -- both are 32-byte outputs
    /// of a KDF. Callers (the HTTP layer) must reject any verifier of a different length
    /// as a validation error before it ever reaches <see cref="LoginAsync"/>: mixing
    /// "malformed request" and "wrong credentials" here would reintroduce a timing
    /// side-channel this class exists to close.
    /// </summary>
    public const int PasswordVerifierLength = 32;

    /// <summary>
    /// Stand-in stored verifier used by <see cref="LoginAsync"/> when no account is found,
    /// so the comparison it runs is the same shape (same length) whether the account
    /// exists or not. Its content doesn't matter -- it must simply never equal a real
    /// client-submitted verifier, which an all-zero array of the expected length already
    /// guarantees for any Argon2id output in practice.
    /// </summary>
    private static readonly byte[] DummyVerifier = new byte[PasswordVerifierLength];

    private readonly IAccountStore _store;
    private readonly IPasswordVerifierComparer _comparer;
    private readonly IGoogleIdentityProvider _googleIdentityProvider;

    public AccountService(IAccountStore store, IPasswordVerifierComparer comparer, IGoogleIdentityProvider googleIdentityProvider)
    {
        _store = store;
        _comparer = comparer;
        _googleIdentityProvider = googleIdentityProvider;
    }

    public async Task<AccountRegistrationResult> RegisterAsync(
        string email, byte[] passwordVerifier, AccountRole role, CancellationToken cancellationToken)
    {
        var normalizedEmail = NormalizeEmail(email);
        var existing = await _store.FindByEmailAsync(normalizedEmail, cancellationToken);
        if (existing is not null)
        {
            return AccountRegistrationResult.Failure(AccountRegistrationFailureReason.EmailAlreadyRegistered);
        }

        var account = new Account(Guid.NewGuid(), normalizedEmail, role, passwordVerifier, GoogleSubjectId: null);
        await _store.InsertAsync(account, cancellationToken);
        return AccountRegistrationResult.Success(account);
    }

    /// <summary>
    /// Account enumeration mitigation (S02-01 acceptance criterion): an unknown e-mail
    /// and a wrong password must be indistinguishable to a caller, in both response shape
    /// AND response time. This method never returns before calling
    /// <see cref="_comparer"/>.Matches -- it always compares <paramref name="passwordVerifier"/>
    /// against either the real stored verifier or <see cref="DummyVerifier"/> (same
    /// length as a real one), so the "account not found" case does exactly the same
    /// comparison work as the "wrong password" case. Do not add an early return for the
    /// account-not-found case above the comparison call below.
    ///
    /// A THIRD case shares the same DummyVerifier fallback: an existing account created
    /// exclusively via Google sign-in, which has no password verifier at all
    /// (<c>Account.PasswordVerifier is null</c>). The comparison still always runs (same
    /// timing property), but unlike the other two cases, success additionally requires
    /// that the account actually had a real stored verifier that matched -- otherwise
    /// submitting an all-zero verifier (DummyVerifier's own content) would authenticate
    /// as that account. See the <c>hasRealVerifier</c> guard below.
    /// </summary>
    public async Task<AccountLoginResult> LoginAsync(string email, byte[] passwordVerifier, CancellationToken cancellationToken)
    {
        var normalizedEmail = NormalizeEmail(email);
        var account = await _store.FindByEmailAsync(normalizedEmail, cancellationToken);

        // hasRealVerifier is false both when the account doesn't exist AND when it exists
        // but was created exclusively via Google sign-in (PasswordVerifier null, ADR-S02-02
        // / Account.cs) -- an all-zero DummyVerifier is fine as the comparand for the
        // *shape*-uniform comparison below, but on its own it must never be sufficient to
        // authenticate: a caller submitting 32 zero bytes would otherwise match it exactly
        // and log in to any Google-only account without ever having set a password
        // (security-review finding, S02-01). The comparer call below still always runs on
        // two equal-length buffers regardless of which case this is -- only the branch
        // after it additionally requires a real stored verifier to have matched.
        var hasRealVerifier = account?.PasswordVerifier is not null;
        var storedVerifier = account?.PasswordVerifier ?? DummyVerifier;
        var matches = _comparer.Matches(passwordVerifier, storedVerifier);

        if (account is null || !hasRealVerifier || !matches)
        {
            return AccountLoginResult.Failure(AccountLoginFailureReason.InvalidCredentials);
        }

        return AccountLoginResult.Success(account);
    }

    /// <summary>
    /// S02-01 acceptance criterion: "Google resolve o papel sozinho quando o e-mail já
    /// existe" (ADR-S02-01). <paramref name="requestedRole"/> only takes effect when this
    /// call creates a brand-new account; when an account for the verified Google identity's
    /// e-mail already exists, its stored role wins and requestedRole is ignored entirely --
    /// the caller is never asked to choose again.
    /// </summary>
    public async Task<AccountGoogleAuthResult> GoogleAuthAsync(
        string idToken, AccountRole requestedRole, CancellationToken cancellationToken)
    {
        var identity = await _googleIdentityProvider.VerifyIdTokenAsync(idToken, cancellationToken);
        if (identity is null)
        {
            return AccountGoogleAuthResult.Failure(AccountGoogleAuthFailureReason.InvalidGoogleToken);
        }

        var normalizedEmail = NormalizeEmail(identity.Email);
        var existing = await _store.FindByEmailAsync(normalizedEmail, cancellationToken);
        if (existing is not null)
        {
            return AccountGoogleAuthResult.Success(existing, isNewAccount: false);
        }

        var account = new Account(Guid.NewGuid(), normalizedEmail, requestedRole, PasswordVerifier: null, identity.SubjectId);
        await _store.InsertAsync(account, cancellationToken);
        return AccountGoogleAuthResult.Success(account, isNewAccount: true);
    }

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();
}
