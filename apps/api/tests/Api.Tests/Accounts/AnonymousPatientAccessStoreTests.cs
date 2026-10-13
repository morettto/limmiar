using Api.Accounts;
using Api.Data;
using Api.PatientLinks;
using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Accounts;

[Collection("Database")]
public sealed class AnonymousPatientAccessStoreTests(PostgresContainerFixture fixture) : IAsyncLifetime
{
    private NpgsqlDataSource _dataSource = null!;
    private PostgresAccountStore _accounts = null!;
    private PatientLinkStore _links = null!;
    private DateTimeOffset _now = new(2026, 10, 3, 0, 0, 0, TimeSpan.Zero);
    private PostgresAnonymousPatientAccessStore _access = null!;

    public async Task InitializeAsync()
    {
        await using var connection = new NpgsqlConnection(fixture.AdminConnectionString);
        await connection.OpenAsync();
        var reset = await Respawner.CreateAsync(connection, new RespawnerOptions { SchemasToInclude = ["public"], DbAdapter = DbAdapter.Postgres });
        await reset.ResetAsync(connection);
        _dataSource = NpgsqlDataSourceFactory.Create(fixture.AppRoleConnectionString);
        _accounts = new PostgresAccountStore(_dataSource, new TotpSecretCipher(new byte[32]));
        _links = new PatientLinkStore(_dataSource, () => _now);
        _access = new PostgresAnonymousPatientAccessStore(_dataSource, () => _now);
    }

    public async Task DisposeAsync() => await _dataSource.DisposeAsync();

    private static Account Patient() => new(Guid.NewGuid(), null, AccountRole.Patient, null, null,
        WebAuthnCredentialId: Guid.NewGuid().ToByteArray(), WebAuthnCosePublicKey: [1, 2, 3],
        WebAuthnSignCount: 0, WebAuthnAaGuid: Guid.Empty);

    private async Task<(Account Professional, PatientAccessInvitation Invitation)> InviteAsync(Guid? patientId = null, Account? professional = null)
    {
        professional ??= new Account(Guid.NewGuid(), $"{Guid.NewGuid()}@example.test", AccountRole.Professional, null, null);
        if (await _accounts.FindByIdAsync(professional.Id, CancellationToken.None) is null)
            await _accounts.InsertAsync(professional, CancellationToken.None);
        var invite = await _links.CreateInviteAsync(professional.Id, patientId ?? Guid.NewGuid(), CancellationToken.None);
        return (professional, (await _access.FindInvitationAsync(invite.Code, CancellationToken.None))!);
    }

    [Fact]
    public async Task Register_PersistsOnlyOpaqueIdentityAndOwnedLink_ConsumesInvite()
    {
        var (_, invite) = await InviteAsync();
        var patient = Patient();
        Assert.True(await _access.RegisterAsync(invite, patient, CancellationToken.None));
        Assert.Equivalent(patient, await _accounts.FindByIdAsync(patient.Id, CancellationToken.None));
        Assert.Null(await _access.FindInvitationAsync(invite.Code, CancellationToken.None));
        var link = Assert.Single(await _links.ListForAsync(patient.Id, CancellationToken.None));
        Assert.Equal(invite.ProfessionalAccountId, link.ProfessionalAccountId);
        Assert.Equal(invite.PatientId, link.PatientId);
        Assert.False(await _access.RegisterAsync(invite, Patient(), CancellationToken.None));
    }

    [Fact]
    public async Task Register_TwoAnonymousAccounts_HaveNoEmailCollision()
    {
        var (_, first) = await InviteAsync();
        var (_, second) = await InviteAsync();
        var a = Patient();
        var b = Patient();
        Assert.True(await _access.RegisterAsync(first, a, CancellationToken.None));
        Assert.True(await _access.RegisterAsync(second, b, CancellationToken.None));
        Assert.Null((await _accounts.FindByIdAsync(a.Id, CancellationToken.None))!.Email);
        Assert.Null((await _accounts.FindByIdAsync(b.Id, CancellationToken.None))!.Email);
    }

