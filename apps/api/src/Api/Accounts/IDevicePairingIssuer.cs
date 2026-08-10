namespace Api.Accounts;

public interface IDevicePairingIssuer
{
    (string SessionId, DateTimeOffset ExpiresAt) Create(Guid accountId, byte[] primaryPublicKey);

    ClaimPairingSessionResult Claim(string sessionId, byte[] newDevicePublicKey);

    PairingClaimStatusResult GetClaimStatus(string sessionId, Guid accountId);

    SubmitPairingPayloadResult SubmitPayload(string sessionId, Guid accountId, byte[] encryptedKek);

    FetchPairingPayloadResult FetchPayload(string sessionId);
}
