namespace Api.Accounts;

public sealed class NewDeviceAlertNotifier(IAccountStore store, INewDeviceAlertSender newDeviceAlertSender)
{
    public async Task NotifyNewDeviceLinkedAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var account = await store.FindByIdAsync(accountId, cancellationToken);
        if (account?.Email is not { } email)
        {
            return;
        }

        try
        {
            await newDeviceAlertSender.SendAsync(email, cancellationToken);
        }
        catch (Exception)
        {
        }
    }
}
