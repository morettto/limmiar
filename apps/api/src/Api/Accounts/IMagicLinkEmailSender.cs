namespace Api.Accounts;

public interface IMagicLinkEmailSender
{
    Task SendAsync(string email, string token, CancellationToken cancellationToken);
}