    [Fact]
    public async Task UnknownExpiredAndRevokedInvitations_AreIndistinguishable()
    {
        Assert.Null(await _access.FindInvitationAsync("UNKNOWN", CancellationToken.None));
        var (professional, invite) = await InviteAsync();
        await _accounts.MutateAsync(professional.Id, _ => professional with { VerificationStatus = AccountVerificationStatus.Rejected }, CancellationToken.None);
        Assert.Null(await _access.FindInvitationAsync(invite.Code, CancellationToken.None));
        Assert.False(await _access.RegisterAsync(invite, Patient(), CancellationToken.None));
        await _accounts.MutateAsync(professional.Id, _ => professional, CancellationToken.None);
        _now += PatientLinkStore.InviteLifetime;
        Assert.Null(await _access.FindInvitationAsync(invite.Code, CancellationToken.None));
        Assert.False(await _access.RegisterAsync(invite, Patient(), CancellationToken.None));
    }

    [Theory]
    [InlineData("professional")]
    [InlineData("patient")]
    public async Task CannotSwapInvitationBinding(string swap)
    {
        var (_, invite) = await InviteAsync();
        var forged = swap == "professional" ? invite with { ProfessionalAccountId = Guid.NewGuid() } : invite with { PatientId = Guid.NewGuid() };
        var patient = Patient();
        Assert.False(await _access.RegisterAsync(forged, patient, CancellationToken.None));
        Assert.Null(await _accounts.FindByIdAsync(patient.Id, CancellationToken.None));
        Assert.NotNull(await _access.FindInvitationAsync(invite.Code, CancellationToken.None));
    }

    [Fact]
    public async Task ConcurrentRegistrations_OnSameInvitation_ExactlyOneWins_NoOrphan()
    {
        var (_, invite) = await InviteAsync();
        var a = Patient();
        var b = Patient();
        var results = await Task.WhenAll(_access.RegisterAsync(invite, a, CancellationToken.None), _access.RegisterAsync(invite, b, CancellationToken.None));
        Assert.Single(results, x => x);
        Assert.Null(await _accounts.FindByIdAsync(results[0] ? b.Id : a.Id, CancellationToken.None));
        Assert.Single(await _links.ListForAsync(invite.ProfessionalAccountId, CancellationToken.None));
    }

    [Fact]
    public async Task SameRecord_TwoInvitations_CannotCreateSecondAccount()
    {
        var (professional, first) = await InviteAsync();
        var (_, second) = await InviteAsync(first.PatientId, professional);
        var a = Patient();
        var b = Patient();
        Assert.True(await _access.RegisterAsync(first, a, CancellationToken.None));
        Assert.False(await _access.RegisterAsync(second, b, CancellationToken.None));
        Assert.Null(await _accounts.FindByIdAsync(b.Id, CancellationToken.None));
        var read = await _access.FindInvitationAsync(second.Code, CancellationToken.None);
        Assert.Equal(a.Id, read!.PatientAccountId);
    }

    [Fact]
    public async Task ExistingPatient_CanLinkToSecondProfessional_SeparateRecordIds()
    {
        var (_, first) = await InviteAsync();
        var (_, second) = await InviteAsync();
        var patient = Patient();
        Assert.True(await _access.RegisterAsync(first, patient, CancellationToken.None));
        Assert.True(await _access.AssertAsync(second, patient with { WebAuthnSignCount = 1 }, 0, CancellationToken.None));
        var links = await _links.ListForAsync(patient.Id, CancellationToken.None);
        Assert.Equal(2, links.Count);
        Assert.Equal(new[] { first.PatientId, second.PatientId }.Order(), links.Select(x => x.PatientId).Order());
        Assert.Single(await _links.ListForAsync(first.ProfessionalAccountId, CancellationToken.None));
        Assert.Single(await _links.ListForAsync(second.ProfessionalAccountId, CancellationToken.None));
    }

