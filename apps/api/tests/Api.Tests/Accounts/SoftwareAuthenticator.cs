using System.Buffers.Binary;
using System.Formats.Cbor;
using System.Security.Cryptography;
using System.Text;

namespace Api.Tests.Accounts;

internal sealed class SoftwareAuthenticator
{
    private const byte FlagUserPresent = 0x01;
    private const byte FlagUserVerified = 0x04;
    private const byte FlagAttestedCredentialData = 0x40;

    public const int CoseAlgorithmEs256 = -7;
    public const int CoseAlgorithmRs256 = -257;

    private const int CoseLabelKeyType = 1;
    private const int CoseLabelAlgorithm = 3;
    private const int CoseKeyTypeEc2 = 2;
    private const int CoseKeyTypeRsa = 3;

    private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    public byte[] CredentialId { get; } = RandomNumberGenerator.GetBytes(32);

    public byte[] CosePublicKey => CoseKeyLabelledAs(CoseAlgorithmEs256);

    /// <summary>Signs <c>authenticatorData || SHA-256(clientDataJSON)</c> the way WebAuthn L3 section 6.3.3 prescribes.</summary>
    public byte[] Sign(byte[] authenticatorData, byte[] clientDataJson) =>
        _key.SignData(
            [.. authenticatorData, .. SHA256.HashData(clientDataJson)],
            HashAlgorithmName.SHA256,
            DSASignatureFormat.Rfc3279DerSequence);

    public byte[] AttestationObject(
        string relyingPartyId,
        bool userPresent = true,
        bool userVerified = true,
        byte[]? coseKey = null)
    {
        var authenticatorData = AuthenticatorData(
            relyingPartyId,
            userPresent,
            userVerified,
            signCount: 0,
            attestedCredentialData: BuildAttestedCredentialData(coseKey ?? CosePublicKey));

        var writer = new CborWriter(CborConformanceMode.Ctap2Canonical);
        writer.WriteStartMap(3);
        writer.WriteTextString("fmt");
        writer.WriteTextString("none");
        writer.WriteTextString("attStmt");
        writer.WriteStartMap(0);
        writer.WriteEndMap();
        writer.WriteTextString("authData");
        writer.WriteByteString(authenticatorData);
        writer.WriteEndMap();
        return writer.Encode();
    }

    public static byte[] AuthenticatorData(
        string relyingPartyId,
        bool userPresent,
        bool userVerified,
        uint signCount,
        byte[]? attestedCredentialData = null)
    {
        var flags = (byte)((userPresent ? FlagUserPresent : 0)
            | (userVerified ? FlagUserVerified : 0)
            | (attestedCredentialData is not null ? FlagAttestedCredentialData : 0));

        var signCountBytes = new byte[sizeof(uint)];
        BinaryPrimitives.WriteUInt32BigEndian(signCountBytes, signCount);

        return
        [
            .. SHA256.HashData(Encoding.UTF8.GetBytes(relyingPartyId)),
            flags,
            .. signCountBytes,
            .. attestedCredentialData ?? [],
        ];
    }

    public static byte[] ClientDataJson(string type, string challenge, string origin) =>
        Encoding.UTF8.GetBytes(
            $$"""{"type":"{{type}}","challenge":"{{challenge}}","origin":"{{origin}}","crossOrigin":false}""");

    /// <summary><c>aaguid(16) || credentialIdLength(2) || credentialId || COSE public key</c>.</summary>
    private byte[] BuildAttestedCredentialData(byte[] coseKey)
    {
        var credentialIdLength = new byte[sizeof(ushort)];
        BinaryPrimitives.WriteUInt16BigEndian(credentialIdLength, (ushort)CredentialId.Length);

        return
        [
            .. new byte[16],
            .. credentialIdLength,
            .. CredentialId,
            .. coseKey,
        ];
    }

    // Passing anything but ES256 produces a kty/alg-contradicting key, on purpose.
    public byte[] CoseKeyLabelledAs(int coseAlgorithm)
    {
        var parameters = _key.ExportParameters(includePrivateParameters: false);
        var writer = new CborWriter(CborConformanceMode.Ctap2Canonical);
        writer.WriteStartMap(5);
        writer.WriteInt32(CoseLabelKeyType);
        writer.WriteInt32(CoseKeyTypeEc2);
        writer.WriteInt32(CoseLabelAlgorithm);
        writer.WriteInt32(coseAlgorithm);
        writer.WriteInt32(-1);
        writer.WriteInt32(1);
        writer.WriteInt32(-2);
        writer.WriteByteString(parameters.Q.X!);
        writer.WriteInt32(-3);
        writer.WriteByteString(parameters.Q.Y!);
        writer.WriteEndMap();
        return writer.Encode();
    }

    public static byte[] Rs256CoseKey()
    {
        using var rsa = RSA.Create(2048);
        var parameters = rsa.ExportParameters(includePrivateParameters: false);

        var writer = new CborWriter(CborConformanceMode.Ctap2Canonical);
        writer.WriteStartMap(4);
        writer.WriteInt32(CoseLabelKeyType);
        writer.WriteInt32(CoseKeyTypeRsa);
        writer.WriteInt32(CoseLabelAlgorithm);
        writer.WriteInt32(CoseAlgorithmRs256);
        writer.WriteInt32(-1);
        writer.WriteByteString(parameters.Modulus!);
        writer.WriteInt32(-2);
        writer.WriteByteString(parameters.Exponent!);
        writer.WriteEndMap();
        return writer.Encode();
    }
}
