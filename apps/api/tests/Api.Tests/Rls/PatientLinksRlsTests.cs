using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Rls;

/// <summary>
/// Proves the RLS policies on <c>patient_link_invites</c>, <c>patient_links</c>,
/// <c>shared_items</c>, <c>sharing_preferences</c> and the extra <c>key_pair_ever_linked_read</c>
/// policy on <c>account_key_pairs</c> (S11-03, fatia 7, migration
/// 0012_create_patient_links_and_sharing.sql) against a real Postgres instance: every query
/// connects as app_role, never postgres/superuser -- same discipline as AccountsRlsTests.
/// </summary>
[Collection("Database")]
public sealed class PatientLinksRlsTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public PatientLinksRlsTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static readonly Guid ProfessionalAccountId = Guid.NewGuid();
    private static readonly Guid PatientAccountId = Guid.NewGuid();
    private static readonly Guid ThirdAccountId = Guid.NewGuid();
    private static readonly Guid PatientId = Guid.NewGuid();
    private const string InviteCode = "ABCDEFGH1234";
    private const string WrongInviteCode = "999999999999";

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

        // Seed directly via the admin (superuser) connection, bypassing RLS entirely -- same
        // technique as AccountsRlsTests.
        await using var seedCommand = adminConnection.CreateCommand();
        seedCommand.CommandText = """
            INSERT INTO accounts (id, email, role, verification_status) VALUES
                (@professionalId, @professionalEmail, 'Professional', 'Active'),
                (@patientId, @patientEmail, 'Patient', 'Active'),
                (@thirdId, @thirdEmail, 'Patient', 'Active');

            INSERT INTO account_key_pairs (account_id, public_key, wrapped_dek, sealed_private_key) VALUES
                (@professionalId, @publicKey, @wrappedDek, @sealedPrivateKey);

            INSERT INTO patient_link_invites (code, professional_account_id, patient_id, expires_at) VALUES
                (@inviteCode, @professionalId, @patientRecordId, now() + interval '7 days');

            INSERT INTO patient_links (professional_account_id, patient_account_id, patient_id, linked_at) VALUES
                (@professionalId, @patientId, @patientRecordId, now());

            INSERT INTO shared_items (patient_account_id, professional_account_id, shared_at, ciphertext) VALUES
                (@patientId, @professionalId, now(), @ciphertext);

            INSERT INTO sharing_preferences (account_id, version, wrapped_dek, ciphertext) VALUES
                (@patientId, 1, @wrappedDek, @ciphertext);
            """;
        seedCommand.Parameters.AddWithValue("professionalId", ProfessionalAccountId);
        seedCommand.Parameters.AddWithValue("professionalEmail", "rls-links-professional@example.com");
        seedCommand.Parameters.AddWithValue("patientId", PatientAccountId);
        seedCommand.Parameters.AddWithValue("patientEmail", "rls-links-patient@example.com");
        seedCommand.Parameters.AddWithValue("thirdId", ThirdAccountId);
        seedCommand.Parameters.AddWithValue("thirdEmail", "rls-links-third@example.com");
        seedCommand.Parameters.AddWithValue("publicKey", SomeBlob(0xA1, 32));
        seedCommand.Parameters.AddWithValue("wrappedDek", SomeBlob(0xB1, 28));
        seedCommand.Parameters.AddWithValue("sealedPrivateKey", SomeBlob(0xC1, 28));
        seedCommand.Parameters.AddWithValue("inviteCode", InviteCode);
        seedCommand.Parameters.AddWithValue("patientRecordId", PatientId);
        seedCommand.Parameters.AddWithValue("ciphertext", SomeBlob(0xD1, 28));
        await seedCommand.ExecuteNonQueryAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task WithoutAnyLookupKey_SeesNoRowsInAnyTable()
    {
        await using var connection = await OpenAppRoleConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        Assert.Equal(0, await CountAsync(connection, transaction, "patient_link_invites"));
        Assert.Equal(0, await CountAsync(connection, transaction, "patient_links"));
        Assert.Equal(0, await CountAsync(connection, transaction, "shared_items"));
        Assert.Equal(0, await CountAsync(connection, transaction, "sharing_preferences"));

        await transaction.CommitAsync();
    }

    [Fact]
    public async Task ThirdAccount_SeesNoRowsInAnyTable()
    {
        await using var connection = await OpenAppRoleConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await SetConfigAsync(connection, transaction, "app.tenant_id", ThirdAccountId.ToString());

        Assert.Equal(0, await CountAsync(connection, transaction, "patient_link_invites"));
        Assert.Equal(0, await CountAsync(connection, transaction, "patient_links"));
        Assert.Equal(0, await CountAsync(connection, transaction, "shared_items"));
        Assert.Equal(0, await CountAsync(connection, transaction, "sharing_preferences"));

        await transaction.CommitAsync();
    }

    [Fact]
    public async Task PatientWithWrongCode_SeesNoInvites()
    {
        await using var connection = await OpenAppRoleConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await SetConfigAsync(connection, transaction, "app.invite_code", WrongInviteCode);

        Assert.Equal(0, await CountAsync(connection, transaction, "patient_link_invites"));

        await transaction.CommitAsync();
    }

    [Fact]
    public async Task PatientWithExactCode_SeesOnlyThatInvite()
    {
        await using var connection = await OpenAppRoleConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await SetConfigAsync(connection, transaction, "app.invite_code", InviteCode);

        Assert.Equal(1, await CountAsync(connection, transaction, "patient_link_invites"));

        await transaction.CommitAsync();
    }

    [Fact]
    public async Task PeerPublicKey_VisibleOnlyToEverLinkedAccount()
    {
        await using var linkedConnection = await OpenAppRoleConnectionAsync();
        await using (var linkedTransaction = await linkedConnection.BeginTransactionAsync())
        {
            await SetConfigAsync(linkedConnection, linkedTransaction, "app.tenant_id", PatientAccountId.ToString());
            Assert.Equal(1, await CountKeyPairsAsync(linkedConnection, linkedTransaction, ProfessionalAccountId));
            await linkedTransaction.CommitAsync();
        }

        await using var thirdConnection = await OpenAppRoleConnectionAsync();
        await using var thirdTransaction = await thirdConnection.BeginTransactionAsync();
        await SetConfigAsync(thirdConnection, thirdTransaction, "app.tenant_id", ThirdAccountId.ToString());
        Assert.Equal(0, await CountKeyPairsAsync(thirdConnection, thirdTransaction, ProfessionalAccountId));
        await thirdTransaction.CommitAsync();
    }

    private async Task<NpgsqlConnection> OpenAppRoleConnectionAsync()
    {
        var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    private static async Task<long> CountAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string table)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"SELECT count(*) FROM {table}";
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private static async Task<long> CountKeyPairsAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, Guid accountId)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT count(*) FROM account_key_pairs WHERE account_id = @accountId";
        command.Parameters.AddWithValue("accountId", accountId);
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private static async Task SetConfigAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string setting, string value)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT set_config(@setting, @value, true)";
        command.Parameters.AddWithValue("setting", setting);
        command.Parameters.AddWithValue("value", value);
        await command.ExecuteNonQueryAsync();
    }

    private static byte[] SomeBlob(byte fill, int length)
    {
        var blob = new byte[length];
        Array.Fill(blob, fill);
        return blob;
    }
}