    [Fact]
    public async Task ExistingBoundRecord_RequiresSameAccount_AndSupportsNextLogin()
    {
        var (professional, first) = await InviteAsync();
        var patient = Patient();
        Assert.True(await _access.RegisterAsync(first, patient, CancellationToken.None));
        var (_, next) = await InviteAsync(first.PatientId, professional);
        var other = Patient();
        await _accounts.InsertAsync(other, CancellationToken.None);
        Assert.False(await _access.AssertAsync(next, other with { WebAuthnSignCount = 1 }, 0, CancellationToken.None));
        Assert.True(await _access.AssertAsync(next, patient with { WebAuthnSignCount = 1 }, 0, CancellationToken.None));
        Assert.False(await _access.AssertAsync(next, patient with { WebAuthnSignCount = 2 }, 1, CancellationToken.None));
    }

    [Fact]
    public async Task DuplicateCredential_RollsBackAccountAndLink_LeavesInvitation()
    {
        var (_, first) = await InviteAsync();
        var (_, second) = await InviteAsync();
        var patient = Patient();
        Assert.True(await _access.RegisterAsync(first, patient, CancellationToken.None));
        var duplicate = patient with { Id = Guid.NewGuid() };
        Assert.False(await _access.RegisterAsync(second, duplicate, CancellationToken.None));
        Assert.Null(await _accounts.FindByIdAsync(duplicate.Id, CancellationToken.None));
        Assert.Empty(await _links.ListForAsync(second.ProfessionalAccountId, CancellationToken.None));
        Assert.NotNull(await _access.FindInvitationAsync(second.Code, CancellationToken.None));
    }

    [Fact]
    public async Task CounterCompareAndSwap_PreservesConcurrentRecoveryChanges()
    {
        var (_, first) = await InviteAsync();
        var patient = Patient();
        Assert.True(await _access.RegisterAsync(first, patient, CancellationToken.None));
        var (_, next) = await InviteAsync();
        await _accounts.MutateAsync(patient.Id, _ => patient with { RecoveryVerifier = new byte[32], RecoveryEnvelope = new byte[120], WebAuthnSignCount = 1 }, CancellationToken.None);
        Assert.False(await _access.AssertAsync(next, patient with { WebAuthnSignCount = 2 }, 0, CancellationToken.None));
        Assert.True(await _access.AssertAsync(next, patient with { WebAuthnSignCount = 2 }, 1, CancellationToken.None));
        var stored = (await _accounts.FindByIdAsync(patient.Id, CancellationToken.None))!;
        Assert.Equal(2u, stored.WebAuthnSignCount);
        Assert.Equal(new byte[120], stored.RecoveryEnvelope);
        Assert.Equal(new byte[32], stored.RecoveryVerifier);
    }

    [Fact]
    public async Task AnonymousRows_AreInvisibleWithoutLookupKey()
    {
        var (_, invite) = await InviteAsync();
        var patient = Patient();
        Assert.True(await _access.RegisterAsync(invite, patient, CancellationToken.None));
        await using var connection = await _dataSource.OpenConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT count(*) FROM accounts WHERE role = 'Patient'";
        Assert.Equal(0L, await command.ExecuteScalarAsync());
    }

