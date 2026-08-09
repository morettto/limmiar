namespace Api.Accounts;

/// <summary>
/// TODO: integrate with a real transactional e-mail provider once this ticket's scope is
/// extended to actually deliver mail. Out of scope for S02-07's confirmed backend seams,
/// which only require <see cref="AccountService.NotifyNewDeviceLinkedAsync"/>'s CONTRACT to be
/// complete with an injectable/fake <see cref="INewDeviceAlertSender"/> for tests -- same
/// "não precisa integrar de verdade agora" precedent as <see cref="MagicLinkEmailSender"/>.
/// Nothing in production traffic should reach this placeholder until the real integration
/// lands; <see cref="AccountService.NotifyNewDeviceLinkedAsync"/> swallows whatever this
/// throws, so reaching it never breaks the device-pairing handshake it is called from.
/// </summary>
public sealed class NewDeviceAlertSender : INewDeviceAlertSender
{
    public Task SendAsync(string email, CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "New-device alert e-mail delivery is not implemented yet (S02-07 backend seam scope). " +
            "See the TODO on Api.Accounts.NewDeviceAlertSender.");
}
