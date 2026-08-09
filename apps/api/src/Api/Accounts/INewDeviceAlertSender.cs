namespace Api.Accounts;

/// <summary>
/// Alerts the account holder, over an out-of-band channel, that a device-pairing handshake
/// just finished (Spec S02, ticket S02-07). Sent to the account's registered e-mail address --
/// deliberately NOT delivered through the new device or the session that just finished
/// pairing, since either could be under an attacker's control: an attacker who only controls
/// a stolen session or the new device itself must not be able to suppress or fake this
/// notification. <see cref="AccountService"/> calls this right after
/// <see cref="IDevicePairingIssuer.SubmitPayload"/> succeeds (see
/// <c>Api.Endpoints.DevicePairingEndpoints.HandleSubmitPayload</c>).
/// </summary>
public interface INewDeviceAlertSender
{
    Task SendAsync(string email, CancellationToken cancellationToken);
}
