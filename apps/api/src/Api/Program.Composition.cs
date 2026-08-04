using Api.Accounts;
using Api.Data;
using Api.Endpoints;
using Api.ExceptionHandling;
using Api.Serialization;

/// <summary>
/// Extends the compiler-generated top-level-statements <c>Program</c> class (the Web SDK
/// implicitly emits it as <c>public partial class Program</c> precisely so it can be
/// referenced from outside this assembly -- see
/// https://github.com/dotnet/sdk/issues/30274) with the composition logic shared between
/// normal serving (Program.cs's own top-level statements) and any test host that needs a
/// real, running instance of this exact API rather than an in-memory
/// <c>WebApplicationFactory</c> TestServer -- specifically the Pact provider-verification
/// test in Api.Tests/Contracts, which drives the app over real HTTP.
/// </summary>
public partial class Program
{
    /// <summary>
    /// Builds the WebApplication the same way the non-migration branch of Program.cs's
    /// top-level statements always has: JSON options wired to the source-generated
    /// <see cref="ApiJsonSerializerContext"/>, the Npgsql data source, the global problem
    /// details exception handler, and the health endpoints. Does not call
    /// <see cref="WebApplication.Run"/> or <see cref="WebApplication.RunAsync"/> --
    /// callers own the app's lifetime (<c>app.Run()</c> for the real process,
    /// <c>await app.StartAsync()</c> / <c>StopAsync()</c> for a test that needs a real
    /// Kestrel listener on an ephemeral port).
    /// </summary>
    public static WebApplication BuildApp(WebApplicationBuilder builder)
    {
        builder.Services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, ApiJsonSerializerContext.Default);
        });

        builder.Services.AddOpenApi();

        var appConnectionString = builder.Configuration.GetConnectionString("AppDb")
            ?? throw new InvalidOperationException("Missing required configuration: ConnectionStrings:AppDb");

        builder.Services.AddSingleton(NpgsqlDataSourceFactory.Create(appConnectionString));

        builder.Services.AddExceptionHandler<GlobalProblemExceptionHandler>();

        // TODO(follow-up ticket, not S02-01's confirmed backend seams): IAccountStore's
        // in-memory placeholder does not persist across restarts or instances -- see its
        // own TODO. IGoogleIdentityProvider's placeholder throws NotSupportedException;
        // real Google ID token verification is a separate follow-up (see its own TODO).
        builder.Services.AddSingleton<IAccountStore, InMemoryAccountStore>();
        builder.Services.AddSingleton<IPasswordVerifierComparer, ConstantTimePasswordVerifierComparer>();
        builder.Services.AddSingleton<IGoogleIdentityProvider, GoogleIdentityProvider>();
        builder.Services.AddSingleton<AccountService>();

        var app = builder.Build();

        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
        }

        app.UseExceptionHandler(_ => { });

        app.MapHealthEndpoints();
        app.MapAuthEndpoints();

        return app;
    }
}
