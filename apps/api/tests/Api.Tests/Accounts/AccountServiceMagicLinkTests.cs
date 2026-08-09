using System.Buffers.Text;
using System.Security.Cryptography;
using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// Covers <see cref="AccountService.RequestMagicLinkAsync"/>/<see cref="AccountService.VerifyMagicLinkAsync"/>/
/// <see cref="AccountService.CompleteMagicLinkWebAuthnAsync"/> (Spec S02, ticket S02-05). A
/// separate file from <see cref="AccountServiceTests"/> (which already covers
/// register/login/Google) purely for size -- same "one concern per test file" split as
/// <see cref="AccountServiceTotpTests"/>/<see cref="AccountServiceProfessionalVerificationTests"/>.
///
/// The WebAuthn-completion tests use the REAL <see cref="WebAuthnCeremonyVerifier"/> and a
/// real ES256 keypair (<see cref="SoftwareAuthenticator"/>), the same technique
/// <see cref="WebAuthnCeremonyVerifierTests"/> uses directly -- a fake verifier here would
/// prove nothing about whether AccountService wires the ceremony correctly (right challenge,
/// right RP id/origin, right stored credential material).
/// </summary>
public sealed class AccountServiceMagicLinkTests
{
    private const string RelyingPartyId = "limmiar.test";
    private const string Origin = "https://limmiar.test";

    [Fact]
    public async Task RequestMagicLinkAsync_WithUnknownEmail_SendsToken()
    {
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(), sender);

        await service.RequestMagicLinkAsync("ghost@example.com", CancellationToken.None);

