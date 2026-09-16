using System.Text.Json;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using PactNet;
using PactNet.Output.Xunit;
using PactNet.Verifier;
using Respawn;
using Npgsql;
using Xunit.Abstractions;

namespace Api.Tests.Contracts;

/// <summary>
/// Provider-side verification of the consumer-driven Pact recorded by apps/app
/// (pacts/limmiar-app-limmiar-api.json, never edited or regenerated here). PactNet's verifier
/// issues real HTTP requests over a real socket, so it can't drive WebApplicationFactory's
/// in-memory TestServer -- this builds the real WebApplication via Program.BuildApp, binds it to
/// a real Kestrel port, and tears it down afterwards.
///
/// Since S11-03 moved accounts into Postgres, one fixed ConnectionStrings:AppDb can no longer
/// satisfy every interaction in the pact: "the database is unreachable" (the /health/db
/// interaction) needs Postgres unreachable, while the login/register interactions need a real,
/// reachable, migrated Postgres to actually create/find an account. So this runs the pact
/// verifier twice, filtered by provider state (PactVerifierSource.WithFilter) -- once against an
/// app wired to the real Testcontainers Postgres for every state except "the database is
/// unreachable", and once against an app wired to a connection that refuses instantly (Port=1)
/// for that one state alone. The pact file's own states drive the split, not a hardcoded list, so
/// a future non-DB state added to the contract is covered by the reachable phase automatically.
/// </summary>
[Collection("Database")]
public sealed class ProblemDetailsProviderPactTests : IAsyncLifetime
{
    private const string DatabaseUnreachableProviderState = "the database is unreachable";

    private readonly ITestOutputHelper _output;
    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public ProblemDetailsProviderPactTests(ITestOutputHelper output, PostgresContainerFixture fixture)
    {
        _output = output;
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
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task ApiHonoursPactWithLimmiarApp()
    {
        var pactPath = ResolvePactFilePath();
        var providerStates = ReadDistinctProviderStates(pactPath);
        var unreachableStates = providerStates.Where(state => state == DatabaseUnreachableProviderState).ToList();
        var reachableStates = providerStates.Except(unreachableStates).ToList();

        if (reachableStates.Count > 0)
        {
            await VerifyStatesAsync(_fixture.AppRoleConnectionString, reachableStates, pactPath);
        }

        if (unreachableStates.Count > 0)
        {
            // Port 1 refuses connections instantly on loopback -- deterministic, and bakes in
            // the contract's provider state for this one interaction alone.
            await VerifyStatesAsync("Host=127.0.0.1;Port=1;Username=app_role;Password=unused;Timeout=2;", unreachableStates, pactPath);
        }
    }

    private async Task VerifyStatesAsync(string appConnectionString, IReadOnlyList<string> providerStates, string pactPath)
    {
        var builder = WebApplication.CreateSlimBuilder();

        // Port 0 == let the OS pick a free ephemeral loopback port; the bound address is read back below.
        builder.WebHost.UseUrls("http://127.0.0.1:0");

        builder.Configuration["ConnectionStrings:AppDb"] = appConnectionString;

        // App startup needs these configured too (same fail-fast pattern as ConnectionStrings:AppDb),
        // even though this contract test never hits a staff-gated or WebAuthn endpoint.
        builder.Configuration["StaffAccess:ApiKey"] = "test-staff-api-key";
        builder.Configuration["WebAuthn:RelyingPartyId"] = "limmiar.test";
        builder.Configuration["WebAuthn:ExpectedOrigin"] = "https://limmiar.test";
        builder.Configuration["AbacatePay:WebhookSecret"] = "whsec_test123";
        builder.Configuration["Totp:EncryptionKey"] = TotpTestEncryptionKey.Base64;

        await using var app = Program.BuildApp(builder);

        await app.StartAsync();
        try
        {
            var addressesFeature = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()
                ?? throw new InvalidOperationException("Kestrel did not report a bound server address.");
            var address = addressesFeature.Addresses.First();

            var config = new PactVerifierConfig
            {
                Outputters = [new XunitOutput(_output)],
            };

            foreach (var providerState in providerStates)
            {
                using var verifier = new PactVerifier("limmiar-api", config);
                verifier
                    .WithHttpEndpoint(new Uri(address))
                    .WithFileSource(new FileInfo(pactPath))
                    .WithFilter(null, providerState)
                    .Verify();
            }
        }
        finally
        {
            await app.StopAsync();
        }
    }

    private static IReadOnlyList<string> ReadDistinctProviderStates(string pactPath)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(pactPath));
        var states = new List<string>();

        foreach (var interaction in document.RootElement.GetProperty("interactions").EnumerateArray())
        {
            if (!interaction.TryGetProperty("providerStates", out var providerStates))
            {
                continue;
            }

            foreach (var providerState in providerStates.EnumerateArray())
            {
                var name = providerState.GetProperty("name").GetString()!;
                if (!states.Contains(name))
                {
                    states.Add(name);
                }
            }
        }

        return states;
    }

    private static string ResolvePactFilePath()
    {
        // AppContext.BaseDirectory at test run time is the build output directory, not the
        // source tree -- walk up from there rather than assume a fixed relative depth.
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "pacts", "limmiar-app-limmiar-api.json");
            if (File.Exists(candidate))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        throw new FileNotFoundException(
            "Could not locate pacts/limmiar-app-limmiar-api.json by walking up from AppContext.BaseDirectory.");
    }
}
