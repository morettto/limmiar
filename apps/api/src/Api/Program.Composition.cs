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

        // S02-04 slice 7 (E2E): the frontend and this API run on different origins/ports in
        // both the real deployment (SPA on Cloudflare Workers, API elsewhere) and this repo's
        // E2E (wrangler dev vs. dotnet run on different ports), so *some* CORS policy is
        // required for the SPA to call this API at all. AllowAnyOrigin was considered and
        // rejected even though every account-scoped endpoint is bearer-token-gated (not
        // cookie-based) -- unrestricted CORS is still a wider attack surface than this app
        // (health data, E2E-encrypted) should ship unconditionally to every environment for
        // one test's convenience. Instead: an explicit, config-driven allow-list, empty (no
        // cross-origin access at all) unless configured. Production sets this to its real SPA
        // origin(s); the E2E webServer below sets it to wrangler's dev origin only.
        var corsAllowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
        builder.Services.AddCors(options =>
        {
            options.AddDefaultPolicy(policy =>
            {
                if (corsAllowedOrigins.Length > 0)
                {
                    policy.WithOrigins(corsAllowedOrigins).AllowAnyHeader().AllowAnyMethod();
                }
            });
        });

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
        // TODO(follow-up ticket, not S02-02's confirmed backend seams): CouncilRegistryVerifier's
        // placeholder throws NotSupportedException -- real CRP/CRM verification is blocked
        // on a contracted provider (see its own TODO).
        builder.Services.AddSingleton<ICouncilRegistryVerifier, CouncilRegistryVerifier>();
        builder.Services.AddSingleton<ITotpProvider, TotpProvider>();
        builder.Services.AddSingleton<ITwoFactorTicketIssuer, TwoFactorTicketIssuer>();
        // TODO(follow-up ticket, not S02-04's confirmed backend seams): in-memory
        // placeholder, same fidelity/limitation as the singletons around it.
        // DevicePairing:SessionLifetimeSeconds (S02-04 slice 7, E2E only): lets the E2E
        // environment override DevicePairingIssuer's session TTL to something short, so its
        // "expired QR" test can run for real instead of waiting out the production two-minute
        // window. Unset in every other environment, which leaves DevicePairingIssuer's own
        // PairingSessionLifetime default untouched -- see that class's constructor doc comment.
        builder.Services.AddSingleton<IDevicePairingIssuer>(sp =>
        {
            var overrideSeconds = sp.GetRequiredService<IConfiguration>()
                .GetValue<double?>("DevicePairing:SessionLifetimeSeconds");
            return overrideSeconds is { } seconds
                ? new DevicePairingIssuer(sessionLifetime: TimeSpan.FromSeconds(seconds))
                : new DevicePairingIssuer();
        });
        // TODO(follow-up ticket, not S02-08's confirmed backend seams): in-memory
        // placeholder, same fidelity/limitation as the other singletons above -- does not
        // survive a restart or work across multiple instances. Real Postgres-backed
        // sessions are a separate follow-up.
        builder.Services.AddSingleton<ISessionTokenIssuer, SessionTokenIssuer>();
        // S02-05: stateless and thread-safe (it holds no keys and no ceremony state), so a
        // singleton is the right lifetime. Registered even though no endpoint consumes it yet
        // -- an unreferenced implementation would be trimmed straight out of the Native AOT
        // publish, and the api-aot-publish gate would then be proving nothing about it.
        builder.Services.AddSingleton<IWebAuthnCeremonyVerifier, WebAuthnCeremonyVerifier>();
        // TODO(follow-up ticket, not S02-05's confirmed backend seams): in-memory
        // placeholder, same fidelity/limitation as the other singletons above.
        // MagicLink:TokenLifetimeSeconds (S02-05, E2E only): same precedent as
        // DevicePairing:SessionLifetimeSeconds above -- lets the E2E environment override
        // MagicLinkIssuer's token TTL to something short so its "expired link" test can run
        // for real instead of waiting out the production fifteen-minute window. Unset in
        // every other environment, which leaves MagicLinkIssuer's own DefaultTokenLifetime
        // default untouched.
        builder.Services.AddSingleton<IMagicLinkIssuer>(sp =>
        {
            var overrideSeconds = sp.GetRequiredService<IConfiguration>()
                .GetValue<double?>("MagicLink:TokenLifetimeSeconds");
            return overrideSeconds is { } seconds
                ? new MagicLinkIssuer(tokenLifetime: TimeSpan.FromSeconds(seconds))
                : new MagicLinkIssuer();
        });
        // MagicLink:TestCaptureEndpoint (S02-05, E2E only): same precedent as
        // DevicePairing:SessionLifetimeSeconds/MagicLink:TokenLifetimeSeconds above -- there is
        // no real e-mail infrastructure (MagicLinkEmailSender's placeholder throws
        // NotSupportedException; real delivery is a separate follow-up, see its own TODO), so
        // Playwright's E2E has no inbox to read a "sent" magic link from. When this flag is
        // true, IMagicLinkEmailSender is swapped for CapturingMagicLinkEmailSender (records the
        // last token per e-mail instead of sending anything) and a debug-only GET route is
        // mapped below to read it back. Unset (false) in every other environment, which keeps
        // the real, NotSupportedException-throwing placeholder wired in -- exactly the same
        // "fails loudly if actually reached" behavior as before this flag existed.
        var magicLinkTestCaptureEndpoint = builder.Configuration.GetValue<bool>("MagicLink:TestCaptureEndpoint");
        if (magicLinkTestCaptureEndpoint)
        {
            builder.Services.AddSingleton<CapturingMagicLinkEmailSender>();
            builder.Services.AddSingleton<IMagicLinkEmailSender>(sp => sp.GetRequiredService<CapturingMagicLinkEmailSender>());
        }
        else
        {
            builder.Services.AddSingleton<IMagicLinkEmailSender, MagicLinkEmailSender>();
        }

        // S02-07: unlike IMagicLinkEmailSender above, there is no E2E test type on this
        // ticket needing a capturing double wired into production DI -- integration tests
        // override this registration directly (ConfigureTestServices), same as every other
        // fake in this codebase that isn't also needed by a live `dotnet run` E2E process. So
        // the real, NotSupportedException-throwing placeholder is wired in unconditionally.
        builder.Services.AddSingleton<INewDeviceAlertSender, NewDeviceAlertSender>();

        // S02-05: the relying party id / origin every WebAuthn ceremony (magic-link
        // registration and assertion alike) is verified against. Same "fail fast if
        // unconfigured" pattern as staffApiKey below -- an AccountService silently falling
        // back to a placeholder RP id/origin in production would make every ceremony verify
        // against the wrong values and either reject all logins or, worse, accept ceremonies
        // that were never meant for this deployment.
        var webAuthnRelyingPartyId = builder.Configuration["WebAuthn:RelyingPartyId"];
        if (string.IsNullOrEmpty(webAuthnRelyingPartyId))
        {
            throw new InvalidOperationException("Missing required configuration: WebAuthn:RelyingPartyId");
        }

        var webAuthnExpectedOrigin = builder.Configuration["WebAuthn:ExpectedOrigin"];
        if (string.IsNullOrEmpty(webAuthnExpectedOrigin))
        {
            throw new InvalidOperationException("Missing required configuration: WebAuthn:ExpectedOrigin");
        }

        // Factory registration (not the plain AddSingleton<AccountService>() this used to
        // be): AccountService's constructor now also takes webAuthnRelyingPartyId/
        // webAuthnExpectedOrigin as plain strings, which the built-in DI container has no
        // way to resolve on its own -- every other dependency is still pulled straight from
        // the container, same as before.
        builder.Services.AddSingleton(sp => new AccountService(
            sp.GetRequiredService<IAccountStore>(),
            sp.GetRequiredService<IPasswordVerifierComparer>(),
            sp.GetRequiredService<IGoogleIdentityProvider>(),
            sp.GetRequiredService<ICouncilRegistryVerifier>(),
            sp.GetRequiredService<ITotpProvider>(),
            sp.GetRequiredService<ITwoFactorTicketIssuer>(),
            sp.GetRequiredService<ISessionTokenIssuer>(),
            sp.GetRequiredService<IWebAuthnCeremonyVerifier>(),
            sp.GetRequiredService<IMagicLinkIssuer>(),
            sp.GetRequiredService<IMagicLinkEmailSender>(),
            webAuthnRelyingPartyId,
            webAuthnExpectedOrigin,
            sp.GetRequiredService<INewDeviceAlertSender>()));

        // Security-review stopgap (see IStaffAccessGuard's own doc comment): this backend
        // has no staff/admin account concept yet (S14), so staff-only endpoints are gated
        // by a single shared-secret API key instead. Same "fail fast if unconfigured"
        // pattern as appConnectionString above.
        // IsNullOrEmpty (not just null-check): an accidentally empty env var/config value
        // (e.g. "StaffAccess__ApiKey=") must fail fast the same as a missing one --
        // StaffAccessGuard only rejects a null submitted key, so an empty expected key
        // here would let a caller "authenticate" with an empty header value.
        var staffApiKey = builder.Configuration["StaffAccess:ApiKey"];
        if (string.IsNullOrEmpty(staffApiKey))
        {
            throw new InvalidOperationException("Missing required configuration: StaffAccess:ApiKey");
        }
        builder.Services.AddSingleton<IStaffAccessGuard>(new StaffAccessGuard(staffApiKey));

        var app = builder.Build();

        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
        }

        app.UseExceptionHandler(_ => { });

        app.UseCors();

        app.MapHealthEndpoints();
        app.MapAuthEndpoints();
        app.MapProfessionalVerificationEndpoints();
        app.MapTwoFactorEndpoints();
        app.MapDevicePairingEndpoints();
        app.MapRecoveryEndpoints();

        if (magicLinkTestCaptureEndpoint)
        {
            app.MapMagicLinkDebugEndpoints();
        }

        return app;
    }
}