        Assert.True(sender.WasSentTo("ghost@example.com"));
    }

    [Fact]
    public async Task RequestMagicLinkAsync_WithExistingPatientEmail_SendsToken()
    {
        var patient = new Account(Guid.NewGuid(), "patient@example.com", AccountRole.Patient, null, null);
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(patient), sender);

        await service.RequestMagicLinkAsync("patient@example.com", CancellationToken.None);

        Assert.True(sender.WasSentTo("patient@example.com"));
    }

    /// <summary>
    /// Judgment call documented on <see cref="AccountService.RequestMagicLinkAsync"/>: an
    /// existing Professional account must not receive a passwordless magic link, since that
    /// would bypass its mandatory password + TOTP flow (ADR-S02-02/S02-03).
    /// </summary>
    [Fact]
    public async Task RequestMagicLinkAsync_WithExistingProfessionalEmail_DoesNotSendToken()
    {
        var professional = new Account(Guid.NewGuid(), "pro@example.com", AccountRole.Professional, [1], null);
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(professional), sender);

        await service.RequestMagicLinkAsync("pro@example.com", CancellationToken.None);

        Assert.False(sender.WasSentTo("pro@example.com"));
    }

    [Fact]
    public async Task RequestMagicLinkAsync_WhenEmailSenderThrows_StillReturnsSuccess()
    {
        var service = CreateService(new FakeAccountStore(), new MagicLinkEmailSender());

        var result = await service.RequestMagicLinkAsync("unregistered@example.com", CancellationToken.None);

        Assert.Same(RequestMagicLinkResult.Instance, result);
    }

    /// <summary>
    /// Account-enumeration mitigation: the outward result must be identical -- literally the
    /// same, dataless <see cref="RequestMagicLinkResult"/> instance -- whether the e-mail is
    /// unknown, an existing Patient, or a gated Professional.
    /// </summary>
    [Fact]
    public async Task RequestMagicLinkAsync_ForEveryCase_ReturnsIdenticalResult()
    {
        var patient = new Account(Guid.NewGuid(), "patient2@example.com", AccountRole.Patient, null, null);
        var professional = new Account(Guid.NewGuid(), "pro2@example.com", AccountRole.Professional, [1], null);
        var service = CreateService(new FakeAccountStore(patient, professional), new CapturingMagicLinkEmailSender());

        var unknownResult = await service.RequestMagicLinkAsync("ghost2@example.com", CancellationToken.None);
        var patientResult = await service.RequestMagicLinkAsync("patient2@example.com", CancellationToken.None);
        var professionalResult = await service.RequestMagicLinkAsync("pro2@example.com", CancellationToken.None);

        Assert.Same(RequestMagicLinkResult.Instance, unknownResult);
        Assert.Same(RequestMagicLinkResult.Instance, patientResult);
        Assert.Same(RequestMagicLinkResult.Instance, professionalResult);
    }

    [Fact]
    public async Task VerifyMagicLinkAsync_WithInvalidToken_ReturnsFailure()
    {
        var service = CreateService(new FakeAccountStore(), new CapturingMagicLinkEmailSender());

        var result = await service.VerifyMagicLinkAsync("never-issued", CancellationToken.None);

        Assert.False(result.Succeeded);
    }

    [Fact]
    public async Task VerifyMagicLinkAsync_WithExpiredToken_ReturnsFailure()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new MagicLinkIssuer(clock: () => now);
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(), sender, issuer);
        await service.RequestMagicLinkAsync("expiring@example.com", CancellationToken.None);
        var token = sender.LastTokenSentTo("expiring@example.com")!;

        now += MagicLinkIssuer.DefaultTokenLifetime + TimeSpan.FromSeconds(1);
        var result = await service.VerifyMagicLinkAsync(token, CancellationToken.None);

        Assert.False(result.Succeeded);
    }

    [Fact]
    public async Task VerifyMagicLinkAsync_WithNoExistingAccount_ReturnsRegisterCeremonyWithNoCredentialId()
    {
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(), sender);
        await service.RequestMagicLinkAsync("new-patient@example.com", CancellationToken.None);
        var token = sender.LastTokenSentTo("new-patient@example.com")!;

        var result = await service.VerifyMagicLinkAsync(token, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(MagicLinkCeremonyType.Register, result.CeremonyType);
        Assert.NotNull(result.MagicLinkTicket);
        Assert.Equal(32, result.Challenge!.Length);
        Assert.Null(result.CredentialId);
    }

    [Fact]
    public async Task VerifyMagicLinkAsync_WithExistingAccountAndCredential_ReturnsAssertCeremonyWithCredentialId()
    {
        byte[] credentialId = [1, 2, 3];
        var account = new Account(
            Guid.NewGuid(), "returning@example.com", AccountRole.Patient, null, null,
            WebAuthnCredentialId: credentialId, WebAuthnCosePublicKey: [4, 5], WebAuthnSignCount: 0u, WebAuthnAaGuid: Guid.Empty);
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(account), sender);
        await service.RequestMagicLinkAsync("returning@example.com", CancellationToken.None);
        var token = sender.LastTokenSentTo("returning@example.com")!;

        var result = await service.VerifyMagicLinkAsync(token, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(MagicLinkCeremonyType.Assert, result.CeremonyType);
        Assert.Equal(credentialId, result.CredentialId);
    }

    [Fact]
    public async Task VerifyMagicLinkAsync_TokenIsSingleUse()
    {
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(), sender);
        await service.RequestMagicLinkAsync("single-use@example.com", CancellationToken.None);
        var token = sender.LastTokenSentTo("single-use@example.com")!;

        await service.VerifyMagicLinkAsync(token, CancellationToken.None);
        var second = await service.VerifyMagicLinkAsync(token, CancellationToken.None);

        Assert.False(second.Succeeded);
    }

    [Fact]
    public async Task CompleteMagicLinkWebAuthnAsync_WithUnknownTicket_ReturnsFailure()
    {
        var service = CreateService(new FakeAccountStore(), new CapturingMagicLinkEmailSender());

        var result = await service.CompleteMagicLinkWebAuthnAsync(
            "never-issued", [1], [2], [3], null, null, CancellationToken.None);

        Assert.False(result.Succeeded);
    }

    /// <summary>Full chain, real crypto: request -&gt; verify -&gt; complete a REGISTRATION ceremony end to end.</summary>
    [Fact]
    public async Task CompleteMagicLinkWebAuthnAsync_RegistrationPath_CreatesPatientAccountAndIssuesSession()
    {
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(), sender);
        const string email = "register-flow@example.com";

        await service.RequestMagicLinkAsync(email, CancellationToken.None);
        var token = sender.LastTokenSentTo(email)!;
        var verifyResult = await service.VerifyMagicLinkAsync(token, CancellationToken.None);
        Assert.Equal(MagicLinkCeremonyType.Register, verifyResult.CeremonyType);

        var authenticator = new SoftwareAuthenticator();
        var challenge = Base64Url.EncodeToString(verifyResult.Challenge!);
        var clientDataJson = SoftwareAuthenticator.ClientDataJson("webauthn.create", challenge, Origin);
        var attestationObject = authenticator.AttestationObject(RelyingPartyId);

        var result = await service.CompleteMagicLinkWebAuthnAsync(
            verifyResult.MagicLinkTicket!, authenticator.CredentialId, clientDataJson, attestationObject, null, null, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(AccountRole.Patient, result.Account!.Role);
        Assert.Equal(email, result.Account.Email);
        Assert.Null(result.Account.PasswordVerifier);
        Assert.Null(result.Account.GoogleSubjectId);
        Assert.Equal(AccountVerificationStatus.Active, result.Account.VerificationStatus);
        Assert.Equal(authenticator.CredentialId, result.Account.WebAuthnCredentialId);
        Assert.Equal(authenticator.CosePublicKey, result.Account.WebAuthnCosePublicKey);
        Assert.NotNull(result.Session);
        Assert.NotNull(result.Session!.AccessToken);
        Assert.NotNull(result.Session.RefreshToken);
    }

    /// <summary>Full chain, real crypto, second login: register once, then assert (re-use the same credential) and prove the persisted sign count advances.</summary>
    [Fact]
    public async Task CompleteMagicLinkWebAuthnAsync_AssertionPath_UpdatesSignCountAndIssuesSession()
    {
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(), sender);
        const string email = "assert-flow@example.com";
        var authenticator = new SoftwareAuthenticator();

        await RegisterViaMagicLink(service, sender, email, authenticator);

        await service.RequestMagicLinkAsync(email, CancellationToken.None);
        var assertToken = sender.LastTokenSentTo(email)!;
        var assertVerify = await service.VerifyMagicLinkAsync(assertToken, CancellationToken.None);
        Assert.Equal(MagicLinkCeremonyType.Assert, assertVerify.CeremonyType);
        Assert.Equal(authenticator.CredentialId, assertVerify.CredentialId);

        var assertChallenge = Base64Url.EncodeToString(assertVerify.Challenge!);
        var assertClientData = SoftwareAuthenticator.ClientDataJson("webauthn.get", assertChallenge, Origin);
        var authenticatorData = SoftwareAuthenticator.AuthenticatorData(RelyingPartyId, userPresent: true, userVerified: true, signCount: 7);
        var signature = authenticator.Sign(authenticatorData, assertClientData);

        var result = await service.CompleteMagicLinkWebAuthnAsync(
            assertVerify.MagicLinkTicket!, authenticator.CredentialId, assertClientData, null, authenticatorData, signature, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(7u, result.Account!.WebAuthnSignCount);
        Assert.NotNull(result.Session);
    }

    /// <summary>A tampered signature must be rejected via the real verifier chain -- a fake verifier would never catch this.</summary>
    [Fact]
    public async Task CompleteMagicLinkWebAuthnAsync_AssertionPath_WithTamperedSignature_ReturnsFailure()
    {
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(), sender);
        const string email = "tampered-flow@example.com";
        var authenticator = new SoftwareAuthenticator();

        await RegisterViaMagicLink(service, sender, email, authenticator);

        await service.RequestMagicLinkAsync(email, CancellationToken.None);
        var assertToken = sender.LastTokenSentTo(email)!;
        var assertVerify = await service.VerifyMagicLinkAsync(assertToken, CancellationToken.None);
        var assertChallenge = Base64Url.EncodeToString(assertVerify.Challenge!);
        var assertClientData = SoftwareAuthenticator.ClientDataJson("webauthn.get", assertChallenge, Origin);
        var authenticatorData = SoftwareAuthenticator.AuthenticatorData(RelyingPartyId, userPresent: true, userVerified: true, signCount: 1);
        var signature = authenticator.Sign(authenticatorData, assertClientData);
        signature[^1] ^= 0xFF;

        var result = await service.CompleteMagicLinkWebAuthnAsync(
            assertVerify.MagicLinkTicket!, authenticator.CredentialId, assertClientData, null, authenticatorData, signature, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Null(result.Account);
        Assert.Null(result.Session);
    }

    [Fact]
    public async Task CompleteMagicLinkWebAuthnAsync_RegistrationPath_WithMissingAttestationObject_ReturnsFailure()
    {
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(), sender);
        const string email = "missing-attestation@example.com";
        await service.RequestMagicLinkAsync(email, CancellationToken.None);
        var token = sender.LastTokenSentTo(email)!;
        var verifyResult = await service.VerifyMagicLinkAsync(token, CancellationToken.None);

        var result = await service.CompleteMagicLinkWebAuthnAsync(
            verifyResult.MagicLinkTicket!, [1, 2, 3], [4, 5, 6], attestationObject: null, null, null, CancellationToken.None);

        Assert.False(result.Succeeded);
    }

    /// <summary>The real verifier must reject a registration whose clientDataJSON carries the wrong challenge -- proves AccountService doesn't just trust whatever comes back.</summary>
    [Fact]
    public async Task CompleteMagicLinkWebAuthnAsync_RegistrationPath_WithWrongChallenge_ReturnsFailure()
    {
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(), sender);
        const string email = "wrong-challenge@example.com";
        await service.RequestMagicLinkAsync(email, CancellationToken.None);
        var token = sender.LastTokenSentTo(email)!;
        var verifyResult = await service.VerifyMagicLinkAsync(token, CancellationToken.None);

        var authenticator = new SoftwareAuthenticator();
        var wrongChallenge = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));
        var clientDataJson = SoftwareAuthenticator.ClientDataJson("webauthn.create", wrongChallenge, Origin);
        var attestationObject = authenticator.AttestationObject(RelyingPartyId);

        var result = await service.CompleteMagicLinkWebAuthnAsync(
            verifyResult.MagicLinkTicket!, authenticator.CredentialId, clientDataJson, attestationObject, null, null, CancellationToken.None);

        Assert.False(result.Succeeded);
    }

    [Fact]
    public async Task CompleteMagicLinkWebAuthnAsync_AssertionPath_WithMissingAuthenticatorData_ReturnsFailure()
    {
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(), sender);
        const string email = "missing-authdata@example.com";
        var authenticator = new SoftwareAuthenticator();
        await RegisterViaMagicLink(service, sender, email, authenticator);

        await service.RequestMagicLinkAsync(email, CancellationToken.None);
        var assertToken = sender.LastTokenSentTo(email)!;
        var assertVerify = await service.VerifyMagicLinkAsync(assertToken, CancellationToken.None);

        var result = await service.CompleteMagicLinkWebAuthnAsync(
            assertVerify.MagicLinkTicket!, authenticator.CredentialId, [1, 2], null, authenticatorData: null, signature: [3, 4], CancellationToken.None);

        Assert.False(result.Succeeded);
    }

    [Fact]
    public async Task CompleteMagicLinkWebAuthnAsync_AssertionPath_WithMissingSignature_ReturnsFailure()
    {
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(), sender);
        const string email = "missing-signature@example.com";
        var authenticator = new SoftwareAuthenticator();
        await RegisterViaMagicLink(service, sender, email, authenticator);

        await service.RequestMagicLinkAsync(email, CancellationToken.None);
        var assertToken = sender.LastTokenSentTo(email)!;
        var assertVerify = await service.VerifyMagicLinkAsync(assertToken, CancellationToken.None);

        var result = await service.CompleteMagicLinkWebAuthnAsync(
            assertVerify.MagicLinkTicket!, authenticator.CredentialId, [1, 2], null, authenticatorData: [3, 4], signature: null, CancellationToken.None);

        Assert.False(result.Succeeded);
    }

    /// <summary>
    /// Defensive branch: the account behind an Assert ticket's AccountId is gone by the time
    /// the ceremony completes (e.g. deleted between the two calls). Ticket is minted directly
    /// via <see cref="IMagicLinkIssuer"/> rather than through <see cref="AccountService.VerifyMagicLinkAsync"/>,
    /// since that method can never itself produce a ticket pointing at a nonexistent account.
    /// </summary>
    [Fact]
    public async Task CompleteMagicLinkWebAuthnAsync_AssertionPath_WithAccountNoLongerInStore_ReturnsFailure()
    {
        var issuer = new MagicLinkIssuer();
        var service = CreateService(new FakeAccountStore(), new CapturingMagicLinkEmailSender(), issuer);
        var ticketData = new MagicLinkTicketData(
            "ghost-account@example.com", MagicLinkCeremonyType.Assert, RandomNumberGenerator.GetBytes(32),
            Guid.NewGuid(), [1, 2, 3], [4, 5], 0u);
        var ticket = issuer.IssueTicket(ticketData);

        var result = await service.CompleteMagicLinkWebAuthnAsync(
            ticket, [1, 2, 3], [4, 5, 6], null, authenticatorData: [7, 8], signature: [9, 10], CancellationToken.None);

        Assert.False(result.Succeeded);
    }

    [Fact]
    public async Task CompleteMagicLinkWebAuthnAsync_TicketIsSingleUse()
    {
        var sender = new CapturingMagicLinkEmailSender();
        var service = CreateService(new FakeAccountStore(), sender);
        const string email = "single-use-ticket@example.com";
        var authenticator = new SoftwareAuthenticator();

        await service.RequestMagicLinkAsync(email, CancellationToken.None);
        var token = sender.LastTokenSentTo(email)!;
        var verifyResult = await service.VerifyMagicLinkAsync(token, CancellationToken.None);
        var challenge = Base64Url.EncodeToString(verifyResult.Challenge!);
        var clientDataJson = SoftwareAuthenticator.ClientDataJson("webauthn.create", challenge, Origin);
        var attestationObject = authenticator.AttestationObject(RelyingPartyId);

        var first = await service.CompleteMagicLinkWebAuthnAsync(
            verifyResult.MagicLinkTicket!, authenticator.CredentialId, clientDataJson, attestationObject, null, null, CancellationToken.None);
        var second = await service.CompleteMagicLinkWebAuthnAsync(
            verifyResult.MagicLinkTicket!, authenticator.CredentialId, clientDataJson, attestationObject, null, null, CancellationToken.None);

        Assert.True(first.Succeeded);
        Assert.False(second.Succeeded);
    }

    private static async Task RegisterViaMagicLink(
        AccountService service, CapturingMagicLinkEmailSender sender, string email, SoftwareAuthenticator authenticator)
    {
        await service.RequestMagicLinkAsync(email, CancellationToken.None);
        var token = sender.LastTokenSentTo(email)!;
        var verifyResult = await service.VerifyMagicLinkAsync(token, CancellationToken.None);
        var challenge = Base64Url.EncodeToString(verifyResult.Challenge!);
        var clientDataJson = SoftwareAuthenticator.ClientDataJson("webauthn.create", challenge, Origin);
        var attestationObject = authenticator.AttestationObject(RelyingPartyId);

        var result = await service.CompleteMagicLinkWebAuthnAsync(
            verifyResult.MagicLinkTicket!, authenticator.CredentialId, clientDataJson, attestationObject, null, null, CancellationToken.None);
        Assert.True(result.Succeeded);
    }

    private static AccountService CreateService(
        IAccountStore store, IMagicLinkEmailSender sender, IMagicLinkIssuer? magicLinkIssuer = null) =>
        new(
            store,
            new NeverMatchesPasswordVerifierComparer(),
            new NullGoogleIdentityProvider(),
            magicLinkIssuer: magicLinkIssuer,
            magicLinkEmailSender: sender,
            webAuthnCeremonyVerifier: new WebAuthnCeremonyVerifier(),
            webAuthnRelyingPartyId: RelyingPartyId,
            webAuthnExpectedOrigin: Origin);

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
            Task.FromResult<IReadOnlyList<Account>>([]);
    }

    private sealed class NeverMatchesPasswordVerifierComparer : IPasswordVerifierComparer
    {
        public bool Matches(byte[] submitted, byte[] stored) => false;
    }

    private sealed class NullGoogleIdentityProvider : IGoogleIdentityProvider
    {
        public Task<GoogleIdentity?> VerifyIdTokenAsync(string idToken, CancellationToken cancellationToken) =>
            Task.FromResult<GoogleIdentity?>(null);
    }
}
