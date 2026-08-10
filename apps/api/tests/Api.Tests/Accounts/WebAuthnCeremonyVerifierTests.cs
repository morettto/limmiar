using System.Buffers.Text;
using System.Security.Cryptography;
using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class WebAuthnCeremonyVerifierTests
{
    private const string RelyingPartyId = "limmiar.test";
    private const string Origin = "https://limmiar.test";

    private readonly WebAuthnCeremonyVerifier _verifier = new();

    [Fact]
    public async Task VerifyRegistrationAsync_WithValidEs256Credential_ReturnsCredentialIdAndPublicKey()
    {
        var authenticator = new SoftwareAuthenticator();
        var challenge = NewChallenge();

        var result = await _verifier.VerifyRegistrationAsync(Registration(authenticator, challenge));

        Assert.True(result.Succeeded);
        Assert.Equal(authenticator.CredentialId, result.Credential!.CredentialId);
        Assert.Equal(authenticator.CosePublicKey, result.Credential.CosePublicKey);
        Assert.Equal(0u, result.Credential.SignCount);
        Assert.Equal(Guid.Empty, result.Credential.AaGuid);
    }

    [Fact]
    public async Task VerifyRegistrationAsync_WithWrongChallengeInClientData_IsRejected()
    {
        var authenticator = new SoftwareAuthenticator();

        var result = await _verifier.VerifyRegistrationAsync(
            Registration(authenticator, NewChallenge(), clientDataChallenge: NewChallenge()));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.ChallengeMismatch, result.FailureReason);
    }

    [Fact]
    public async Task VerifyRegistrationAsync_WithWrongOriginInClientData_IsRejected()
    {
        var authenticator = new SoftwareAuthenticator();

        var result = await _verifier.VerifyRegistrationAsync(
            Registration(authenticator, NewChallenge(), clientDataOrigin: "https://phish.example"));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.OriginMismatch, result.FailureReason);
    }

    [Fact]
    public async Task VerifyRegistrationAsync_WithAssertionCeremonyType_IsRejected()
    {
        var authenticator = new SoftwareAuthenticator();

        var result = await _verifier.VerifyRegistrationAsync(
            Registration(authenticator, NewChallenge(), clientDataType: "webauthn.get"));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.CeremonyTypeMismatch, result.FailureReason);
    }

    [Fact]
    public async Task VerifyRegistrationAsync_WithWrongRelyingPartyIdHash_IsRejected()
    {
        var authenticator = new SoftwareAuthenticator();

        var result = await _verifier.VerifyRegistrationAsync(
            Registration(authenticator, NewChallenge(), authenticatorRelyingPartyId: "evil.test"));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.RelyingPartyMismatch, result.FailureReason);
    }

    [Fact]
    public async Task VerifyRegistrationAsync_WithUserPresentFlagClear_IsRejected()
    {
        var authenticator = new SoftwareAuthenticator();

        var result = await _verifier.VerifyRegistrationAsync(
            Registration(authenticator, NewChallenge(), userPresent: false));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.UserNotPresent, result.FailureReason);
    }

    [Fact]
    public async Task VerifyRegistrationAsync_WithUserVerifiedFlagClear_IsRejected()
    {
        var authenticator = new SoftwareAuthenticator();

        var result = await _verifier.VerifyRegistrationAsync(
            Registration(authenticator, NewChallenge(), userVerified: false));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.UserNotVerified, result.FailureReason);
    }

    [Fact]
    public async Task VerifyRegistrationAsync_WithNonEs256CredentialAlgorithm_IsRejected()
    {
        var authenticator = new SoftwareAuthenticator();

        var result = await _verifier.VerifyRegistrationAsync(
            Registration(authenticator, NewChallenge(), coseKey: SoftwareAuthenticator.Rs256CoseKey()));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.UnsupportedAlgorithm, result.FailureReason);
    }

    // A kty/alg-contradicting key makes Fido2NetLib 4.0.1 throw a plain InvalidOperationException -- pins that it comes back as an ordinary rejection instead of escaping the verifier.
    [Fact]
    public async Task VerifyRegistrationAsync_WithSelfContradictingCoseKey_IsRejected()
    {
        var authenticator = new SoftwareAuthenticator();

        var result = await _verifier.VerifyRegistrationAsync(
            Registration(authenticator, NewChallenge(), coseKey: authenticator.CoseKeyLabelledAs(SoftwareAuthenticator.CoseAlgorithmRs256)));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.MalformedResponse, result.FailureReason);
    }

    [Fact]
    public async Task VerifyRegistrationAsync_WithUnparseableClientDataJson_IsRejected()
    {
        var authenticator = new SoftwareAuthenticator();

        var result = await _verifier.VerifyRegistrationAsync(
            Registration(authenticator, NewChallenge(), clientDataJson: "not json"u8.ToArray()));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.MalformedResponse, result.FailureReason);
    }

    [Fact]
    public async Task VerifyRegistrationAsync_WithNonStringClientDataMembers_IsRejected()
    {
        var authenticator = new SoftwareAuthenticator();

        var result = await _verifier.VerifyRegistrationAsync(
            Registration(authenticator, NewChallenge(), clientDataJson: """{"type":42}"""u8.ToArray()));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.MalformedResponse, result.FailureReason);
    }

    [Fact]
    public async Task VerifyRegistrationAsync_WithUnparseableAttestationObject_IsRejected()
    {
        var authenticator = new SoftwareAuthenticator();

        var result = await _verifier.VerifyRegistrationAsync(
            Registration(authenticator, NewChallenge(), attestationObject: RandomNumberGenerator.GetBytes(64)));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.MalformedResponse, result.FailureReason);
    }

    [Fact]
    public async Task VerifyAssertionAsync_WithValidSignatureOverStoredCredential_ReturnsAdvancedSignCount()
    {
        var (authenticator, credential) = await RegisteredCredential();
        var challenge = NewChallenge();

        var result = await _verifier.VerifyAssertionAsync(
            Assertion(authenticator, credential, challenge, signCount: 7));

        Assert.True(result.Succeeded);
        Assert.Equal(7u, result.NewSignCount);
    }

    [Fact]
    public async Task VerifyAssertionAsync_WithUserHandleOnTheResponse_StillVerifies()
    {
        var (authenticator, credential) = await RegisteredCredential();
        var ceremony = Assertion(authenticator, credential, NewChallenge(), signCount: 3);

        var result = await _verifier.VerifyAssertionAsync(
            ceremony with { UserHandle = Guid.NewGuid().ToByteArray() });

        Assert.True(result.Succeeded);
        Assert.Equal(3u, result.NewSignCount);
    }

    [Fact]
    public async Task VerifyAssertionAsync_WithTamperedSignature_IsRejected()
    {
        var (authenticator, credential) = await RegisteredCredential();
        var ceremony = Assertion(authenticator, credential, NewChallenge(), signCount: 1);
        var tampered = ceremony.Signature.ToArray();
        tampered[^1] ^= 0xFF;

        var result = await _verifier.VerifyAssertionAsync(ceremony with { Signature = tampered });

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.InvalidSignature, result.FailureReason);
    }

    [Fact]
    public async Task VerifyAssertionAsync_WithSignatureFromAnotherAuthenticator_IsRejected()
    {
        var (_, credential) = await RegisteredCredential();
        var impostor = new SoftwareAuthenticator();

        var result = await _verifier.VerifyAssertionAsync(
            Assertion(impostor, credential, NewChallenge(), signCount: 1));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.InvalidSignature, result.FailureReason);
    }

    [Theory]
    [InlineData(5u, 5u)]
    [InlineData(5u, 4u)]
    [InlineData(5u, 0u)]
    public async Task VerifyAssertionAsync_WithSignCountNotStrictlyGreater_IsRejected(uint storedSignCount, uint signCount)
    {
        var (authenticator, credential) = await RegisteredCredential();

        var result = await _verifier.VerifyAssertionAsync(
            Assertion(authenticator, credential, NewChallenge(), signCount: signCount, storedSignCount: storedSignCount));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.SignCountNotAdvanced, result.FailureReason);
    }

    [Fact]
    public async Task VerifyAssertionAsync_WithNonCountingAuthenticatorReportingZero_IsAccepted()
    {
        var (authenticator, credential) = await RegisteredCredential();

        var result = await _verifier.VerifyAssertionAsync(
            Assertion(authenticator, credential, NewChallenge(), signCount: 0, storedSignCount: 0));

        Assert.True(result.Succeeded);
        Assert.Equal(0u, result.NewSignCount);
    }

    [Fact]
    public async Task VerifyAssertionAsync_WithWrongChallengeInClientData_IsRejected()
    {
        var (authenticator, credential) = await RegisteredCredential();

        var result = await _verifier.VerifyAssertionAsync(
            Assertion(authenticator, credential, NewChallenge(), clientDataChallenge: NewChallenge()));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.ChallengeMismatch, result.FailureReason);
    }

    [Fact]
    public async Task VerifyAssertionAsync_WithWrongOriginInClientData_IsRejected()
    {
        var (authenticator, credential) = await RegisteredCredential();

        var result = await _verifier.VerifyAssertionAsync(
            Assertion(authenticator, credential, NewChallenge(), clientDataOrigin: "https://phish.example"));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.OriginMismatch, result.FailureReason);
    }

    [Fact]
    public async Task VerifyAssertionAsync_WithWrongRelyingPartyIdHash_IsRejected()
    {
        var (authenticator, credential) = await RegisteredCredential();

        var result = await _verifier.VerifyAssertionAsync(
            Assertion(authenticator, credential, NewChallenge(), authenticatorRelyingPartyId: "evil.test"));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.RelyingPartyMismatch, result.FailureReason);
    }

    [Fact]
    public async Task VerifyAssertionAsync_WithUserVerifiedFlagClear_IsRejected()
    {
        var (authenticator, credential) = await RegisteredCredential();

        var result = await _verifier.VerifyAssertionAsync(
            Assertion(authenticator, credential, NewChallenge(), userVerified: false));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.UserNotVerified, result.FailureReason);
    }

    [Fact]
    public async Task VerifyAssertionAsync_WithTruncatedAuthenticatorData_IsRejected()
    {
        var (authenticator, credential) = await RegisteredCredential();

        var result = await _verifier.VerifyAssertionAsync(
            Assertion(authenticator, credential, NewChallenge(), authenticatorData: new byte[36]));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.MalformedResponse, result.FailureReason);
    }

    [Fact]
    public async Task VerifyAssertionAsync_WithSelfContradictingStoredPublicKey_IsRejected()
    {
        var (authenticator, credential) = await RegisteredCredential();

        var result = await _verifier.VerifyAssertionAsync(
            Assertion(
                authenticator,
                credential,
                NewChallenge(),
                storedCosePublicKey: authenticator.CoseKeyLabelledAs(SoftwareAuthenticator.CoseAlgorithmRs256)));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.MalformedResponse, result.FailureReason);
    }

    [Fact]
    public async Task VerifyAssertionAsync_WithRegistrationCeremonyType_IsRejected()
    {
        var (authenticator, credential) = await RegisteredCredential();

        var result = await _verifier.VerifyAssertionAsync(
            Assertion(authenticator, credential, NewChallenge(), clientDataType: "webauthn.create"));

        Assert.False(result.Succeeded);
        Assert.Equal(WebAuthnCeremonyFailureReason.CeremonyTypeMismatch, result.FailureReason);
    }

    private static string NewChallenge() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));

    private async Task<(SoftwareAuthenticator Authenticator, WebAuthnCredentialRegistration Credential)> RegisteredCredential()
    {
        var authenticator = new SoftwareAuthenticator();
        var result = await _verifier.VerifyRegistrationAsync(Registration(authenticator, NewChallenge()));

        Assert.True(result.Succeeded);
        return (authenticator, result.Credential!);
    }

    private static WebAuthnAssertionCeremony Assertion(
        SoftwareAuthenticator authenticator,
        WebAuthnCredentialRegistration credential,
        string challenge,
        string? clientDataChallenge = null,
        string? clientDataOrigin = null,
        string? clientDataType = null,
        string? authenticatorRelyingPartyId = null,
        bool userPresent = true,
        bool userVerified = true,
        uint signCount = 1,
        uint storedSignCount = 0,
        byte[]? storedCosePublicKey = null,
        byte[]? authenticatorData = null)
    {
        var clientDataJson = SoftwareAuthenticator.ClientDataJson(
            clientDataType ?? "webauthn.get",
            clientDataChallenge ?? challenge,
            clientDataOrigin ?? Origin);

        var signedAuthenticatorData = authenticatorData ?? SoftwareAuthenticator.AuthenticatorData(
            authenticatorRelyingPartyId ?? RelyingPartyId,
            userPresent,
            userVerified,
            signCount);

        return new WebAuthnAssertionCeremony
        {
            ExpectedChallenge = challenge,
            ExpectedRelyingPartyId = RelyingPartyId,
            ExpectedOrigin = Origin,
            CredentialId = credential.CredentialId,
            StoredCosePublicKey = storedCosePublicKey ?? credential.CosePublicKey,
            StoredSignCount = storedSignCount,
            ClientDataJson = clientDataJson,
            AuthenticatorData = signedAuthenticatorData,
            Signature = authenticator.Sign(signedAuthenticatorData, clientDataJson),
        };
    }

    private static WebAuthnRegistrationCeremony Registration(
        SoftwareAuthenticator authenticator,
        string challenge,
        string? clientDataChallenge = null,
        string? clientDataOrigin = null,
        string? clientDataType = null,
        string? authenticatorRelyingPartyId = null,
        bool userPresent = true,
        bool userVerified = true,
        byte[]? coseKey = null,
        byte[]? clientDataJson = null,
        byte[]? attestationObject = null) =>
        new()
        {
            ExpectedChallenge = challenge,
            ExpectedRelyingPartyId = RelyingPartyId,
            ExpectedOrigin = Origin,
            CredentialId = authenticator.CredentialId,
            ClientDataJson = clientDataJson ?? SoftwareAuthenticator.ClientDataJson(
                clientDataType ?? "webauthn.create",
                clientDataChallenge ?? challenge,
                clientDataOrigin ?? Origin),
            AttestationObject = attestationObject ?? authenticator.AttestationObject(
                authenticatorRelyingPartyId ?? RelyingPartyId,
                userPresent,
                userVerified,
                coseKey),
        };
}
