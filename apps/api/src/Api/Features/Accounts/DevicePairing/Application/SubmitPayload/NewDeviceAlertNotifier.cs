namespace Api.Accounts;

public sealed class NewDeviceAlertNotifier(IAccountStore store, INewDeviceAlertSender newDeviceAlertSender)
{
    public async Task NotifyNewDeviceLinkedAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var account = await store.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return;
        }

        try
        {
            await newDeviceAlertSender.SendAsync(account.Email, cancellationToken);
        }
        catch (Exception)
        {
        }
    }
}
