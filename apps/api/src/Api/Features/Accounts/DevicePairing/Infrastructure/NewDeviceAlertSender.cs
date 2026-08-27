namespace Api.Accounts;

// Placeholder: real transactional e-mail delivery is not wired up yet.
// NewDeviceAlertNotifier.NotifyNewDeviceLinkedAsync swallows whatever this throws.
public sealed class NewDeviceAlertSender : INewDeviceAlertSender
{
    public Task SendAsync(string email, CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "New-device alert e-mail delivery is not implemented yet (S02-07 backend seam scope). " +
            "See the TODO on Api.Accounts.NewDeviceAlertSender.");
}