    [Theory]
    [InlineData("role")]
    [InlineData("email")]
    [InlineData("password")]
    [InlineData("google")]
    [InlineData("credential")]
    [InlineData("publicKey")]
    [InlineData("counter")]
    [InlineData("aaGuid")]
    public async Task InvalidAnonymousIdentity_IsRefusedBeforePersistence(string field)
    {
        var (_, invitation) = await InviteAsync();
        var account = Patient();
        account = field switch
        {
            "role" => account with { Role = AccountRole.Professional },
            "email" => account with { Email = "forbidden@example.test" },
            "password" => account with { PasswordVerifier = new byte[32] },
            "google" => account with { GoogleSubjectId = "forbidden" },
            "credential" => account with { WebAuthnCredentialId = null },
            "publicKey" => account with { WebAuthnCosePublicKey = null },
            "counter" => account with { WebAuthnSignCount = null },
            _ => account with { WebAuthnAaGuid = null },
        };
        Assert.False(await _access.RegisterAsync(invitation, account, CancellationToken.None));
        Assert.Null(await _accounts.FindByIdAsync(account.Id, CancellationToken.None));
        Assert.NotNull(await _access.FindInvitationAsync(invitation.Code, CancellationToken.None));
    }

    [Fact]
    public async Task ExpirationBetweenReadAndConsumption_DoesNotCreateOrConsumeAnything()
    {
        var (_, invitation) = await InviteAsync();
        var expiry = _now + PatientLinkStore.InviteLifetime;
        var reads = 0;
        var boundary = new PostgresAnonymousPatientAccessStore(_dataSource, () => ++reads == 1 ? expiry.AddTicks(-1) : expiry);
        var account = Patient();
        Assert.False(await boundary.RegisterAsync(invitation, account, CancellationToken.None));
        Assert.Null(await _accounts.FindByIdAsync(account.Id, CancellationToken.None));
        Assert.NotNull(await _access.FindInvitationAsync(invitation.Code, CancellationToken.None));
    }

    [Theory]
    [InlineData(0u, 0u, true)]
    [InlineData(1u, 0u, false)]
    [InlineData(1u, 1u, false)]
    [InlineData(1u, 2u, true)]
    public async Task SignatureCounter_MustAdvance_UnlessBothAreZero(uint oldCounter, uint newCounter, bool expected)
    {
        var (_, first) = await InviteAsync();
        var account = Patient() with { WebAuthnSignCount = oldCounter };
        Assert.True(await _access.RegisterAsync(first, account, CancellationToken.None));
        var (_, next) = await InviteAsync();
        Assert.Equal(expected, await _access.AssertAsync(next, account with { WebAuthnSignCount = newCounter }, oldCounter, CancellationToken.None));
    }

    [Fact]
    public async Task DatabaseTimeout_PropagatesAndRollsBackIdentityLinkAndInvitation()
    {
        var (_, invitation) = await InviteAsync();
        await using var admin = new NpgsqlConnection(fixture.AdminConnectionString);
        await admin.OpenAsync();
        await using var transaction = await admin.BeginTransactionAsync();
        await using var locked = admin.CreateCommand();
        locked.Transaction = transaction;
        locked.CommandText = "SELECT code FROM patient_link_invites WHERE code = @code FOR UPDATE";
        locked.Parameters.AddWithValue("code", invitation.Code);
        Assert.Equal(invitation.Code, await locked.ExecuteScalarAsync());
        var settings = new NpgsqlConnectionStringBuilder(fixture.AppRoleConnectionString) { Options = "-c statement_timeout=200" };
        await using var timedSource = NpgsqlDataSourceFactory.Create(settings.ConnectionString);
        var timed = new PostgresAnonymousPatientAccessStore(timedSource, () => _now);
        var account = Patient();
        var error = await Assert.ThrowsAsync<PostgresException>(() => timed.RegisterAsync(invitation, account, CancellationToken.None));
        Assert.Equal(PostgresErrorCodes.QueryCanceled, error.SqlState);
        await transaction.RollbackAsync();
        Assert.Null(await _accounts.FindByIdAsync(account.Id, CancellationToken.None));
        Assert.Empty(await _links.ListForAsync(invitation.ProfessionalAccountId, CancellationToken.None));
        Assert.NotNull(await _access.FindInvitationAsync(invitation.Code, CancellationToken.None));
    }
}
