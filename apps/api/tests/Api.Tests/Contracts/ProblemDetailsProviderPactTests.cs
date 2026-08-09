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

/// <summary>
/// Provider-side verification that the real API honours the consumer-driven contract
/// recorded by apps/app's Pact consumer test
/// (pacts/limmiar-app-limmiar-api.json, generated separately by the consumer side --
/// never edited or regenerated here).
/// </summary>
/// <remarks>
/// PactNet's verifier core is a native/FFI process that issues real HTTP requests over a
/// real socket. It cannot drive <see cref="Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory{TEntryPoint}"/>'s
/// in-memory TestServer the way every other test in this project does -- there is no
/// socket for it to connect to. This test instead builds the exact same WebApplication
/// composition Program.cs's own top-level statements use (via <see cref="Program.BuildApp"/>),
/// binds it to an OS-assigned loopback port with Kestrel, and tears it down afterwards.
///
/// The contract's single interaction ("the database is unreachable") needs no dynamic
/// provider-state HTTP callback: its state is entirely determined by the connection
/// string baked into the <see cref="WebApplicationBuilder"/> before the app starts (the
/// same port-1-refuses-connections-instantly trick
/// <c>Health/HealthDbEndpointTests.cs</c> uses), so no <c>WithProviderStateUrl(...)</c>
/// is configured -- PactNet logs a harmless "no state change URL provided" warning and
/// verifies the request/response as-is.
/// </remarks>
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

        // Port 0 == let the OS pick a free ephemeral loopback port; the actual bound
        // address is read back below once the server has started.
        builder.WebHost.UseUrls("http://127.0.0.1:0");

        // Port 1 refuses connections instantly on loopback -- deterministic, no container
        // or network flakiness involved. Bakes in the contract's only provider state
        // ("the database is unreachable") before the app is even built.
        builder.Configuration["ConnectionStrings:AppDb"] =
            "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;Timeout=2;";

        // App startup also needs StaffAccess:ApiKey/WebAuthn:RelyingPartyId/
        // WebAuthn:ExpectedOrigin configured (same "fail fast if missing" pattern as
        // ConnectionStrings:AppDb) even though this contract test never hits a staff-gated
        // or WebAuthn endpoint.
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
        // AppContext.BaseDirectory at test run time is the build OUTPUT directory
        // (bin/Release/net10.0/...), not the source tree -- walk up from there rather
        // than assuming the source-tree relative depth (apps/api/tests/Api.Tests/../../..)
        // carries over to the build output.
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
