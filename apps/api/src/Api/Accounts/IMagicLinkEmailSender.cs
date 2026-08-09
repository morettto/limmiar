namespace Api.Accounts;

/// <summary>
/// Delivers a magic-link sign-in token to a patient's e-mail address (S02-05).
///
/// Deliberately takes the opaque <paramref name="token"/> itself rather than a fully-formed
/// URL: composing the real deep link needs the SPA's own base URL/route, which is not one of
/// this ticket's confirmed backend seams (no such config key was requested for S02-05) --
/// that composition is left to a real implementation once one exists, or to a follow-up
/// ticket that adds the config key. <see cref="AccountService"/> stays free of that HTTP/
/// routing knowledge, consistent with its own "no HTTP knowledge" doc comment.
/// </summary>
public interface IMagicLinkEmailSender
{
    Task SendAsync(string email, string token, CancellationToken cancellationToken);
}
