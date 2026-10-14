using Api.Accounts;
using Api.Data;
using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Accounts;

/// <summary>
/// PostgresAccountStore against real Postgres (S11-03, fatia 6, migration 0010_create_accounts.sql).
/// One store instance per test method, reconstructed from a fresh NpgsqlDataSource, so a
/// round-trip proves the row itself carries every field -- not something left over on an
/// in-memory object graph.
/// </summary>
[Collection("Database")]
public sealed class PostgresAccountStoreTests : IAsyncLifetime
{
    private static readonly TotpSecretCipher SomeTotpSecretCipher = new(new byte[32]);

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;
    private NpgsqlDataSource _dataSource = null!;

    public PostgresAccountStoreTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    public async Task InitializeAsync()
    {
        await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await adminConnection.OpenAsync();

        _respawner = await Respawner.CreateAsync(adminConnection, new RespawnerOptions
        {
            SchemasToInclude = ["public"],
            DbAdapter = DbAdapter.Postgres,
        });
        await _respawner.ResetAsync(adminConnection);

        _dataSource = NpgsqlDataSourceFactory.Create(_fixture.AppRoleConnectionString);
    }

    public async Task DisposeAsync() => await _dataSource.DisposeAsync();

    [Fact]
    public async Task InsertThenFindByEmail_FromANewStoreInstance_ReturnsEveryField()
    {
        var account = new Account(
            Id: Guid.NewGuid(),
            Email: "postgres-store-full@example.com",
            Role: AccountRole.Professional,
            PasswordVerifier: SomeBytes(32, 0x01),
            GoogleSubjectId: "google-subject-1",
            VerificationStatus: AccountVerificationStatus.Rejected,
            RejectionReason: "documento ilegível",
            VerificationSubmittedAt: new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.Zero),
            TotpSecret: "SOMESECRET",
            TotpEnabledAt: new DateTimeOffset(2026, 1, 3, 0, 0, 0, TimeSpan.Zero),
            TotpBackupCodeHashes: ["hash-a", "hash-b"],
            WebAuthnCredentialId: SomeBytes(16, 0x02),
            WebAuthnCosePublicKey: SomeBytes(20, 0x03),
            WebAuthnSignCount: 7,
            WebAuthnAaGuid: Guid.NewGuid(),
            RecoveryVerifier: SomeBytes(32, 0x04),
            VoiceEnrollment: new VoiceEnrollment(SomeBytes(28, 0x05), SomeBytes(28, 0x06)),
            RecoveryEnvelope: SomeBytes(120, 0x07));

        var store = new PostgresAccountStore(_dataSource, SomeTotpSecretCipher);
        await store.InsertAsync(account, CancellationToken.None);

        var found = await store.FindByEmailAsync(account.Email, CancellationToken.None);

