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
            VoiceEnrollment: new VoiceEnrollment(SomeBytes(28, 0x05), SomeBytes(28, 0x06)));

        var store = new PostgresAccountStore(_dataSource);
        await store.InsertAsync(account, CancellationToken.None);

        var found = await store.FindByEmailAsync(account.Email, CancellationToken.None);

        Assert.Equivalent(account, found);
    }

    [Fact]
    public async Task InsertThenFindById_ReturnsTheSameAccount()
    {
        var account = MinimalAccount("postgres-store-by-id@example.com");
        var store = new PostgresAccountStore(_dataSource);
        await store.InsertAsync(account, CancellationToken.None);

        var found = await store.FindByIdAsync(account.Id, CancellationToken.None);

        Assert.Equivalent(account, found);
    }

    [Fact]
    public async Task FindByEmailAsync_WithUnknownEmail_ReturnsNull()
    {
        var store = new PostgresAccountStore(_dataSource);

        var found = await store.FindByEmailAsync("nobody-in-postgres@example.com", CancellationToken.None);

        Assert.Null(found);
    }

    [Fact]
    public async Task FindByIdAsync_WithUnknownId_ReturnsNull()
    {
        var store = new PostgresAccountStore(_dataSource);

        var found = await store.FindByIdAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Null(found);
    }

    [Fact]
    public async Task UpdateAsync_PersistsChangedFields()
    {
        var account = MinimalAccount("postgres-store-update@example.com");
        var store = new PostgresAccountStore(_dataSource);
        await store.InsertAsync(account, CancellationToken.None);

        var updated = account with { VerificationStatus = AccountVerificationStatus.Active, RejectionReason = null };
        await store.UpdateAsync(updated, CancellationToken.None);

        var found = await store.FindByIdAsync(account.Id, CancellationToken.None);
        Assert.Equal(AccountVerificationStatus.Active, found!.VerificationStatus);
    }

    [Fact]
    public async Task ListPendingDocumentReviewAsync_ReturnsOnlyInReviewProfessionals_OrderedByOldestSubmissionFirst()
    {
        var store = new PostgresAccountStore(_dataSource);
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
        new(Guid.NewGuid(), email, role, PasswordVerifier: SomeBytes(32, 0x09), GoogleSubjectId: null);

    private static byte[] SomeBytes(int length, byte fill)
    {
        var bytes = new byte[length];
        Array.Fill(bytes, fill);
        return bytes;
    }
}
