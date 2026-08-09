using System.Buffers.Text;
using System.Security.Cryptography;

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

    /// <summary>
    /// Declared SLA for the document review path (ADR-S02-05: "SLA declarado" -- the Spec
    /// requires one to exist and be surfaced, not a specific number). Business days, not
    /// calendar days. Implementation decision, not a Spec value -- flagged in this
    /// ticket's Handoff for the human to adjust if a different number is wanted.
    /// </summary>
    public const int DocumentReviewSlaBusinessDays = 5;

    /// <summary>
    /// Issuer name embedded in every TOTP provisioning URI (Spec S02, ADR-S02-03) -- what
    /// an authenticator app displays as the account label's grouping/source.
    /// </summary>
    private const string TotpIssuer = "Limmiar";

    private readonly IAccountStore _store;
    private readonly IPasswordVerifierComparer _comparer;
    private readonly IGoogleIdentityProvider _googleIdentityProvider;
    private readonly ICouncilRegistryVerifier _councilRegistryVerifier;
    private readonly ITotpProvider _totpProvider;
    private readonly ITwoFactorTicketIssuer _twoFactorTicketIssuer;
    private readonly ISessionTokenIssuer _sessionTokenIssuer;
    private readonly IWebAuthnCeremonyVerifier _webAuthnCeremonyVerifier;
    private readonly IMagicLinkIssuer _magicLinkIssuer;
    private readonly IMagicLinkEmailSender _magicLinkEmailSender;
    private readonly INewDeviceAlertSender _newDeviceAlertSender;
    private readonly string _webAuthnRelyingPartyId;
    private readonly string _webAuthnExpectedOrigin;

    public AccountService(
        IAccountStore store,
        IPasswordVerifierComparer comparer,
        IGoogleIdentityProvider googleIdentityProvider,
        ICouncilRegistryVerifier? councilRegistryVerifier = null,
        ITotpProvider? totpProvider = null,
        ITwoFactorTicketIssuer? twoFactorTicketIssuer = null,
        ISessionTokenIssuer? sessionTokenIssuer = null,
        IWebAuthnCeremonyVerifier? webAuthnCeremonyVerifier = null,
        IMagicLinkIssuer? magicLinkIssuer = null,
        IMagicLinkEmailSender? magicLinkEmailSender = null,
        // Defaults exist only so every pre-S02-05 test/call site that constructs this class
        // without knowing about WebAuthn keeps compiling -- production ALWAYS passes real,
        // fail-fast-validated values from Program.Composition.cs's WebAuthn:RelyingPartyId/
        // WebAuthn:ExpectedOrigin config reads (see AddSingleton<AccountService> there). A
        // test that actually exercises RequestMagicLinkAsync/VerifyMagicLinkAsync/
        // CompleteMagicLinkWebAuthnAsync must pass values matching whatever it signs its
        // fake WebAuthn responses with, same as WebAuthnCeremonyVerifierTests does for the
        // ceremony verifier directly.
        string? webAuthnRelyingPartyId = null,
        string? webAuthnExpectedOrigin = null,
        // Same "defaults exist only so every pre-S02-07 test/call site keeps compiling"
        // reasoning as webAuthnRelyingPartyId/webAuthnExpectedOrigin above -- production
        // ALWAYS resolves a real INewDeviceAlertSender from the container (see
        // Program.Composition.cs's AddSingleton<AccountService> factory).
        INewDeviceAlertSender? newDeviceAlertSender = null)
    {
        _store = store;
        _comparer = comparer;
        _googleIdentityProvider = googleIdentityProvider;
        _councilRegistryVerifier = councilRegistryVerifier ?? new CouncilRegistryVerifier();
        _totpProvider = totpProvider ?? new TotpProvider();
        _twoFactorTicketIssuer = twoFactorTicketIssuer ?? new TwoFactorTicketIssuer();
        _sessionTokenIssuer = sessionTokenIssuer ?? new SessionTokenIssuer();
        _webAuthnCeremonyVerifier = webAuthnCeremonyVerifier ?? new WebAuthnCeremonyVerifier();
        _magicLinkIssuer = magicLinkIssuer ?? new MagicLinkIssuer();
        _magicLinkEmailSender = magicLinkEmailSender ?? new MagicLinkEmailSender();
        _newDeviceAlertSender = newDeviceAlertSender ?? new NewDeviceAlertSender();
        _webAuthnRelyingPartyId = webAuthnRelyingPartyId ?? "localhost";
        _webAuthnExpectedOrigin = webAuthnExpectedOrigin ?? "http://localhost";
    }

    /// <summary>The relying party id this instance verifies WebAuthn ceremonies against -- surfaced so <c>Api.Endpoints.AuthEndpoints</c> can echo it in <c>VerifyMagicLinkResponse</c> without duplicating the configured value.</summary>
    public string WebAuthnRelyingPartyId => _webAuthnRelyingPartyId;

    public async Task<AccountRegistrationResult> RegisterAsync(
        string email, byte[] passwordVerifier, AccountRole role, CancellationToken cancellationToken)
    {
        var normalizedEmail = NormalizeEmail(email);
        var existing = await _store.FindByEmailAsync(normalizedEmail, cancellationToken);
        if (existing is not null)
        {
            return AccountRegistrationResult.Failure(AccountRegistrationFailureReason.EmailAlreadyRegistered);
        }

        var account = new Account(
            Guid.NewGuid(), normalizedEmail, role, passwordVerifier, GoogleSubjectId: null, VerificationStatus: InitialVerificationStatus(role));
        await _store.InsertAsync(account, cancellationToken);
        return AccountRegistrationResult.Success(account, IssueTwoFactorTicketIfRequired(account), IssueSessionIfNoTwoFactorPending(account));
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

        return AccountLoginResult.Success(account, IssueTwoFactorTicketIfRequired(account), IssueSessionIfNoTwoFactorPending(account));
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
            return AccountGoogleAuthResult.Success(
                existing, isNewAccount: false, IssueTwoFactorTicketIfRequired(existing), IssueSessionIfNoTwoFactorPending(existing));
        }

        var account = new Account(
            Guid.NewGuid(), normalizedEmail, requestedRole, PasswordVerifier: null, identity.SubjectId,
            VerificationStatus: InitialVerificationStatus(requestedRole));
        await _store.InsertAsync(account, cancellationToken);
        return AccountGoogleAuthResult.Success(
            account, isNewAccount: true, IssueTwoFactorTicketIfRequired(account), IssueSessionIfNoTwoFactorPending(account));
    }

    /// <summary>
    /// Submits a professional credential (S02-02). CRP/CRM are checked synchronously
    /// against <see cref="ICouncilRegistryVerifier"/> and resolve immediately to
    /// <see cref="AccountVerificationStatus.Active"/> or <see cref="AccountVerificationStatus.Rejected"/>;
    /// a document goes straight to <see cref="AccountVerificationStatus.InReview"/> without
    /// ever calling the verifier (only a human decides that path, via
    /// <see cref="DecideProfessionalVerificationAsync"/>). Only callable from
    /// <see cref="AccountVerificationStatus.Pending"/> or <see cref="AccountVerificationStatus.Rejected"/>
    /// -- the latter is the "caminho de correção" acceptance criterion (a rejected account
    /// can resubmit).
    /// </summary>
    public async Task<SubmitProfessionalCredentialResult> SubmitProfessionalCredentialAsync(
        Guid accountId,
        ProfessionalCredentialType type,
        string? registryNumber,
        string? registryUf,
        string? documentReference,
        CancellationToken cancellationToken)
    {
        var account = await _store.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return SubmitProfessionalCredentialResult.Failure(SubmitProfessionalCredentialFailureReason.AccountNotFound);
        }

        if (account.Role != AccountRole.Professional)
        {
            return SubmitProfessionalCredentialResult.Failure(SubmitProfessionalCredentialFailureReason.NotAProfessionalAccount);
        }

        if (account.VerificationStatus is not (AccountVerificationStatus.Pending or AccountVerificationStatus.Rejected))
        {
            return SubmitProfessionalCredentialResult.Failure(SubmitProfessionalCredentialFailureReason.InvalidStateForSubmission);
        }

        if (type == ProfessionalCredentialType.Document)
        {
            var inReview = account with
            {
                VerificationStatus = AccountVerificationStatus.InReview,
                RejectionReason = null,
                VerificationSubmittedAt = DateTimeOffset.UtcNow,
            };
            await _store.UpdateAsync(inReview, cancellationToken);
            return SubmitProfessionalCredentialResult.Success(inReview, DocumentReviewSlaBusinessDays);
        }

        var verification = await _councilRegistryVerifier.VerifyAsync(type, registryNumber!, registryUf!, cancellationToken);
        var decided = account with
        {
            VerificationStatus = verification.Verified ? AccountVerificationStatus.Active : AccountVerificationStatus.Rejected,
            RejectionReason = verification.FailureReason,
            VerificationSubmittedAt = DateTimeOffset.UtcNow,
        };
        await _store.UpdateAsync(decided, cancellationToken);
        return SubmitProfessionalCredentialResult.Success(decided);
    }

    /// <summary>
    /// The human reviewer's decision on a queued document submission (S02-02). Only
    /// callable while the account is <see cref="AccountVerificationStatus.InReview"/>.
    /// </summary>
    public async Task<ProfessionalVerificationDecisionResult> DecideProfessionalVerificationAsync(
        Guid accountId, bool approved, string? rejectionReason, CancellationToken cancellationToken)
    {
        var account = await _store.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return ProfessionalVerificationDecisionResult.Failure(ProfessionalVerificationDecisionFailureReason.AccountNotFound);
        }

        if (account.VerificationStatus != AccountVerificationStatus.InReview)
        {
            return ProfessionalVerificationDecisionResult.Failure(ProfessionalVerificationDecisionFailureReason.NotInReview);
        }

        var decided = account with
        {
            VerificationStatus = approved ? AccountVerificationStatus.Active : AccountVerificationStatus.Rejected,
            RejectionReason = approved ? null : rejectionReason,
        };
        await _store.UpdateAsync(decided, cancellationToken);
        return ProfessionalVerificationDecisionResult.Success(decided);
    }

    /// <summary>The human review queue (S02-02) -- delegates straight to the store, no extra domain logic.</summary>
    public Task<IReadOnlyList<Account>> ListPendingProfessionalVerificationsAsync(CancellationToken cancellationToken) =>
        _store.ListPendingDocumentReviewAsync(cancellationToken);

    /// <summary>
    /// Starts (or restarts) a mandatory TOTP enrollment for a <see cref="AccountRole.Professional"/>
    /// account (Spec S02, ADR-S02-03) -- 2FA can never be skipped for this role and there is
    /// no opt-out. Calling this again before <see cref="ConfirmTotpEnrollmentAsync"/> simply
    /// overwrites the pending secret with a freshly generated one; there is no separate
    /// failure case for "already has a pending secret".
    /// </summary>
    public async Task<BeginTotpEnrollmentResult> BeginTotpEnrollmentAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var account = await _store.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return BeginTotpEnrollmentResult.Failure(BeginTotpEnrollmentFailureReason.AccountNotFound);
        }

        if (account.Role != AccountRole.Professional)
        {
            return BeginTotpEnrollmentResult.Failure(BeginTotpEnrollmentFailureReason.NotAProfessionalAccount);
        }

        if (account.TotpEnabledAt is not null)
        {
            return BeginTotpEnrollmentResult.Failure(BeginTotpEnrollmentFailureReason.AlreadyEnabled);
        }

        var secret = _totpProvider.GenerateSecret();
        var pending = account with { TotpSecret = secret };
        await _store.UpdateAsync(pending, cancellationToken);

        var provisioningUri = _totpProvider.BuildProvisioningUri(secret, account.Email, TotpIssuer);
        return BeginTotpEnrollmentResult.Success(secret, provisioningUri);
    }

    /// <summary>
    /// Confirms a pending TOTP enrollment (started by <see cref="BeginTotpEnrollmentAsync"/>)
    /// with a code from the authenticator app, and issues 10 single-use backup codes --
    /// the only call in this class that ever returns them in clear text. They are the sole
    /// account-recovery path (ADR-S02-04: there is deliberately no support-side 2FA
    /// reset/disable).
    /// </summary>
    public async Task<ConfirmTotpEnrollmentResult> ConfirmTotpEnrollmentAsync(
        Guid accountId, string code, CancellationToken cancellationToken)
    {
        var account = await _store.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return ConfirmTotpEnrollmentResult.Failure(ConfirmTotpEnrollmentFailureReason.AccountNotFound);
        }

        if (account.TotpSecret is null || account.TotpEnabledAt is not null)
        {
            return ConfirmTotpEnrollmentResult.Failure(ConfirmTotpEnrollmentFailureReason.NotPending);
        }

        if (!_totpProvider.ValidateCode(account.TotpSecret, code, DateTimeOffset.UtcNow))
        {
            return ConfirmTotpEnrollmentResult.Failure(ConfirmTotpEnrollmentFailureReason.InvalidCode);
        }

        var backupCodes = BackupCodeGenerator.GenerateCodes();
        IReadOnlyList<string> backupCodeHashes = backupCodes.Select(BackupCodeGenerator.Hash).ToList();
        var confirmed = account with { TotpEnabledAt = DateTimeOffset.UtcNow, TotpBackupCodeHashes = backupCodeHashes };
        await _store.UpdateAsync(confirmed, cancellationToken);

        // First-time enrollment confirmation completes the login (ADR-S02-03: no separate
        // challenge required this once) -- see ConfirmTotpEnrollmentResult.Session.
        return ConfirmTotpEnrollmentResult.Success(confirmed, backupCodes, _sessionTokenIssuer.IssuePair(confirmed.Id));
    }

    /// <summary>
    /// Verifies the mandatory TOTP challenge (Spec S02, ADR-S02-03) required on every login
    /// for a <see cref="AccountRole.Professional"/> account that has already confirmed its
    /// enrollment. Accepts either a live authenticator <paramref name="code"/> or a
    /// single-use <paramref name="backupCode"/> (ADR-S02-04) -- a consumed backup code is
    /// removed from <see cref="Account.TotpBackupCodeHashes"/> so it can never be reused.
    /// </summary>
    public async Task<VerifyTotpChallengeResult> VerifyTotpChallengeAsync(
        Guid accountId, string? code, string? backupCode, CancellationToken cancellationToken)
    {
        var account = await _store.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.AccountNotFound);
        }

        if (account.TotpEnabledAt is null)
        {
            return VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.NotEnabled);
        }

        if (!string.IsNullOrEmpty(code))
        {
            return _totpProvider.ValidateCode(account.TotpSecret!, code, DateTimeOffset.UtcNow)
                ? VerifyTotpChallengeResult.Success(account, _sessionTokenIssuer.IssuePair(account.Id))
                : VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.InvalidCode);
        }

        if (!string.IsNullOrEmpty(backupCode))
        {
            var hash = BackupCodeGenerator.Hash(backupCode);
            var hashes = account.TotpBackupCodeHashes ?? [];
            var matchIndex = hashes.ToList().FindIndex(stored => stored == hash);
            if (matchIndex < 0)
            {
                return VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.InvalidCode);
            }

            // Single-use: the matched hash is dropped from the list so this exact backup
            // code can never be consumed a second time (ADR-S02-04).
            IReadOnlyList<string> remainingHashes = hashes.Where((_, index) => index != matchIndex).ToList();
            var updated = account with { TotpBackupCodeHashes = remainingHashes };
            await _store.UpdateAsync(updated, cancellationToken);
            return VerifyTotpChallengeResult.Success(updated, _sessionTokenIssuer.IssuePair(updated.Id));
        }

        // Neither a code nor a backup code was submitted -- the HTTP layer should already
        // reject this shape as a 400 before calling in, but this service does not trust
        // that blindly.
        return VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.InvalidCode);
    }

    /// <summary>
    /// Starts a magic-link sign-in for a patient (Spec S02, ticket S02-05). Always "succeeds"
    /// outwardly -- same account-enumeration mitigation discipline as <see cref="LoginAsync"/>'s
    /// doc comment: a caller must not be able to tell an unknown e-mail, an existing Patient
    /// e-mail, and an existing Professional e-mail apart from this call's result alone.
    ///
    /// Judgment call (S02-05): an existing <see cref="AccountRole.Professional"/> account does
    /// NOT get a token issued or an e-mail sent. Professionals already have a mandatory
    /// password + TOTP flow (ADR-S02-02/S02-03); silently letting a magic link log one of them
    /// in passwordless would bypass that second factor entirely. This gate is invisible from
    /// the outside -- <see cref="RequestMagicLinkResult"/> carries no data for either branch to
    /// differ on, and both branches run the same shape of work (normalize, look up, decide),
    /// so there is no response-shape or branch-count tell. It is NOT full timing parity with
    /// the Professional-gated branch (that branch skips token generation and the -- always
    /// throwing today -- e-mail send), which is an accepted, flagged trade-off: see this
    /// ticket's Handoff.
    /// </summary>
    public async Task<RequestMagicLinkResult> RequestMagicLinkAsync(string email, CancellationToken cancellationToken)
    {
        var normalizedEmail = NormalizeEmail(email);
        var account = await _store.FindByEmailAsync(normalizedEmail, cancellationToken);

        if (account is null || account.Role != AccountRole.Professional)
        {
            var token = _magicLinkIssuer.IssueToken(normalizedEmail);
            try
            {
                await _magicLinkEmailSender.SendAsync(normalizedEmail, token, cancellationToken);
            }
            catch (Exception)
            {
            }
        }

        return RequestMagicLinkResult.Instance;
    }

    /// <summary>
    /// Alerts the account holder that a device-pairing handshake just finished (Spec S02,
    /// ticket S02-07) -- called right after <see cref="IDevicePairingIssuer.SubmitPayload"/>
    /// succeeds (see <c>Api.Endpoints.DevicePairingEndpoints.HandleSubmitPayload</c>). Same
    /// swallow-on-failure discipline as <see cref="RequestMagicLinkAsync"/>'s call to
    /// <see cref="_magicLinkEmailSender"/>.SendAsync: a failure to deliver this alert must
    /// never surface as an exception out of the handshake it is called from, or a device that
    /// finished pairing successfully would see it reported as failed. An unknown
    /// <paramref name="accountId"/> is a silent no-op -- this method has no result to report
    /// failure through, and the caller only ever passes an accountId it already authenticated
    /// the request against.
    /// </summary>
    public async Task NotifyNewDeviceLinkedAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var account = await _store.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return;
        }

        try
        {
            await _newDeviceAlertSender.SendAsync(account.Email, cancellationToken);
        }
        catch (Exception)
        {
        }
    }

    /// <summary>
    /// Burns a magic-link token (Spec S02, ticket S02-05) and starts the WebAuthn half of the
    /// flow: an e-mail with no registered credential yet (no account, or -- defensively,
    /// though not reachable today since a credential is always created together with its
    /// account -- an account whose <see cref="Account.WebAuthnCredentialId"/> is still null)
    /// gets a <see cref="MagicLinkCeremonyType.Register"/> ticket; an e-mail with one already
    /// gets a <see cref="MagicLinkCeremonyType.Assert"/> ticket carrying the stored credential
    /// material <see cref="CompleteMagicLinkWebAuthnAsync"/> will need. The fresh challenge
    /// this mints is stored alongside the ticket (<see cref="IMagicLinkIssuer.IssueTicket"/>)
    /// rather than trusted back from the caller, so a tampered/replayed challenge can never
    /// reach the ceremony verifier. One failure reason only (token unknown/expired/already
    /// used) -- see <see cref="MagicLinkIssuer.ConsumeToken"/>.
    /// </summary>
    public async Task<VerifyMagicLinkResult> VerifyMagicLinkAsync(string token, CancellationToken cancellationToken)
    {
        var email = _magicLinkIssuer.ConsumeToken(token);
        if (email is null)
        {
            return VerifyMagicLinkResult.Failure();
        }

        var account = await _store.FindByEmailAsync(email, cancellationToken);
        var challenge = RandomNumberGenerator.GetBytes(32);

        if (account is not null && account.WebAuthnCredentialId is not null)
        {
            var ticketData = new MagicLinkTicketData(
                email,
                MagicLinkCeremonyType.Assert,
                challenge,
                account.Id,
                account.WebAuthnCredentialId,
                account.WebAuthnCosePublicKey,
                account.WebAuthnSignCount);
            var ticket = _magicLinkIssuer.IssueTicket(ticketData);
            return VerifyMagicLinkResult.Success(ticket, MagicLinkCeremonyType.Assert, challenge, account.WebAuthnCredentialId);
        }

        var registrationTicketData = new MagicLinkTicketData(email, MagicLinkCeremonyType.Register, challenge);
        var registrationTicket = _magicLinkIssuer.IssueTicket(registrationTicketData);
        return VerifyMagicLinkResult.Success(registrationTicket, MagicLinkCeremonyType.Register, challenge, credentialId: null);
    }

    /// <summary>
    /// Completes the WebAuthn half of a magic-link sign-in (Spec S02, ticket S02-05). A single
    /// entry point rather than two separate Complete-Registration/Complete-Assertion methods:
    /// the ticket minted by <see cref="VerifyMagicLinkAsync"/> already knows which ceremony
    /// applies, so making the caller (<c>Api.Endpoints.AuthEndpoints</c>) pick the right method
    /// ahead of time would only duplicate that decision. Callers pass whichever raw response
    /// fields the browser produced (an attestation-shaped response for a registration, an
    /// assertion-shaped one otherwise); this method uses the ticket to decide which fields it
    /// needs and ignores the others, the same way <see cref="VerifyTotpChallengeAsync"/> picks
    /// between <c>code</c> and <c>backupCode</c>.
    ///
    /// Registration path: verifies via <see cref="IWebAuthnCeremonyVerifier.VerifyRegistrationAsync"/>,
    /// then creates the account (<see cref="AccountRole.Patient"/>, immediately
    /// <see cref="AccountVerificationStatus.Active"/>, no password, no Google id) and issues a
    /// session. Assertion path: verifies via <see cref="IWebAuthnCeremonyVerifier.VerifyAssertionAsync"/>
    /// against the ticket's stored credential material, persists the authenticator's advanced
    /// sign count (clone-detection baseline for the NEXT assertion -- see
    /// <see cref="WebAuthnAssertionResult.NewSignCount"/>'s own doc comment for why forgetting
    /// this would defeat clone detection entirely), and issues a session.
    ///
    /// One failure reason only -- collapses an invalid/expired/already-used ticket together
    /// with every possible <see cref="WebAuthnCeremonyFailureReason"/> the verifier can
    /// produce, on purpose: see <c>Api.Problems.ProblemCodes.AuthWebAuthnCeremonyFailed</c>.
    /// </summary>
    public async Task<CompleteMagicLinkResult> CompleteMagicLinkWebAuthnAsync(
        string magicLinkTicket,
        byte[] credentialId,
        byte[] clientDataJson,
        byte[]? attestationObject,
        byte[]? authenticatorData,
        byte[]? signature,
        CancellationToken cancellationToken)
    {
        var ticketData = _magicLinkIssuer.ConsumeTicket(magicLinkTicket);
        if (ticketData is null)
        {
            return CompleteMagicLinkResult.Failure();
        }

        var expectedChallenge = Base64Url.EncodeToString(ticketData.Challenge);

        if (ticketData.CeremonyType == MagicLinkCeremonyType.Register)
        {
            if (attestationObject is null)
            {
                return CompleteMagicLinkResult.Failure();
            }

            var registrationCeremony = new WebAuthnRegistrationCeremony
            {
                ExpectedChallenge = expectedChallenge,
                ExpectedRelyingPartyId = _webAuthnRelyingPartyId,
                ExpectedOrigin = _webAuthnExpectedOrigin,
                CredentialId = credentialId,
                ClientDataJson = clientDataJson,
                AttestationObject = attestationObject,
            };

            var registrationResult = await _webAuthnCeremonyVerifier.VerifyRegistrationAsync(registrationCeremony, cancellationToken);
            if (!registrationResult.Succeeded)
            {
                return CompleteMagicLinkResult.Failure();
            }

            var credential = registrationResult.Credential!;
            var newAccount = new Account(
                Guid.NewGuid(),
                ticketData.Email,
                AccountRole.Patient,
                PasswordVerifier: null,
                GoogleSubjectId: null,
                VerificationStatus: AccountVerificationStatus.Active,
                WebAuthnCredentialId: credential.CredentialId,
                WebAuthnCosePublicKey: credential.CosePublicKey,
                WebAuthnSignCount: credential.SignCount,
                WebAuthnAaGuid: credential.AaGuid);
            await _store.InsertAsync(newAccount, cancellationToken);
            return CompleteMagicLinkResult.Success(newAccount, _sessionTokenIssuer.IssuePair(newAccount.Id));
        }

        if (authenticatorData is null || signature is null || ticketData.AccountId is null
            || ticketData.CredentialId is null || ticketData.StoredCosePublicKey is null || ticketData.StoredSignCount is null)
        {
            return CompleteMagicLinkResult.Failure();
        }

        var account = await _store.FindByIdAsync(ticketData.AccountId.Value, cancellationToken);
        if (account is null)
        {
            return CompleteMagicLinkResult.Failure();
        }

        var assertionCeremony = new WebAuthnAssertionCeremony
        {
            ExpectedChallenge = expectedChallenge,
            ExpectedRelyingPartyId = _webAuthnRelyingPartyId,
            ExpectedOrigin = _webAuthnExpectedOrigin,
            CredentialId = ticketData.CredentialId,
            StoredCosePublicKey = ticketData.StoredCosePublicKey,
            StoredSignCount = ticketData.StoredSignCount.Value,
            ClientDataJson = clientDataJson,
            AuthenticatorData = authenticatorData,
            Signature = signature,
        };

        var assertionResult = await _webAuthnCeremonyVerifier.VerifyAssertionAsync(assertionCeremony, cancellationToken);
        if (!assertionResult.Succeeded)
        {
            return CompleteMagicLinkResult.Failure();
        }

        var updatedAccount = account with { WebAuthnSignCount = assertionResult.NewSignCount };
        await _store.UpdateAsync(updatedAccount, cancellationToken);
        return CompleteMagicLinkResult.Success(updatedAccount, _sessionTokenIssuer.IssuePair(updatedAccount.Id));
    }

    /// <summary>
    /// A brand-new <see cref="AccountRole.Patient"/> account has no credential to verify,
    /// so it starts (and stays) <see cref="AccountVerificationStatus.Active"/>. A new
    /// <see cref="AccountRole.Professional"/> account starts
    /// <see cref="AccountVerificationStatus.Pending"/> until it submits a credential.
    /// </summary>
    private static AccountVerificationStatus InitialVerificationStatus(AccountRole role) =>
        role == AccountRole.Professional ? AccountVerificationStatus.Pending : AccountVerificationStatus.Active;

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    /// <summary>
    /// Security-review fix: every successful <see cref="RegisterAsync"/>/<see cref="LoginAsync"/>/
    /// <see cref="GoogleAuthAsync"/> call that leaves an account with a real 2FA requirement
    /// (<see cref="TwoFactorRequirement"/> other than <see cref="TwoFactorRequirement.NotApplicable"/>)
    /// must mint a ticket proving THIS call verified THIS account's identity -- otherwise the
    /// TOTP begin/confirm/challenge endpoints would have no way to tell a caller who just
    /// authenticated apart from one who only guessed/discovered the accountId.
    /// </summary>
    private string? IssueTwoFactorTicketIfRequired(Account account) =>
        TwoFactorPolicy.Determine(account) == TwoFactorRequirement.NotApplicable
            ? null
            : _twoFactorTicketIssuer.Issue(account.Id);

    /// <summary>
    /// Spec S02, ticket S02-08: register/login/Google only actually complete a login (and
    /// so only actually earn a session) when there is no mandatory 2FA still owed --
    /// mirrors <see cref="IssueTwoFactorTicketIfRequired"/>'s condition exactly, just
    /// inverted (this call site wants a session precisely when that one does NOT want a
    /// ticket). A professional account with 2FA pending gets its session later, from
    /// <see cref="ConfirmTotpEnrollmentAsync"/> or <see cref="VerifyTotpChallengeAsync"/>
    /// instead.
    /// </summary>
    private SessionTokenPair? IssueSessionIfNoTwoFactorPending(Account account) =>
        TwoFactorPolicy.Determine(account) == TwoFactorRequirement.NotApplicable
            ? _sessionTokenIssuer.IssuePair(account.Id)
            : null;

    /// <summary>
    /// Registers (or rotates) the verifier for a professional's BIP39 recovery phrase
    /// (Spec S02, ticket S02-06) -- the account-recovery counterpart of
    /// <see cref="RegisterAsync"/>'s password verifier. Always overwrites any previously
    /// stored <see cref="Account.RecoveryVerifier"/>; rotation happens simply by calling
    /// this again with a freshly derived verifier, same discipline as
    /// <see cref="BeginTotpEnrollmentAsync"/>'s secret overwrite -- there is no separate
    /// "already registered" failure case.
    /// </summary>
    public async Task<RegisterRecoveryVerifierResult> RegisterRecoveryVerifierAsync(
        Guid accountId, byte[] recoveryVerifier, CancellationToken cancellationToken)
    {
        var account = await _store.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return RegisterRecoveryVerifierResult.Failure(RegisterRecoveryVerifierFailureReason.AccountNotFound);
        }

        if (account.Role != AccountRole.Professional)
        {
            return RegisterRecoveryVerifierResult.Failure(RegisterRecoveryVerifierFailureReason.NotAProfessionalAccount);
        }

        var updated = account with { RecoveryVerifier = recoveryVerifier };
        await _store.UpdateAsync(updated, cancellationToken);
        return RegisterRecoveryVerifierResult.Success(updated);
    }

    /// <summary>
    /// Account enumeration mitigation (Spec S02, ticket S02-06), same discipline as
    /// <see cref="LoginAsync"/>'s own doc comment: an unknown e-mail, an existing account
    /// that never registered a recovery phrase, and a wrong recovery verifier must all be
    /// indistinguishable to a caller, in both response shape AND response time. This method
    /// never returns before calling <see cref="_comparer"/>.Matches -- it always compares
    /// <paramref name="recoveryVerifier"/> against either the real stored
    /// <see cref="Account.RecoveryVerifier"/> or <see cref="DummyVerifier"/> (same length),
    /// so none of the three failure cases skips the comparison. See
    /// <c>hasRealVerifier</c> below for why "account exists but never registered one" must
    /// also fall back to <see cref="DummyVerifier"/> rather than short-circuiting.
    /// </summary>
    public async Task<AccountRecoveryResult> RecoverAccessAsync(string email, byte[] recoveryVerifier, CancellationToken cancellationToken)
    {
        var normalizedEmail = NormalizeEmail(email);
        var account = await _store.FindByEmailAsync(normalizedEmail, cancellationToken);

        var hasRealVerifier = account?.RecoveryVerifier is not null;
        var storedVerifier = account?.RecoveryVerifier ?? DummyVerifier;
        var matches = _comparer.Matches(recoveryVerifier, storedVerifier);

        if (account is null || !hasRealVerifier || !matches)
        {
            return AccountRecoveryResult.Failure(AccountRecoveryFailureReason.InvalidRecoveryPhrase);
        }

        return AccountRecoveryResult.Success(account, IssueTwoFactorTicketIfRequired(account), IssueSessionIfNoTwoFactorPending(account));
    }

    /// <summary>
    /// Rotates a refresh token (Spec S02, ticket S02-08). Pure delegation to
    /// <see cref="ISessionTokenIssuer.Refresh"/> -- no account lookup here, deliberately:
    /// the refresh token itself is already proof of identity, and looking the account up
    /// again would only be able to fail in ways the issuer's own token validation already
    /// covers (a token for a deleted/nonexistent account isn't a real scenario this store
    /// can produce yet).
    /// </summary>
    public Task<RefreshSessionResult> RefreshSessionAsync(string refreshToken, CancellationToken cancellationToken) =>
        Task.FromResult(_sessionTokenIssuer.Refresh(refreshToken));
}
