namespace Api.Accounts;

/// <summary>
/// TODO: integrate with a real transactional e-mail provider once this ticket's scope is
/// extended to actually deliver mail. Out of scope for S02-05's confirmed backend seams,
/// which only require the magic-link endpoints' CONTRACT to be complete with an injectable/
/// fake <see cref="IMagicLinkEmailSender"/> for tests -- same "não precisa integrar de
/// verdade agora" precedent as <see cref="GoogleIdentityProvider"/>. Every test that reaches
/// a magic-link endpoint overrides the DI registration of <see cref="IMagicLinkEmailSender"/>
/// with a fake; nothing in production traffic should reach this placeholder until the real
/// integration lands.
/// </summary>
public sealed class MagicLinkEmailSender : IMagicLinkEmailSender
{
    public Task SendAsync(string email, string token, CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "Magic-link e-mail delivery is not implemented yet (S02-05 backend seam scope). " +
            "See the TODO on Api.Accounts.MagicLinkEmailSender.");
}
