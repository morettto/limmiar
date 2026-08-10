namespace Api.Accounts;

// Placeholder: real transactional e-mail delivery is not wired up yet.
// Tests override IMagicLinkEmailSender with a fake; production should never reach this.
public sealed class MagicLinkEmailSender : IMagicLinkEmailSender
{
    public Task SendAsync(string email, string token, CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "Magic-link e-mail delivery is not implemented yet (S02-05 backend seam scope). " +
            "See the TODO on Api.Accounts.MagicLinkEmailSender.");
}
