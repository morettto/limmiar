using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using PactNet;
using PactNet.Output.Xunit;
using PactNet.Verifier;
using Xunit.Abstractions;

namespace Api.Tests.Contracts;

/// <summary>Provider-side verification of the consumer-driven Pact recorded by apps/app (pacts/limmiar-app-limmiar-api.json, never edited or regenerated here). PactNet's verifier issues real HTTP requests over a real socket, so it can't drive WebApplicationFactory's in-memory TestServer -- this builds the real WebApplication via Program.BuildApp, binds it to a real Kestrel port, and tears it down afterwards.</summary>
public sealed class ProblemDetailsProviderPactTests
{
    private readonly ITestOutputHelper _output;

    public ProblemDetailsProviderPactTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public async Task ApiHonoursPactWithLimmiarApp()
    {
        var builder = WebApplication.CreateSlimBuilder();

        // Port 0 == let the OS pick a free ephemeral loopback port; the bound address is read back below.
        builder.WebHost.UseUrls("http://127.0.0.1:0");

        // Port 1 refuses connections instantly on loopback -- deterministic, and bakes in the
        // contract's only provider state ("the database is unreachable") before the app is built.
        builder.Configuration["ConnectionStrings:AppDb"] =
            "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;Timeout=2;";

        // App startup needs these configured too (same fail-fast pattern as ConnectionStrings:AppDb),
        // even though this contract test never hits a staff-gated or WebAuthn endpoint.
        builder.Configuration["StaffAccess:ApiKey"] = "test-staff-api-key";
        builder.Configuration["WebAuthn:RelyingPartyId"] = "limmiar.test";
        builder.Configuration["WebAuthn:ExpectedOrigin"] = "https://limmiar.test";

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

            var pactPath = ResolvePactFilePath();

            using var verifier = new PactVerifier("limmiar-api", config);
            verifier
                .WithHttpEndpoint(new Uri(address))
                .WithFileSource(new FileInfo(pactPath))
                .Verify();
        }
        finally
        {
            await app.StopAsync();
        }
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
