using System.Globalization;
using System.Threading.RateLimiting;
using Api.Problems;
using Microsoft.AspNetCore.RateLimiting;

namespace Api.RateLimiting;

/// <summary>
/// One global limiter that picks its rule from the matched route pattern, so the limits live in
/// this file instead of on a dozen endpoint declarations. Only matched routes are limited:
/// the partition key never comes from a raw URL, so a client cannot mint buckets by varying it.
/// </summary>
public static class RateLimitingComposition
{
    private const int WindowSeconds = 60;

    private sealed record Rule(string Key, int PermitLimit);

    public static IServiceCollection AddRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        // RateLimiting:Disabled (E2E only): the whole Playwright suite calls /auth/* from one loopback IP.
        var disabled = configuration.GetValue<bool>("RateLimiting:Disabled");

        // Built here, not inside the AddRateLimiter callback (which runs once), so Roslyn does not emit an unreachable delegate-cache-reuse branch.
        Func<HttpContext, RateLimitPartition<string>> partitioner = context => Partition(context, disabled);

        services.AddRateLimiter(options =>
        {
            options.GlobalLimiter = PartitionedRateLimiter.Create(partitioner);
            options.OnRejected = (context, _) =>
            {
                // The window is fixed, so its length is the longest wait a client can be told.
                context.HttpContext.Response.Headers.RetryAfter = WindowSeconds.ToString(CultureInfo.InvariantCulture);
                var problem = ProblemResults.ProblemJson(
                    StatusCodes.Status429TooManyRequests, "Too many requests", RateLimitProblemCodes.TooManyRequests);
                return new ValueTask(problem.ExecuteAsync(context.HttpContext));
            };
        });

        return services;
    }

    private static RateLimitPartition<string> Partition(HttpContext context, bool disabled)
    {
        var rule = disabled ? null : RuleFor(context);
        return rule is null
            ? RateLimitPartition.GetNoLimiter("unlimited")
            : RateLimitPartition.GetFixedWindowLimiter(rule.Key, _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = rule.PermitLimit,
                Window = TimeSpan.FromSeconds(WindowSeconds),
                QueueLimit = 0,
            });
    }

    private static Rule? RuleFor(HttpContext context)
    {
        var pattern = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText;
        var ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        return pattern switch
        {
            null => null,
            _ when pattern.StartsWith("/auth/", StringComparison.Ordinal) => new($"auth:{ip}", 30),
            "/devices/pairing-sessions/{sessionId}/claim" => new($"claim:{ip}", 10),
            _ when pattern.StartsWith("/webhooks/", StringComparison.Ordinal) => new($"webhook:{ip}", 120),
            // Parsed, not used as text: the same GUID in another casing must land in the same bucket.
            "/accounts/{accountId:guid}/totp/challenge" => new($"totp:{AccountId(context)}", 5),
            "/accounts/{accountId:guid}/recovery-phrase" => new($"recovery:{AccountId(context)}", 5),
            _ => null,
        };
    }

    private static Guid AccountId(HttpContext context) =>
        Guid.Parse((string)context.Request.RouteValues["accountId"]!);
}
