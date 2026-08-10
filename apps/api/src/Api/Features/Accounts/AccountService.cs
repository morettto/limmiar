using System.Buffers.Text;
using System.Security.Cryptography;

namespace Api.Accounts;

public sealed class AccountService
{
    public const int PasswordVerifierLength = 32;

    private static readonly byte[] DummyVerifier = new byte[PasswordVerifierLength];

    public const int DocumentReviewSlaBusinessDays = 5;

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
        string? webAuthnRelyingPartyId = null,
        string? webAuthnExpectedOrigin = null,
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

    public async Task<AccountLoginResult> LoginAsync(string email, byte[] passwordVerifier, CancellationToken cancellationToken)
    {
        var normalizedEmail = NormalizeEmail(email);
        var account = await _store.FindByEmailAsync(normalizedEmail, cancellationToken);

        // Always compare against a real or dummy verifier of equal length before branching:
        // keeps unknown-email, wrong-password and Google-only (no verifier) timing identical.
        var hasRealVerifier = account?.PasswordVerifier is not null;
        var storedVerifier = account?.PasswordVerifier ?? DummyVerifier;
        var matches = _comparer.Matches(passwordVerifier, storedVerifier);

        if (account is null || !hasRealVerifier || !matches)
        {
            return AccountLoginResult.Failure(AccountLoginFailureReason.InvalidCredentials);
        }

        return AccountLoginResult.Success(account, IssueTwoFactorTicketIfRequired(account), IssueSessionIfNoTwoFactorPending(account));
    }

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

    public Task<IReadOnlyList<Account>> ListPendingProfessionalVerificationsAsync(CancellationToken cancellationToken) =>
        _store.ListPendingDocumentReviewAsync(cancellationToken);

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

        return ConfirmTotpEnrollmentResult.Success(confirmed, backupCodes, _sessionTokenIssuer.IssuePair(confirmed.Id));
    }

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

            // Single-use: drop the matched hash so this backup code can never be consumed again.
            IReadOnlyList<string> remainingHashes = hashes.Where((_, index) => index != matchIndex).ToList();
            var updated = account with { TotpBackupCodeHashes = remainingHashes };
            await _store.UpdateAsync(updated, cancellationToken);
            return VerifyTotpChallengeResult.Success(updated, _sessionTokenIssuer.IssuePair(updated.Id));
        }

        return VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.InvalidCode);
    }

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

    private static AccountVerificationStatus InitialVerificationStatus(AccountRole role) =>
        role == AccountRole.Professional ? AccountVerificationStatus.Pending : AccountVerificationStatus.Active;

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    private string? IssueTwoFactorTicketIfRequired(Account account) =>
        TwoFactorPolicy.Determine(account) == TwoFactorRequirement.NotApplicable
            ? null
            : _twoFactorTicketIssuer.Issue(account.Id);

    private SessionTokenPair? IssueSessionIfNoTwoFactorPending(Account account) =>
        TwoFactorPolicy.Determine(account) == TwoFactorRequirement.NotApplicable
            ? _sessionTokenIssuer.IssuePair(account.Id)
            : null;

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

    public Task<RefreshSessionResult> RefreshSessionAsync(string refreshToken, CancellationToken cancellationToken) =>
        Task.FromResult(_sessionTokenIssuer.Refresh(refreshToken));
}
