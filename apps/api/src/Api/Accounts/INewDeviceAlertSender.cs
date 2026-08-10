namespace Api.Accounts;

public interface INewDeviceAlertSender
{
    Task SendAsync(string email, CancellationToken cancellationToken);
}
