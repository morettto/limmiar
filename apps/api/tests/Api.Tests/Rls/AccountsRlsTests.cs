using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Rls;

/// <summary>
/// Proves the account_lookup_by_key RLS policy on accounts (S11-03, fatia 6,
/// migration 0010_create_accounts.sql) against a real Postgres instance: every query connects
/// as app_role, never postgres/superuser, same discipline as HealthCheckProbeRlsTests.
/// </summary>
[Collection("Database")]
public sealed class AccountsRlsTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public AccountsRlsTests(PostgresContainerFixture fixture)
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

        // Seed directly via the admin (superuser) connection, bypassing RLS entirely, so the
        // test data setup itself does not depend on the policy under test.
        await using var seedCommand = adminConnection.CreateCommand();
        seedCommand.CommandText = """
            INSERT INTO accounts (id, email, role, verification_status) VALUES
                (@activeId, @activeEmail, 'Professional', 'Active'),
                (@inReviewId, @inReviewEmail, 'Professional', 'InReview'),
                (@patientInReviewId, @patientInReviewEmail, 'Patient', 'InReview');
            """;
        seedCommand.Parameters.AddWithValue("activeId", ActiveAccountId);
        seedCommand.Parameters.AddWithValue("activeEmail", ActiveAccountEmail);
        seedCommand.Parameters.AddWithValue("inReviewId", InReviewAccountId);
        seedCommand.Parameters.AddWithValue("inReviewEmail", InReviewAccountEmail);
        seedCommand.Parameters.AddWithValue("patientInReviewId", PatientInReviewAccountId);
        seedCommand.Parameters.AddWithValue("patientInReviewEmail", PatientInReviewAccountEmail);
        await seedCommand.ExecuteNonQueryAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static readonly Guid ActiveAccountId = Guid.NewGuid();
    private const string ActiveAccountEmail = "rls-active@example.com";
    private static readonly Guid InReviewAccountId = Guid.NewGuid();
    private const string InReviewAccountEmail = "rls-in-review@example.com";
    private static readonly Guid PatientInReviewAccountId = Guid.NewGuid();
    private const string PatientInReviewAccountEmail = "rls-patient-in-review@example.com";

    [Fact]
    public async Task WithoutLookupKey_SeesNoAccounts()
    {
        var emails = await SelectEmailsAsync(setTenantId: null, setAccountEmail: null, setStaffReview: false);

        Assert.Empty(emails);
    }

    [Fact]
    public async Task WithMatchingIdContext_SeesOwnAccountOnly()
    {
        var emails = await SelectEmailsAsync(ActiveAccountId, setAccountEmail: null, setStaffReview: false);

        var email = Assert.Single(emails);
        Assert.Equal(ActiveAccountEmail, email);
    }

    [Fact]
    public async Task WithMatchingEmailContext_SeesAccountByEmailOnly()
    {
        var emails = await SelectEmailsAsync(setTenantId: null, InReviewAccountEmail, setStaffReview: false);

        var email = Assert.Single(emails);
        Assert.Equal(InReviewAccountEmail, email);
    }

    [Fact]
    public async Task StaffReview_SeesOnlyInReviewProfessionals()
    {
        var emails = await SelectEmailsAsync(setTenantId: null, setAccountEmail: null, setStaffReview: true);

        // Assert.Single (not just Contains) so a policy bug that also exposes the active
        // professional or the in-review patient would fail this test too.
        var email = Assert.Single(emails);
        Assert.Equal(InReviewAccountEmail, email);
    }

    /// <summary>
    /// Ronda 1 de review, achado importante: a 0010 concedia SELECT sobre a tabela accounts
    /// inteira a app_role, e o REVOKE UPDATE (totp_secret) da 0011 e por coluna -- no Postgres
    /// isso nunca anula um GRANT SELECT de tabela inteira, entao a leitura em claro continuava
    /// aberta. A coluna esta congelada (ninguem mais le/escreve totp_secret, ver 0011), por isso
    /// nao ha WHERE que faca a policy de RLS entrar em jogo aqui -- so a permissao de coluna.
    /// </summary>
    [Fact]
    public async Task SelectingTotpSecretColumn_IsDeniedByColumnPrivilege()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT totp_secret FROM accounts";

        var ex = await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteReaderAsync());
        Assert.Equal(PostgresErrorCodes.UndefinedColumn, ex.SqlState);
    }

    /// <summary>
    /// Connects as app_role and, when a lookup key is provided, sets the matching GUC
    /// transactionally via <c>set_config(..., is_local: true)</c> -- exactly the pattern
    /// PostgresAccountStore relies on for each of IAccountStore's three lookup shapes.
    /// </summary>
    private async Task<List<string>> SelectEmailsAsync(Guid? setTenantId, string? setAccountEmail, bool setStaffReview)
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();

        await using var transaction = await connection.BeginTransactionAsync();

        if (setTenantId is not null)
        {
            await SetConfigAsync(connection, transaction, "app.tenant_id", setTenantId.Value.ToString());
        }

        if (setAccountEmail is not null)
        {
            await SetConfigAsync(connection, transaction, "app.account_email", setAccountEmail);
        }

        if (setStaffReview)
        {
            await SetConfigAsync(connection, transaction, "app.staff_review", "on");
        }

        await using var selectCommand = connection.CreateCommand();
        selectCommand.Transaction = transaction;
        selectCommand.CommandText = "SELECT email FROM accounts ORDER BY email";

        var results = new List<string>();
        await using (var reader = await selectCommand.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                results.Add(reader.GetString(0));
            }
        }

        await transaction.CommitAsync();
        return results;
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
}
