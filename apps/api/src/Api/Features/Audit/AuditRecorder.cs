using System.Collections.Concurrent;
using Api.Accounts;

namespace Api.Audit;

/// <summary>
/// The one producer of audit entries: tenant = account, device = session family. A lost entry
/// is data loss, so exhausting <see cref="AuditEntryStore.AppendAsync"/>'s retries fails the
/// request instead of continuing silently.
/// </summary>
public sealed class AuditRecorder(AuditEntryStore store)
{
    /// <summary>Every this-many entries the chain head is anchored (S10's periodic anchor).</summary>
    public const int AnchorEvery = 50;

    private const string SessionItemKey = "limmiar.audit.session";

    // ponytail: in-memory "already signed in" set, like the session tokens it mirrors -- a restart
    // drops both, so a session can never outlive its SignIn entry. Persist alongside sessions if they ever are.
    private readonly ConcurrentDictionary<Guid, byte> _signedIn = new();

    public static void Attach(HttpContext context, AccessSession session) => context.Items[SessionItemKey] = session;

    public static AccessSession? SessionOf(HttpContext context) => context.Items[SessionItemKey] as AccessSession;

    public async Task RecordAsync(AccessSession session, AuditAction action, CancellationToken ct)
    {
        var entry = await store.AppendAsync(session.AccountId, action, session.SessionId, ct)
            ?? throw new InvalidOperationException("Audit entry could not be appended after every retry.");
        if (entry.Sequence % AnchorEvery == 0)
        {
            await store.CaptureAnchorAsync(session.AccountId, ct);
        }
    }

    /// <summary>Records <see cref="AuditAction"/>.SignIn the first time a session family is used.</summary>
    public Task RecordSignInOnceAsync(AccessSession session, CancellationToken ct) =>
        _signedIn.TryAdd(session.SessionId, 0) ? RecordAsync(session, AuditAction.SignIn, ct) : Task.CompletedTask;

    /// <summary>For handlers behind <see cref="RequireAccountAccessMiddleware"/>, which always attaches the session.</summary>
    public Task RecordAsync(HttpContext context, AuditAction action, CancellationToken ct) =>
        RecordAsync(SessionOf(context)!, action, ct);
}

/// <summary>Runs right after <see cref="RequireAccountAccessMiddleware"/>: a first use of a session records SignIn.</summary>
public sealed class AuditSignInMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, AuditRecorder recorder)
    {
        if (AuditRecorder.SessionOf(context) is { } session)
        {
            await recorder.RecordSignInOnceAsync(session, context.RequestAborted);
        }

        await next(context);
    }
}
