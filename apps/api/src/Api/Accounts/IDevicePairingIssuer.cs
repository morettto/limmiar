namespace Api.Accounts;

/// <summary>
/// Relays a device-pairing handshake between an already-authorized ("primary") device and a
/// new device that scans the QR code it displays (Spec S02, ticket S02-04).
/// </summary>
public interface IDevicePairingIssuer
{
    /// <summary>
    /// Opens a pairing session for <paramref name="accountId"/>, carrying the primary
    /// device's raw X25519 public key. The returned session id is what the primary encodes
    /// into the QR code.
    /// </summary>
    (string SessionId, DateTimeOffset ExpiresAt) Create(Guid accountId, byte[] primaryPublicKey);

    /// <summary>
    /// The scanning device claims <paramref name="sessionId"/> by presenting its own raw
    /// X25519 public key. First caller wins; every later caller fails, which is what makes
    /// a re-scanned (photographed, screenshotted, shoulder-surfed) QR code worthless.
    /// </summary>
    ClaimPairingSessionResult Claim(string sessionId, byte[] newDevicePublicKey);

    /// <summary>
    /// What the primary device polls while its QR code is on screen: has anyone scanned it
    /// yet, and if so, with which public key. Idempotent -- unlike <see cref="Claim"/> and
    /// <see cref="FetchPayload"/> this consumes nothing, so it can be called as often as the
    /// primary likes. Account-scoped: a session belonging to a different
    /// <paramref name="accountId"/> is reported as if it did not exist.
    /// </summary>
    PairingClaimStatusResult GetClaimStatus(string sessionId, Guid accountId);

    /// <summary>
    /// The primary device hands over <paramref name="encryptedKek"/> -- its KEK, already
    /// encrypted to the claiming device's key. Opaque to the server, which never has the
    /// material to read it. Valid exactly once, and only after <see cref="Claim"/> has
    /// succeeded. Account-scoped, same as <see cref="GetClaimStatus"/>.
    /// </summary>
    SubmitPairingPayloadResult SubmitPayload(string sessionId, Guid accountId, byte[] encryptedKek);

    /// <summary>
    /// The claiming device collects the ciphertext, exactly once -- a successful fetch
    /// consumes the session outright, so a replayed session id gets nothing. Not
    /// account-scoped, unlike <see cref="GetClaimStatus"/>/<see cref="SubmitPayload"/>: the
    /// whole point of pairing is that the new device has no session for this account yet;
    /// possession of the unclaimed session id (plus having won the one claim it allows) is
    /// the credential.
    /// </summary>
    FetchPairingPayloadResult FetchPayload(string sessionId);
}
