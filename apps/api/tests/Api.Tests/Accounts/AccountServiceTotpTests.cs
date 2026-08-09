using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// S02-03/S02-04: mandatory TOTP 2FA enrollment (begin/confirm) and login challenge
/// (code or single-use backup code) for <see cref="AccountRole.Professional"/> accounts,
/// plus the <see cref="TwoFactorRequirement"/> now carried by <see cref="AccountService.RegisterAsync"/>,
/// <see cref="AccountService.LoginAsync"/>, and <see cref="AccountService.GoogleAuthAsync"/>.
/// </summary>
public sealed class AccountServiceTotpTests
{
    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    [Fact]
    public async Task BeginTotpEnrollmentAsync_WithProfessionalAccount_GeneratesSecretAndProvisioningUri()
    {
        var account = ProfessionalAccount("pro@example.com");
        var store = new FakeAccountStore(account);
        var service = CreateService(store, totpProvider: new StubTotpProvider(validCode: true));

        var result = await service.BeginTotpEnrollmentAsync(account.Id, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal("GENERATEDSECRETXYZ", result.Secret);
        Assert.Contains("GENERATEDSECRETXYZ", result.ProvisioningUri);

        var stored = await store.FindByIdAsync(account.Id, CancellationToken.None);
        Assert.Equal("GENERATEDSECRETXYZ", stored!.TotpSecret);
        Assert.Null(stored.TotpEnabledAt);
    }

    [Fact]
    public async Task BeginTotpEnrollmentAsync_WithUnknownAccountId_ReturnsAccountNotFound()
    {
        var store = new FakeAccountStore();
        var service = CreateService(store);

        var result = await service.BeginTotpEnrollmentAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(BeginTotpEnrollmentFailureReason.AccountNotFound, result.FailureReason);
    }

    [Fact]
    public async Task BeginTotpEnrollmentAsync_WithPatientAccount_ReturnsNotAProfessionalAccount()
    {
        var account = new Account(Guid.NewGuid(), "patient@example.com", AccountRole.Patient, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var service = CreateService(store);

        var result = await service.BeginTotpEnrollmentAsync(account.Id, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(BeginTotpEnrollmentFailureReason.NotAProfessionalAccount, result.FailureReason);
    }

    [Fact]
    public async Task BeginTotpEnrollmentAsync_WithAlreadyEnabledAccount_ReturnsAlreadyEnabled()
    {
        var account = ProfessionalAccount("already-enabled@example.com") with
        {
            TotpSecret = "OLDSECRET",
            TotpEnabledAt = DateTimeOffset.UtcNow,
        };
        var store = new FakeAccountStore(account);
        var service = CreateService(store);

        var result = await service.BeginTotpEnrollmentAsync(account.Id, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(BeginTotpEnrollmentFailureReason.AlreadyEnabled, result.FailureReason);
    }

    [Fact]
    public async Task ConfirmTotpEnrollmentAsync_WithValidCode_EnablesAccount_AndReturnsBackupCodesInClear()
    {
        var account = ProfessionalAccount("confirm-ok@example.com") with { TotpSecret = "PENDINGSECRET" };
        var store = new FakeAccountStore(account);
        var service = CreateService(store, totpProvider: new StubTotpProvider(validCode: true));

        var result = await service.ConfirmTotpEnrollmentAsync(account.Id, "123456", CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.NotNull(result.BackupCodes);
        Assert.Equal(10, result.BackupCodes!.Count);
        Assert.NotNull(result.Account!.TotpEnabledAt);
        Assert.Equal(10, result.Account.TotpBackupCodeHashes!.Count);

        // The stored hashes must be the SHA-256 hashes of the returned clear-text codes,
        // not the codes themselves -- never persist a backup code in a recoverable form.
        var expectedHashes = result.BackupCodes.Select(BackupCodeGenerator.Hash).ToHashSet();
        Assert.Equal(expectedHashes, result.Account.TotpBackupCodeHashes.ToHashSet());
        Assert.All(result.Account.TotpBackupCodeHashes, hash => Assert.DoesNotContain(hash, result.BackupCodes));
    }

    [Fact]
    public async Task ConfirmTotpEnrollmentAsync_WithInvalidCode_ReturnsInvalidCode_AndDoesNotEnable()
    {
        var account = ProfessionalAccount("confirm-bad@example.com") with { TotpSecret = "PENDINGSECRET" };
        var store = new FakeAccountStore(account);
        var service = CreateService(store, totpProvider: new StubTotpProvider(validCode: false));

        var result = await service.ConfirmTotpEnrollmentAsync(account.Id, "000000", CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(ConfirmTotpEnrollmentFailureReason.InvalidCode, result.FailureReason);

        var stored = await store.FindByIdAsync(account.Id, CancellationToken.None);
        Assert.Null(stored!.TotpEnabledAt);
    }

    [Fact]
    public async Task ConfirmTotpEnrollmentAsync_WithNoPendingEnrollment_ReturnsNotPending()
    {
        var account = ProfessionalAccount("never-started@example.com");
        var store = new FakeAccountStore(account);
        var service = CreateService(store, totpProvider: new StubTotpProvider(validCode: true));

        var result = await service.ConfirmTotpEnrollmentAsync(account.Id, "123456", CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(ConfirmTotpEnrollmentFailureReason.NotPending, result.FailureReason);
    }

    [Fact]
    public async Task ConfirmTotpEnrollmentAsync_WhenAlreadyConfirmedBefore_ReturnsNotPending()
    {
        var account = ProfessionalAccount("already-confirmed@example.com") with
        {
            TotpSecret = "SOMESECRET",
            TotpEnabledAt = DateTimeOffset.UtcNow,
        };
        var store = new FakeAccountStore(account);
        var service = CreateService(store, totpProvider: new StubTotpProvider(validCode: true));

        var result = await service.ConfirmTotpEnrollmentAsync(account.Id, "123456", CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(ConfirmTotpEnrollmentFailureReason.NotPending, result.FailureReason);
    }

    [Fact]
    public async Task ConfirmTotpEnrollmentAsync_WithUnknownAccountId_ReturnsAccountNotFound()
    {
        var store = new FakeAccountStore();
        var service = CreateService(store);

        var result = await service.ConfirmTotpEnrollmentAsync(Guid.NewGuid(), "123456", CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(ConfirmTotpEnrollmentFailureReason.AccountNotFound, result.FailureReason);
    }

    [Fact]
    public async Task VerifyTotpChallengeAsync_WithValidCode_ReturnsSuccess()
    {
        var account = EnabledProfessionalAccount("challenge-code@example.com");
        var store = new FakeAccountStore(account);
        var service = CreateService(store, totpProvider: new StubTotpProvider(validCode: true));

        var result = await service.VerifyTotpChallengeAsync(account.Id, code: "123456", backupCode: null, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(account.Id, result.Account!.Id);
    }

    [Fact]
    public async Task VerifyTotpChallengeAsync_WithInvalidCode_ReturnsInvalidCode()
    {
        var account = EnabledProfessionalAccount("challenge-bad-code@example.com");
        var store = new FakeAccountStore(account);
        var service = CreateService(store, totpProvider: new StubTotpProvider(validCode: false));

        var result = await service.VerifyTotpChallengeAsync(account.Id, code: "000000", backupCode: null, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(VerifyTotpChallengeFailureReason.InvalidCode, result.FailureReason);
    }

    /// <summary>
    /// Core single-use guarantee (ADR-S02-04): consuming a backup code must remove it, so a
    /// second attempt with the SAME backup code fails even though it was valid the first time.
    /// </summary>
    [Fact]
    public async Task VerifyTotpChallengeAsync_WithBackupCode_SucceedsOnce_ThenFailsOnReuse()
    {
        var backupCodes = BackupCodeGenerator.GenerateCodes();
        var usedCode = backupCodes[0];
        var hashes = backupCodes.Select(BackupCodeGenerator.Hash).ToList();
        var account = EnabledProfessionalAccount("backup-single-use@example.com") with { TotpBackupCodeHashes = hashes };
        var store = new FakeAccountStore(account);
        var service = CreateService(store, totpProvider: new StubTotpProvider(validCode: false));

        var firstAttempt = await service.VerifyTotpChallengeAsync(account.Id, code: null, backupCode: usedCode, CancellationToken.None);
        Assert.True(firstAttempt.Succeeded);

        var storedAfterFirstUse = await store.FindByIdAsync(account.Id, CancellationToken.None);
        Assert.DoesNotContain(BackupCodeGenerator.Hash(usedCode), storedAfterFirstUse!.TotpBackupCodeHashes!);
        Assert.Equal(backupCodes.Count - 1, storedAfterFirstUse.TotpBackupCodeHashes!.Count);

        var secondAttempt = await service.VerifyTotpChallengeAsync(account.Id, code: null, backupCode: usedCode, CancellationToken.None);
        Assert.False(secondAttempt.Succeeded);
        Assert.Equal(VerifyTotpChallengeFailureReason.InvalidCode, secondAttempt.FailureReason);
    }

    [Fact]
    public async Task VerifyTotpChallengeAsync_WithUnknownBackupCode_ReturnsInvalidCode()
    {
        var backupCodes = BackupCodeGenerator.GenerateCodes();
        var hashes = backupCodes.Select(BackupCodeGenerator.Hash).ToList();
        var account = EnabledProfessionalAccount("backup-unknown@example.com") with { TotpBackupCodeHashes = hashes };
        var store = new FakeAccountStore(account);
        var service = CreateService(store, totpProvider: new StubTotpProvider(validCode: false));

        var result = await service.VerifyTotpChallengeAsync(account.Id, code: null, backupCode: "00000-00000", CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(VerifyTotpChallengeFailureReason.InvalidCode, result.FailureReason);
    }

    /// <summary>
    /// Defensive edge case: an enabled account whose <see cref="Account.TotpBackupCodeHashes"/>
    /// is null (never reachable through <see cref="AccountService.ConfirmTotpEnrollmentAsync"/>,
    /// which always sets a non-null list, but not a state the null-coalescing fallback in
    /// <see cref="AccountService.VerifyTotpChallengeAsync"/> should crash on).
    /// </summary>
    [Fact]
    public async Task VerifyTotpChallengeAsync_WithBackupCode_WhenHashesListIsNull_ReturnsInvalidCode()
    {
        var account = EnabledProfessionalAccount("backup-null-hashes@example.com");
        var store = new FakeAccountStore(account);
        var service = CreateService(store);

        var result = await service.VerifyTotpChallengeAsync(account.Id, code: null, backupCode: "00000-00000", CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(VerifyTotpChallengeFailureReason.InvalidCode, result.FailureReason);
    }

    [Fact]
    public async Task VerifyTotpChallengeAsync_WithNeitherCodeNorBackupCode_ReturnsInvalidCode()
    {
        var account = EnabledProfessionalAccount("no-code@example.com");
        var store = new FakeAccountStore(account);
        var service = CreateService(store);

        var result = await service.VerifyTotpChallengeAsync(account.Id, code: null, backupCode: null, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(VerifyTotpChallengeFailureReason.InvalidCode, result.FailureReason);
    }

    [Fact]
    public async Task VerifyTotpChallengeAsync_WhenNeverEnabled_ReturnsNotEnabled()
    {
        var account = ProfessionalAccount("never-enabled@example.com");
        var store = new FakeAccountStore(account);
        var service = CreateService(store);

        var result = await service.VerifyTotpChallengeAsync(account.Id, code: "123456", backupCode: null, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(VerifyTotpChallengeFailureReason.NotEnabled, result.FailureReason);
    }

    [Fact]
    public async Task VerifyTotpChallengeAsync_WithUnknownAccountId_ReturnsAccountNotFound()
    {
        var store = new FakeAccountStore();
        var service = CreateService(store);

        var result = await service.VerifyTotpChallengeAsync(Guid.NewGuid(), code: "123456", backupCode: null, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(VerifyTotpChallengeFailureReason.AccountNotFound, result.FailureReason);
    }

    [Fact]
    public async Task RegisterAsync_WithPatientRole_ReturnsNotApplicable()
    {
        var store = new FakeAccountStore();
        var service = CreateService(store);

        var result = await service.RegisterAsync("patient@example.com", SomeVerifier, AccountRole.Patient, CancellationToken.None);

        Assert.Equal(TwoFactorRequirement.NotApplicable, result.TwoFactorRequirement);
    }

    /// <summary>
    /// Security-review fix: a Patient account's <see cref="TwoFactorRequirement"/> is
    /// NotApplicable, so no two-factor ticket should ever be minted for it -- there is no
    /// TOTP flow for this account to prove identity for.
    /// </summary>
    [Fact]
    public async Task RegisterAsync_WithPatientRole_DoesNotIssueTwoFactorTicket()
    {
        var store = new FakeAccountStore();
        var service = CreateService(store);

        var result = await service.RegisterAsync("patient-no-ticket@example.com", SomeVerifier, AccountRole.Patient, CancellationToken.None);

        Assert.Null(result.TwoFactorTicket);
    }

    [Fact]
    public async Task RegisterAsync_WithProfessionalRole_ReturnsSetupRequired()
    {
        var store = new FakeAccountStore();
        var service = CreateService(store);

        var result = await service.RegisterAsync("pro@example.com", SomeVerifier, AccountRole.Professional, CancellationToken.None);

        Assert.Equal(TwoFactorRequirement.SetupRequired, result.TwoFactorRequirement);
    }

    /// <summary>
    /// Security-review fix: a Professional account's registration must mint a two-factor
    /// ticket bound to exactly this account -- the TOTP begin/confirm endpoints require it
    /// as proof this caller passed RegisterAsync for this specific account.
    /// </summary>
    [Fact]
    public async Task RegisterAsync_WithProfessionalRole_IssuesTwoFactorTicketBoundToNewAccount()
    {
        var store = new FakeAccountStore();
        var ticketIssuer = new TwoFactorTicketIssuer();
        var service = CreateService(store, ticketIssuer: ticketIssuer);

        var result = await service.RegisterAsync("pro-ticket@example.com", SomeVerifier, AccountRole.Professional, CancellationToken.None);

        Assert.NotNull(result.TwoFactorTicket);
        Assert.True(ticketIssuer.Validate(result.TwoFactorTicket!, result.Account!.Id));
    }

    [Fact]
    public async Task LoginAsync_WithProfessionalAccount_AlreadyEnabled_ReturnsChallengeRequired()
    {
        var account = EnabledProfessionalAccount("login-2fa@example.com");
        var store = new FakeAccountStore(account);
        var service = CreateService(store, comparerAlwaysMatches: true);

        var result = await service.LoginAsync(account.Email, SomeVerifier, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(TwoFactorRequirement.ChallengeRequired, result.TwoFactorRequirement);
    }

    [Fact]
    public async Task LoginAsync_WithProfessionalAccount_IssuesTwoFactorTicketBoundToThatAccount()
    {
        var account = EnabledProfessionalAccount("login-2fa-ticket@example.com");
        var store = new FakeAccountStore(account);
        var ticketIssuer = new TwoFactorTicketIssuer();
        var service = CreateService(store, comparerAlwaysMatches: true, ticketIssuer: ticketIssuer);

        var result = await service.LoginAsync(account.Email, SomeVerifier, CancellationToken.None);

        Assert.NotNull(result.TwoFactorTicket);
        Assert.True(ticketIssuer.Validate(result.TwoFactorTicket!, account.Id));
    }

    [Fact]
    public async Task LoginAsync_WithPatientAccount_ReturnsNotApplicable()
    {
        var account = new Account(Guid.NewGuid(), "patient-login@example.com", AccountRole.Patient, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var service = CreateService(store, comparerAlwaysMatches: true);

        var result = await service.LoginAsync(account.Email, SomeVerifier, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(TwoFactorRequirement.NotApplicable, result.TwoFactorRequirement);
    }

    [Fact]
    public async Task LoginAsync_WithPatientAccount_DoesNotIssueTwoFactorTicket()
    {
        var account = new Account(Guid.NewGuid(), "patient-login-no-ticket@example.com", AccountRole.Patient, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var service = CreateService(store, comparerAlwaysMatches: true);

        var result = await service.LoginAsync(account.Email, SomeVerifier, CancellationToken.None);

        Assert.Null(result.TwoFactorTicket);
    }

    [Fact]
    public async Task GoogleAuthAsync_WithNewProfessionalAccount_ReturnsSetupRequired()
    {
        var store = new FakeAccountStore();
        var identity = new GoogleIdentity("new-pro-google@example.com", "google-subject-1");
        var service = CreateService(store, googleIdentity: identity);

        var result = await service.GoogleAuthAsync("valid-id-token", AccountRole.Professional, CancellationToken.None);

        Assert.Equal(TwoFactorRequirement.SetupRequired, result.TwoFactorRequirement);
    }

    [Fact]
    public async Task GoogleAuthAsync_WithNewProfessionalAccount_IssuesTwoFactorTicketBoundToNewAccount()
    {
        var store = new FakeAccountStore();
        var identity = new GoogleIdentity("new-pro-google-ticket@example.com", "google-subject-ticket");
        var ticketIssuer = new TwoFactorTicketIssuer();
        var service = CreateService(store, googleIdentity: identity, ticketIssuer: ticketIssuer);

        var result = await service.GoogleAuthAsync("valid-id-token", AccountRole.Professional, CancellationToken.None);

        Assert.NotNull(result.TwoFactorTicket);
        Assert.True(ticketIssuer.Validate(result.TwoFactorTicket!, result.Account!.Id));
    }

    [Fact]
    public async Task GoogleAuthAsync_WithNewPatientAccount_ReturnsNotApplicable()
    {
        var store = new FakeAccountStore();
        var identity = new GoogleIdentity("new-patient-google@example.com", "google-subject-2");
        var service = CreateService(store, googleIdentity: identity);

        var result = await service.GoogleAuthAsync("valid-id-token", AccountRole.Patient, CancellationToken.None);

        Assert.Equal(TwoFactorRequirement.NotApplicable, result.TwoFactorRequirement);
    }

    [Fact]
    public async Task GoogleAuthAsync_WithNewPatientAccount_DoesNotIssueTwoFactorTicket()
    {
        var store = new FakeAccountStore();
        var identity = new GoogleIdentity("new-patient-google-no-ticket@example.com", "google-subject-3");
        var service = CreateService(store, googleIdentity: identity);

        var result = await service.GoogleAuthAsync("valid-id-token", AccountRole.Patient, CancellationToken.None);

        Assert.Null(result.TwoFactorTicket);
    }

    /// <summary>
    /// S02-01 acceptance criterion ("Google resolve o papel sozinho") intersects with the
    /// ticket fix here: an EXISTING professional account signing in via Google must also get
    /// a ticket bound to that existing account, not just brand-new Google sign-ups.
    /// </summary>
    [Fact]
    public async Task GoogleAuthAsync_WithExistingProfessionalAccount_IssuesTwoFactorTicketBoundToExistingAccount()
    {
        var existingAccount = ProfessionalAccount("existing-pro-google@example.com");
        var store = new FakeAccountStore(existingAccount);
        var identity = new GoogleIdentity("existing-pro-google@example.com", "google-subject-existing");
        var ticketIssuer = new TwoFactorTicketIssuer();
        var service = CreateService(store, googleIdentity: identity, ticketIssuer: ticketIssuer);

        var result = await service.GoogleAuthAsync("valid-id-token", AccountRole.Patient, CancellationToken.None);

        Assert.NotNull(result.TwoFactorTicket);
        Assert.True(ticketIssuer.Validate(result.TwoFactorTicket!, existingAccount.Id));
    }

    // --- Spec S02, ticket S02-08: session issuance -----------------------------------

    [Fact]
    public async Task RegisterAsync_WithPatientRole_IssuesSession()
    {
        var store = new FakeAccountStore();
        var service = CreateService(store);

        var result = await service.RegisterAsync("patient-session@example.com", SomeVerifier, AccountRole.Patient, CancellationToken.None);

        Assert.NotNull(result.Session);
        Assert.NotEmpty(result.Session!.AccessToken);
        Assert.NotEmpty(result.Session.RefreshToken);
    }

    /// <summary>
    /// A professional with 2FA still pending is not logged in yet (ADR-S02-03) -- no
    /// session exists until <see cref="AccountService.ConfirmTotpEnrollmentAsync"/> or
    /// <see cref="AccountService.VerifyTotpChallengeAsync"/> completes the login.
    /// </summary>
    [Fact]
    public async Task RegisterAsync_WithProfessionalRole_DoesNotIssueSession()
    {
        var store = new FakeAccountStore();
        var service = CreateService(store);

        var result = await service.RegisterAsync("pro-no-session@example.com", SomeVerifier, AccountRole.Professional, CancellationToken.None);

        Assert.Null(result.Session);
    }

    [Fact]
    public async Task LoginAsync_WithPatientAccount_IssuesSession()
    {
        var account = new Account(Guid.NewGuid(), "patient-login-session@example.com", AccountRole.Patient, SomeVerifier, null);
        var store = new FakeAccountStore(account);
        var service = CreateService(store, comparerAlwaysMatches: true);

        var result = await service.LoginAsync(account.Email, SomeVerifier, CancellationToken.None);

        Assert.NotNull(result.Session);
    }

    [Fact]
    public async Task LoginAsync_WithProfessionalAccount_AlreadyEnabled_DoesNotIssueSession()
    {
        var account = EnabledProfessionalAccount("login-2fa-no-session@example.com");
        var store = new FakeAccountStore(account);
        var service = CreateService(store, comparerAlwaysMatches: true);

        var result = await service.LoginAsync(account.Email, SomeVerifier, CancellationToken.None);

        Assert.Null(result.Session);
    }

    [Fact]
    public async Task GoogleAuthAsync_WithNewPatientAccount_IssuesSession()
    {
        var store = new FakeAccountStore();
        var identity = new GoogleIdentity("new-patient-google-session@example.com", "google-subject-session");
        var service = CreateService(store, googleIdentity: identity);

        var result = await service.GoogleAuthAsync("valid-id-token", AccountRole.Patient, CancellationToken.None);

        Assert.NotNull(result.Session);
    }

    [Fact]
    public async Task GoogleAuthAsync_WithNewProfessionalAccount_DoesNotIssueSession()
    {
        var store = new FakeAccountStore();
        var identity = new GoogleIdentity("new-pro-google-no-session@example.com", "google-subject-no-session");
        var service = CreateService(store, googleIdentity: identity);

        var result = await service.GoogleAuthAsync("valid-id-token", AccountRole.Professional, CancellationToken.None);

        Assert.Null(result.Session);
    }

    /// <summary>
    /// First-time TOTP enrollment confirmation completes a professional's login
    /// (ADR-S02-03: no separate challenge required this once) -- the session issued here
    /// must resolve, via <see cref="ISessionTokenIssuer.ValidateAccess"/>, to exactly this
    /// account.
    /// </summary>
    [Fact]
    public async Task ConfirmTotpEnrollmentAsync_WithValidCode_IssuesSessionBoundToThatAccount()
    {
        var account = ProfessionalAccount("confirm-session@example.com") with { TotpSecret = "PENDINGSECRET" };
        var store = new FakeAccountStore(account);
        var sessionTokenIssuer = new SessionTokenIssuer();
        var service = CreateService(store, totpProvider: new StubTotpProvider(validCode: true), sessionTokenIssuer: sessionTokenIssuer);

        var result = await service.ConfirmTotpEnrollmentAsync(account.Id, "123456", CancellationToken.None);

        Assert.NotNull(result.Session);
        Assert.Equal(account.Id, sessionTokenIssuer.ValidateAccess(result.Session!.AccessToken));
    }

    [Fact]
    public async Task VerifyTotpChallengeAsync_WithValidCode_IssuesSessionBoundToThatAccount()
    {
        var account = EnabledProfessionalAccount("challenge-session@example.com");
        var store = new FakeAccountStore(account);
        var sessionTokenIssuer = new SessionTokenIssuer();
        var service = CreateService(store, totpProvider: new StubTotpProvider(validCode: true), sessionTokenIssuer: sessionTokenIssuer);

        var result = await service.VerifyTotpChallengeAsync(account.Id, code: "123456", backupCode: null, CancellationToken.None);

        Assert.NotNull(result.Session);
        Assert.Equal(account.Id, sessionTokenIssuer.ValidateAccess(result.Session!.AccessToken));
    }

    [Fact]
    public async Task RefreshSessionAsync_WithFreshlyIssuedRefreshToken_Succeeds()
    {
        var store = new FakeAccountStore();
        var sessionTokenIssuer = new SessionTokenIssuer();
        var service = CreateService(store, sessionTokenIssuer: sessionTokenIssuer);
        var issuedDirectly = sessionTokenIssuer.IssuePair(Guid.NewGuid());

        var result = await service.RefreshSessionAsync(issuedDirectly.RefreshToken, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.NotNull(result.TokenPair);
    }

    [Fact]
    public async Task RefreshSessionAsync_WithUnknownToken_Fails()
    {
        var store = new FakeAccountStore();
        var service = CreateService(store);

        var result = await service.RefreshSessionAsync("never-issued", CancellationToken.None);

        Assert.False(result.Succeeded);
    }

    private static Account ProfessionalAccount(string email) =>
        new(Guid.NewGuid(), email, AccountRole.Professional, SomeVerifier, null, AccountVerificationStatus.Active);

    private static Account EnabledProfessionalAccount(string email) =>
        ProfessionalAccount(email) with { TotpSecret = "ENABLEDSECRET", TotpEnabledAt = DateTimeOffset.UtcNow };

    private static AccountService CreateService(
        FakeAccountStore store,
        GoogleIdentity? googleIdentity = null,
        ITotpProvider? totpProvider = null,
        bool comparerAlwaysMatches = false,
        ITwoFactorTicketIssuer? ticketIssuer = null,
        ISessionTokenIssuer? sessionTokenIssuer = null) =>
        new(
            store,
            new StubPasswordVerifierComparer(comparerAlwaysMatches),
            new StubGoogleIdentityProvider(googleIdentity),
            councilRegistryVerifier: null,
            totpProvider: totpProvider ?? new StubTotpProvider(validCode: true),
            twoFactorTicketIssuer: ticketIssuer,
            sessionTokenIssuer: sessionTokenIssuer);

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountService.PasswordVerifierLength];
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

    private sealed class StubPasswordVerifierComparer : IPasswordVerifierComparer
    {
        private readonly bool _alwaysMatches;

        public StubPasswordVerifierComparer(bool alwaysMatches) => _alwaysMatches = alwaysMatches;

        public bool Matches(byte[] submitted, byte[] stored) => _alwaysMatches;
    }

    private sealed class StubGoogleIdentityProvider : IGoogleIdentityProvider
    {
        private readonly GoogleIdentity? _identity;

        public StubGoogleIdentityProvider(GoogleIdentity? identity = null) => _identity = identity;

        public Task<GoogleIdentity?> VerifyIdTokenAsync(string idToken, CancellationToken cancellationToken) =>
            Task.FromResult(_identity);
    }

    private sealed class StubTotpProvider : ITotpProvider
    {
        private readonly bool _validCode;

        public StubTotpProvider(bool validCode) => _validCode = validCode;

        public string GenerateSecret() => "GENERATEDSECRETXYZ";

        public string BuildProvisioningUri(string secret, string accountEmail, string issuer) =>
            $"otpauth://totp/{issuer}:{accountEmail}?secret={secret}";

        public bool ValidateCode(string secret, string code, DateTimeOffset timestamp) => _validCode;
    }
}
