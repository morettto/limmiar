using System.Collections.Concurrent;

namespace Api.Accounts;

/// <summary>
/// Production-assembly counterpart of the test project's own
/// <c>Api.Tests.Accounts.CapturingMagicLinkEmailSender</c> (that one cannot be referenced from
/// here -- it lives in a separate assembly). Records the last token "sent" per e-mail instead
/// of ever sending anything.
///
/// Wired in as <see cref="IMagicLinkEmailSender"/> ONLY when <c>MagicLink:TestCaptureEndpoint</c>
/// is true (see Program.Composition.cs), which only ever happens in the Playwright E2E
/// environment (apps/app/playwright.config.ts) -- there is no real e-mail delivery for that
/// environment to intercept, so the E2E needs a way to read back the token a real, running
/// <c>dotnet run</c> process "sent". Every other environment gets the real
/// <see cref="MagicLinkEmailSender"/> placeholder instead; this class is never constructed
/// unless that flag is explicitly set.
/// </summary>
internal sealed class CapturingMagicLinkEmailSender : IMagicLinkEmailSender
{
    private readonly ConcurrentDictionary<string, string> _lastTokenByEmail = new(StringComparer.Ordinal);

    public Task SendAsync(string email, string token, CancellationToken cancellationToken)
    {
        _lastTokenByEmail[email] = token;
        return Task.CompletedTask;
    }

    public string? LastTokenSentTo(string email) => _lastTokenByEmail.GetValueOrDefault(email);
}
