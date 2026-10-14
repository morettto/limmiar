using System.Buffers.Text;
using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class AccountServiceMagicLinkTests
{
    private const string Rp = "limmiar.test";
    private const string Origin = "https://limmiar.test";

    private sealed class AccessStore(InMemoryAccountStore accounts) : IAnonymousPatientAccessStore
    {
        public PatientAccessInvitation? Invitation { get; set; } = new("0123456789AB", Guid.NewGuid(), Guid.NewGuid(), null);
        public bool RejectCompletion { get; set; }
        public Task<PatientAccessInvitation?> FindInvitationAsync(string code, CancellationToken ct) =>
            Task.FromResult(Invitation?.Code == code ? Invitation : null);
        public async Task<bool> RegisterAsync(PatientAccessInvitation invitation, Account account, CancellationToken ct)
        {
            if (RejectCompletion) return false;
            await accounts.InsertAsync(account, ct);
            return true;
        }
        public async Task<bool> AssertAsync(PatientAccessInvitation invitation, Account account, uint expectedSignCount, CancellationToken ct)
        {
            if (RejectCompletion) return false;
            await accounts.MutateAsync(account.Id, _ => account, ct);
            return true;
        }
    }

    private sealed class Harness
    {
        public InMemoryAccountStore Accounts { get; } = new();
        public MagicLinkIssuer Issuer { get; } = new();
        public AccessStore Access { get; }
        public VerifyMagicLinkHandler Verify { get; }
        public CompleteMagicLinkWebAuthnHandler Complete { get; }
        public Harness()
        {
            Access = new AccessStore(Accounts);
            Verify = new VerifyMagicLinkHandler(Accounts, Issuer, Access);
            Complete = new CompleteMagicLinkWebAuthnHandler(Issuer, new WebAuthnCeremonyVerifier(), Accounts,
                Access, new SessionTokenIssuer(), new WebAuthnRelyingPartyOptions(Rp, Origin));
        }
        public Task<VerifyMagicLinkResult> Begin(Guid? id = null) =>
            Verify.Handle(new VerifyMagicLinkCommand("0123456789AB", id), CancellationToken.None).AsTask();
        public Task<CompleteMagicLinkResult> Register(VerifyMagicLinkResult ceremony, SoftwareAuthenticator authenticator, string? challenge = null, bool missingAttestation = false) =>
            Complete.Handle(new CompleteMagicLinkWebAuthnCommand(ceremony.MagicLinkTicket!, authenticator.CredentialId,
                SoftwareAuthenticator.ClientDataJson("webauthn.create", challenge ?? Base64Url.EncodeToString(ceremony.Challenge!), Origin),
                missingAttestation ? null : authenticator.AttestationObject(Rp), null, null), CancellationToken.None).AsTask();
        public Task<CompleteMagicLinkResult> Assert(VerifyMagicLinkResult ceremony, SoftwareAuthenticator authenticator,
            string failure = "", uint count = 1)
        {
            var data = SoftwareAuthenticator.ClientDataJson("webauthn.get", Base64Url.EncodeToString(ceremony.Challenge!), Origin);
            var auth = SoftwareAuthenticator.AuthenticatorData(Rp, userPresent: true, userVerified: true, signCount: count);
            var signature = authenticator.Sign(auth, data);
            if (failure == "signature") signature[^1] ^= 1;
            return Complete.Handle(new CompleteMagicLinkWebAuthnCommand(ceremony.MagicLinkTicket!,
                failure == "credential" ? [99] : authenticator.CredentialId, data, null,
                failure == "authenticator" ? null : auth, failure == "missing-signature" ? null : signature), CancellationToken.None).AsTask();
        }
        public async Task<Account> Registered(SoftwareAuthenticator authenticator)
        {
            var result = await Register(await Begin(), authenticator);
            Xunit.Assert.True(result.Succeeded);
            return result.Account!;
        }
    }

    [Fact]
    public async Task UnknownInvitation_RejectsWithoutEmailLookup()
    {
        var h = new Harness();
        h.Access.Invitation = null;
        Assert.False((await h.Begin()).Succeeded);
    }

    [Fact]
    public async Task Register_UsesStableOpaqueAccountId_NeverAnEmail()
    {
        var h = new Harness();
        var ceremony = await h.Begin();
        var result = await h.Register(ceremony, new SoftwareAuthenticator());
        Assert.True(result.Succeeded);
        Assert.Equal(ceremony.AccountId, result.Account!.Id);
        Assert.Null(result.Account.Email);
        Assert.Equal(AccountRole.Patient, result.Account.Role);
        Assert.NotNull(result.Session);
        Assert.NotNull(result.Account.WebAuthnCosePublicKey);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("challenge")]
    [InlineData("revoked-invitation")]
    public async Task InvalidRegistration_DoesNotCreateAccountOrSession(string failure)
    {
        var h = new Harness();
        var ceremony = await h.Begin();
        h.Access.RejectCompletion = failure == "revoked-invitation";
        var result = await h.Register(ceremony, new SoftwareAuthenticator(), failure == "challenge" ? "wrong" : null, failure == "missing");
        Assert.False(result.Succeeded);
        Assert.Null(result.Session);
        Assert.Null(await h.Accounts.FindByIdAsync(ceremony.AccountId!.Value, CancellationToken.None));
    }

    [Fact]
    public async Task BoundRecord_CannotChangeItsPatientIdentity()
    {
        var h = new Harness();
        var account = await h.Registered(new SoftwareAuthenticator());
        h.Access.Invitation = h.Access.Invitation! with { PatientAccountId = account.Id };
        Assert.False((await h.Begin(Guid.NewGuid())).Succeeded);
        var next = await h.Begin();
        Assert.Equal(account.Id, next.AccountId);
        Assert.Equal(MagicLinkCeremonyType.Assert, next.CeremonyType);
        Assert.Equal(account.WebAuthnCredentialId, next.CredentialId);
    }

    [Fact]
    public async Task SamePatientAtNewProfessional_MustAssertExistingPasskey()
    {
        var h = new Harness();
        var authenticator = new SoftwareAuthenticator();
        var account = await h.Registered(authenticator);
        var result = await h.Assert(await h.Begin(account.Id), authenticator);
        Assert.True(result.Succeeded);
        Assert.Equal(account.Id, result.Account!.Id);
        Assert.Equal(1u, result.Account.WebAuthnSignCount);
        Assert.NotNull(result.Session);
    }

    [Theory]
    [InlineData("unknown")]
    [InlineData("professional")]
    [InlineData("email")]
    [InlineData("inactive")]
    [InlineData("credential")]
    [InlineData("publicKey")]
    [InlineData("counter")]
    public async Task CannotAssertAnInvalidAccount(string failure)
    {
        var h = new Harness();
        var account = await h.Registered(new SoftwareAuthenticator());
        account = failure switch
        {
            "professional" => account with { Role = AccountRole.Professional },
            "email" => account with { Email = "forbidden@example.test" },
            "inactive" => account with { VerificationStatus = AccountVerificationStatus.Rejected },
            "credential" => account with { WebAuthnCredentialId = null },
            "publicKey" => account with { WebAuthnCosePublicKey = null },
            "counter" => account with { WebAuthnSignCount = null },
            _ => account,
        };
        await h.Accounts.MutateAsync(account.Id, _ => account, CancellationToken.None);
        Assert.False((await h.Begin(failure == "unknown" ? Guid.NewGuid() : account.Id)).Succeeded);
    }

    [Theory]
    [InlineData("authenticator")]
    [InlineData("missing-signature")]
    [InlineData("signature")]
    [InlineData("credential")]
    [InlineData("inactive")]
    [InlineData("professional")]
    [InlineData("email")]
    [InlineData("revoked-invitation")]
    public async Task InvalidAssertion_DoesNotIssueSessionOrUpdateCounter(string failure)
    {
        var h = new Harness();
        var authenticator = new SoftwareAuthenticator();
        var account = await h.Registered(authenticator);
        var ceremony = await h.Begin(account.Id);
        if (failure is "inactive" or "professional" or "email")
            await h.Accounts.MutateAsync(account.Id, _ => failure switch
            {
                "inactive" => account with { VerificationStatus = AccountVerificationStatus.Rejected },
                "professional" => account with { Role = AccountRole.Professional },
                _ => account with { Email = "forbidden@example.test" },
            }, CancellationToken.None);
        h.Access.RejectCompletion = failure == "revoked-invitation";
        var result = await h.Assert(ceremony, authenticator, failure);
        Assert.False(result.Succeeded);
        Assert.Null(result.Session);
        Assert.Equal(0u, (await h.Accounts.FindByIdAsync(account.Id, CancellationToken.None))!.WebAuthnSignCount);
    }

    [Fact]
    public async Task CompletionTicket_IsSingleUse_EvenAfterBadSignature()
    {
        var h = new Harness();
        var authenticator = new SoftwareAuthenticator();
        var account = await h.Registered(authenticator);
        var ceremony = await h.Begin(account.Id);
        Assert.False((await h.Assert(ceremony, authenticator, "signature")).Succeeded);
        Assert.False((await h.Assert(ceremony, authenticator)).Succeeded);
    }

    [Theory]
    [InlineData("account")]
    [InlineData("credential")]
    [InlineData("publicKey")]
    [InlineData("counter")]
    public async Task MalformedInternalAssertionTicket_Rejects(string missing)
    {
        var h = new Harness();
        var authenticator = new SoftwareAuthenticator();
        var ticket = h.Issuer.IssueTicket(new MagicLinkTicketData(h.Access.Invitation!, MagicLinkCeremonyType.Assert, [1], Guid.NewGuid(),
            missing == "credential" ? null : authenticator.CredentialId,
            missing == "publicKey" ? null : authenticator.CosePublicKey, missing == "counter" ? null : 0));
        var result = await h.Complete.Handle(new CompleteMagicLinkWebAuthnCommand(ticket, authenticator.CredentialId, [1], null, [1], [1]), CancellationToken.None);
        Assert.False(result.Succeeded);
    }
}