        Assert.Equivalent(account, found);
    }

    [Fact]
    public async Task InsertThenFindById_ReturnsTheSameAccount()
    {
        var account = MinimalAccount("postgres-store-by-id@example.com");
        var store = new PostgresAccountStore(_dataSource, SomeTotpSecretCipher);
        await store.InsertAsync(account, CancellationToken.None);

        var found = await store.FindByIdAsync(account.Id, CancellationToken.None);

        Assert.Equivalent(account, found);
    }

    [Fact]
    public async Task FindByEmailAsync_WithUnknownEmail_ReturnsNull()
    {
        var store = new PostgresAccountStore(_dataSource, SomeTotpSecretCipher);

        var found = await store.FindByEmailAsync("nobody-in-postgres@example.com", CancellationToken.None);

        Assert.Null(found);
    }

    [Fact]
    public async Task FindByIdAsync_WithUnknownId_ReturnsNull()
    {
        var store = new PostgresAccountStore(_dataSource, SomeTotpSecretCipher);

        var found = await store.FindByIdAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Null(found);
    }

    [Fact]
    public async Task MutateAsync_PersistsChangedFields()
    {
        var account = MinimalAccount("postgres-store-update@example.com");
        var store = new PostgresAccountStore(_dataSource, SomeTotpSecretCipher);
        await store.InsertAsync(account, CancellationToken.None);

        var updated = account with
        {
            VerificationStatus = AccountVerificationStatus.Active, RejectionReason = null,
            RecoveryVerifier = SomeBytes(32, 0x04), RecoveryEnvelope = SomeBytes(120, 0x07),
        };
        await store.MutateAsync(updated.Id, _ => updated, CancellationToken.None);

        var found = await store.FindByIdAsync(account.Id, CancellationToken.None);
        Assert.Equal(AccountVerificationStatus.Active, found!.VerificationStatus);
        Assert.Equal(updated.RecoveryEnvelope, found.RecoveryEnvelope);
    }

    [Fact]
    public async Task MutateAsync_ConcurrentSettingsPreserveVoiceTwoFactorAndRecovery()
    {
        var account = MinimalAccount("pg-concurrent-settings@example.com");
        var store = new PostgresAccountStore(_dataSource, SomeTotpSecretCipher);
        await store.InsertAsync(account, CancellationToken.None);
        var voice = new VoiceEnrollment(SomeBytes(60, 0x05), SomeBytes(796, 0x06));
        var verifier = SomeBytes(32, 0x04);
        await Task.WhenAll(
            store.MutateAsync(account.Id, current => current with { VoiceEnrollment = voice }, CancellationToken.None),
            store.MutateAsync(account.Id, current => current with { TotpSecret = "SOMESECRET", TotpEnabledAt = DateTimeOffset.UtcNow, TotpBackupCodeHashes = ["hash-a"] }, CancellationToken.None),
            store.MutateAsync(account.Id, current => current with { RecoveryVerifier = verifier, RecoveryEnvelope = SomeBytes(120, 0x07) }, CancellationToken.None));
        var found = await store.FindByIdAsync(account.Id, CancellationToken.None);
        Assert.Equal(voice.WrappedDek, found!.VoiceEnrollment!.WrappedDek);
        Assert.Equal(voice.SealedEmbedding, found.VoiceEnrollment.SealedEmbedding);
        Assert.Equal("SOMESECRET", found.TotpSecret);
        Assert.Equal(["hash-a"], found.TotpBackupCodeHashes);
        Assert.Equal(verifier, found.RecoveryVerifier);
    }

    [Fact]
    public async Task MutateAsync_RejectsMissingRejectedAndChangedIdentityWithoutPersisting()
    {
        var store = new PostgresAccountStore(_dataSource, SomeTotpSecretCipher);
        Assert.Null(await store.MutateAsync(Guid.NewGuid(), _ => throw new InvalidOperationException(), CancellationToken.None));
        var account = MinimalAccount("pg-rejected-mutation@example.com");
        await store.InsertAsync(account, CancellationToken.None);
        Assert.Null(await store.MutateAsync(account.Id, _ => null, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => store.MutateAsync(account.Id,
            current => current with { Id = Guid.NewGuid(), VerificationStatus = AccountVerificationStatus.Active }, CancellationToken.None));
        Assert.Equivalent(account, await store.FindByIdAsync(account.Id, CancellationToken.None));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task VerifyBackupCode_ConcurrentRequestsConsumeEachCodeAtMostOnce(bool sameCode)
    {
        var account = MinimalAccount("pg-concurrent-backup@example.com") with
        {
            TotpSecret = "SOMESECRET", TotpEnabledAt = DateTimeOffset.UtcNow,
            TotpBackupCodeHashes = [BackupCodeGenerator.Hash("first"), BackupCodeGenerator.Hash("second")],
        };
        var store = new PostgresAccountStore(_dataSource, SomeTotpSecretCipher);
        await store.InsertAsync(account, CancellationToken.None);
        var handler = new VerifyTotpChallengeHandler(store, new TotpProvider(), new SessionTokenIssuer());
        var results = await Task.WhenAll(
            handler.Handle(new(account.Id, null, "first"), CancellationToken.None).AsTask(),
            handler.Handle(new(account.Id, null, sameCode ? "first" : "second"), CancellationToken.None).AsTask());
        Assert.Equal(sameCode ? 1 : 2, results.Count(result => result.Succeeded));
        var found = await store.FindByIdAsync(account.Id, CancellationToken.None);
        Assert.Equal(sameCode ? 1 : 0, found!.TotpBackupCodeHashes!.Count);
        Assert.All(results.Where(result => !result.Succeeded), result => Assert.Equal(VerifyTotpChallengeFailureReason.InvalidCode, result.FailureReason));
    }

    [Fact]
    public async Task ListPendingDocumentReviewAsync_ReturnsOnlyInReviewProfessionals_OrderedByOldestSubmissionFirst()
    {
        var store = new PostgresAccountStore(_dataSource, SomeTotpSecretCipher);
        var newer = MinimalAccount("pg-review-newer@example.com") with
        {
            VerificationStatus = AccountVerificationStatus.InReview,
            VerificationSubmittedAt = DateTimeOffset.UtcNow,
        };
        var older = MinimalAccount("pg-review-older@example.com") with
        {
            VerificationStatus = AccountVerificationStatus.InReview,
            VerificationSubmittedAt = DateTimeOffset.UtcNow.AddDays(-1),
        };
        var active = MinimalAccount("pg-review-active@example.com") with { VerificationStatus = AccountVerificationStatus.Active };
        var patient = MinimalAccount("pg-review-patient@example.com", AccountRole.Patient) with
        {
            VerificationStatus = AccountVerificationStatus.InReview,
            VerificationSubmittedAt = DateTimeOffset.UtcNow,
        };

        await store.InsertAsync(newer, CancellationToken.None);
        await store.InsertAsync(older, CancellationToken.None);
        await store.InsertAsync(active, CancellationToken.None);
        await store.InsertAsync(patient, CancellationToken.None);

        var queue = await store.ListPendingDocumentReviewAsync(CancellationToken.None);

        Assert.Equal([older.Id, newer.Id], queue.Select(a => a.Id));
    }

    private static Account MinimalAccount(string email, AccountRole role = AccountRole.Professional) =>
        new(Guid.NewGuid(), role == AccountRole.Patient ? null : email, role, PasswordVerifier: role == AccountRole.Patient ? null : SomeBytes(32, 0x09), GoogleSubjectId: null);

    [Fact]
    public async Task ConcurrentPendingTotpInitialization_ReturnsTheSameSecretAndPreservesOtherFields()
    {
        var account = MinimalAccount("pg-totp-race@example.com") with
        {
            RecoveryVerifier = SomeBytes(32, 0x04),
            RecoveryEnvelope = SomeBytes(120, 0x07),
            VerificationStatus = AccountVerificationStatus.InReview,
        };
        var store = new PostgresAccountStore(_dataSource, SomeTotpSecretCipher);
        await store.InsertAsync(account, CancellationToken.None);
        var secrets = await Task.WhenAll(
            store.GetOrCreatePendingTotpSecretAsync(account.Id, "FIRSTSECRET", CancellationToken.None),
            store.GetOrCreatePendingTotpSecretAsync(account.Id, "SECONDSECRET", CancellationToken.None));
        Assert.NotNull(secrets[0]);
        Assert.Equal(secrets[0], secrets[1]);
        var restored = await new PostgresAccountStore(_dataSource, SomeTotpSecretCipher).FindByIdAsync(account.Id, CancellationToken.None);
        Assert.Equal(secrets[0], restored!.TotpSecret);
        Assert.Equal(account.RecoveryEnvelope, restored.RecoveryEnvelope);
        Assert.Equal(account.VerificationStatus, restored.VerificationStatus);
        var repeated = await store.GetOrCreatePendingTotpSecretAsync(account.Id, "THIRDSECRET", CancellationToken.None);
        Assert.Equal(secrets[0], repeated);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("patient")]
    [InlineData("enabled")]
    public async Task PendingTotpInitialization_RefusesIneligibleAccount(string condition)
    {
        var store = new PostgresAccountStore(_dataSource, SomeTotpSecretCipher);
        var account = MinimalAccount("pg-totp-ineligible@example.com", condition == "patient" ? AccountRole.Patient : AccountRole.Professional);
        if (condition == "enabled") account = account with { TotpSecret = "ORIGINALSECRET", TotpEnabledAt = DateTimeOffset.UtcNow };
        if (condition != "missing") await store.InsertAsync(account, CancellationToken.None);
        Assert.Null(await store.GetOrCreatePendingTotpSecretAsync(account.Id, "NEWSECRET", CancellationToken.None));
        if (condition == "enabled") Assert.Equal("ORIGINALSECRET", (await store.FindByIdAsync(account.Id, CancellationToken.None))!.TotpSecret);
    }

    private static byte[] SomeBytes(int length, byte fill)
    {
        var bytes = new byte[length];
        Array.Fill(bytes, fill);
        return bytes;
    }
}
