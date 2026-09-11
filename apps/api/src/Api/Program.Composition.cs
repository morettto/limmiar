using Api.Accounts;
using Api.Consent;
using Api.Data;
using Api.Health;
using Api.ExceptionHandling;
using Api.Notes;
using Api.Patients;
using Api.Scheduling;
using Api.Serialization;
using Mediator;
using Microsoft.AspNetCore.Cors.Infrastructure;

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
        // Built once here, not inline inside the AddCors callback, so Roslyn does not emit an unreachable delegate-cache-reuse branch (AddCors invokes its configuration callback exactly once).
        Action<CorsPolicyBuilder> configureCorsPolicy = policy =>
        {
            if (corsAllowedOrigins.Length > 0)
            {
                policy.WithOrigins(corsAllowedOrigins).AllowAnyHeader().AllowAnyMethod();
            }
        };
        builder.Services.AddCors(options => options.AddDefaultPolicy(configureCorsPolicy));

        var appConnectionString = builder.Configuration.GetConnectionString("AppDb")
            ?? throw new InvalidOperationException("Missing required configuration: ConnectionStrings:AppDb");

        builder.Services.AddSingleton(NpgsqlDataSourceFactory.Create(appConnectionString));

        builder.Services.AddExceptionHandler<GlobalProblemExceptionHandler>();

        // Mediator (martinothamar), not MediatR: handlers are resolved through source-generated
        // dispatch, zero reflection, safe under PublishAot=true (Directory.Build.props treats
        // IL2026/IL3050 as errors, which MediatR's runtime assembly scanning would trip).
        builder.Services.AddMediator();

        builder.Services.AddAccounts(builder.Configuration);

        builder.Services.AddPatients();
        builder.Services.AddScheduling();
        builder.Services.AddNotes();
        builder.Services.AddConsent();

        var app = builder.Build();

        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
        }

        app.UseExceptionHandler(_ => { });

        app.UseCors();

        // Runs after routing has selected an endpoint and before that endpoint's own request
        // delegate -- including its parameter binding -- ever executes. See
        // Accounts.Sessions/README.md.
        app.UseMiddleware<RequireAccountAccessMiddleware>();

        // Every Map*Endpoints call below funnels through this one root group so the 401/403
        // OpenAPI responses get declared on every {accountId} route exactly once, with no
        // per-route call to forget.
        var routes = app.MapGroup("").DeclareAccountAccessOpenApiResponses();

        routes.MapHealthEndpoints();
        routes.MapAccounts();
        routes.MapPatients();
        routes.MapScheduling();
        routes.MapNotes();
        routes.MapConsent();

        return app;
    }
}
