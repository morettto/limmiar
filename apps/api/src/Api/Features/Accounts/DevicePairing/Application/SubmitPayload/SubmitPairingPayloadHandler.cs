using Mediator;

namespace Api.Accounts;

public sealed class SubmitPairingPayloadHandler(IDevicePairingIssuer pairingIssuer, NewDeviceAlertNotifier newDeviceAlertNotifier)
    : IRequestHandler<SubmitPairingPayloadCommand, SubmitPairingPayloadResult>
{
    public async ValueTask<SubmitPairingPayloadResult> Handle(SubmitPairingPayloadCommand request, CancellationToken cancellationToken)
    {
        var result = pairingIssuer.SubmitPayload(request.SessionId, request.AccountId, request.EncryptedKek);
        if (!result.Succeeded)
        {
            return result;
        }

        await newDeviceAlertNotifier.NotifyNewDeviceLinkedAsync(request.AccountId, cancellationToken);
        return result;
    }
}
