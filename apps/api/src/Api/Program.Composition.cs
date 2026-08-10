using Api.Accounts;
using Api.Data;
using Api.Endpoints;
using Api.ExceptionHandling;
using Api.Serialization;

public partial class Program
{
    public static WebApplication BuildApp(WebApplicationBuilder builder)
    {
        builder.Services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, ApiJsonSerializerContext.Default);
        });

        builder.Services.AddOpenApi();

        // Empty allow-list (no cross-origin access) unless configured -- AllowAnyOrigin was rejected as too wide for this app even though every account-scoped endpoint is bearer-token-gated.
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

        builder.Services.AddSingleton<IAccountStore, InMemoryAccountStore>();
        builder.Services.AddSingleton<IPasswordVerifierComparer, ConstantTimePasswordVerifierComparer>();
        builder.Services.AddSingleton<IGoogleIdentityProvider, GoogleIdentityProvider>();
        builder.Services.AddSingleton<ICouncilRegistryVerifier, CouncilRegistryVerifier>();
        builder.Services.AddSingleton<ITotpProvider, TotpProvider>();
        builder.Services.AddSingleton<ITwoFactorTicketIssuer, TwoFactorTicketIssuer>();
        // DevicePairing:SessionLifetimeSeconds (E2E only): shortens the pairing-session TTL so the "expired QR" test doesn't wait out the real two-minute window.
        builder.Services.AddSingleton<IDevicePairingIssuer>(sp =>
        {
            var overrideSeconds = sp.GetRequiredService<IConfiguration>()
                .GetValue<double?>("DevicePairing:SessionLifetimeSeconds");
            return overrideSeconds is { } seconds
                ? new DevicePairingIssuer(sessionLifetime: TimeSpan.FromSeconds(seconds))
                : new DevicePairingIssuer();
        });
        builder.Services.AddSingleton<ISessionTokenIssuer, SessionTokenIssuer>();
        builder.Services.AddSingleton<IWebAuthnCeremonyVerifier, WebAuthnCeremonyVerifier>();
        // MagicLink:TokenLifetimeSeconds (E2E only): same precedent as DevicePairing:SessionLifetimeSeconds above.
        builder.Services.AddSingleton<IMagicLinkIssuer>(sp =>
        {
            var overrideSeconds = sp.GetRequiredService<IConfiguration>()
                .GetValue<double?>("MagicLink:TokenLifetimeSeconds");
            return overrideSeconds is { } seconds
                ? new MagicLinkIssuer(tokenLifetime: TimeSpan.FromSeconds(seconds))
                : new MagicLinkIssuer();
        });
        // MagicLink:TestCaptureEndpoint (E2E only): swaps in CapturingMagicLinkEmailSender + the debug route, since there's no real e-mail infra for Playwright to read a "sent" link from.
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

        builder.Services.AddSingleton<INewDeviceAlertSender, NewDeviceAlertSender>();

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

        // IsNullOrEmpty (not just null-check): an accidentally empty StaffAccess:ApiKey must fail fast, same as a missing one -- StaffAccessGuard only rejects a null submitted key.
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
