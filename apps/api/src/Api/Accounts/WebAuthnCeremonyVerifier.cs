using System.Buffers.Binary;
using System.Buffers.Text;
using System.Text.Json;
using Fido2NetLib;
using Fido2NetLib.Exceptions;
using Fido2NetLib.Objects;

namespace Api.Accounts;

public sealed class WebAuthnCeremonyVerifier : IWebAuthnCeremonyVerifier
{
    private static readonly IReadOnlyList<PubKeyCredParam> Es256Only =
        [new PubKeyCredParam(COSE.Algorithm.ES256, PublicKeyCredentialType.PublicKey)];

    private static readonly AuthenticatorSelection PlatformAuthenticatorWithUserVerification = new()
    {
        AuthenticatorAttachment = Fido2NetLib.Objects.AuthenticatorAttachment.Platform,
        ResidentKey = ResidentKeyRequirement.Discouraged,
        UserVerification = UserVerificationRequirement.Required,
    };

    // rpIdHash(32) || flags(1) || signCount(4) is the fixed prefix before any optional tail.
    private const int AuthenticatorDataMinimumLength = 37;

    private const int SignCountOffset = 33;

    private static readonly Fido2User UnusedUser = new() { Id = [0], Name = "-", DisplayName = "-" };

    public async Task<WebAuthnRegistrationResult> VerifyRegistrationAsync(
        WebAuthnRegistrationCeremony ceremony,
        CancellationToken cancellationToken = default)
    {
        var clientDataFailure = ValidateClientData(
            ceremony.ClientDataJson,
            "webauthn.create",
            ceremony.ExpectedChallenge,
            ceremony.ExpectedOrigin);

        if (clientDataFailure is not null)
        {
            return WebAuthnRegistrationResult.Failure(clientDataFailure.Value);
        }

        var options = new CredentialCreateOptions
        {
            Rp = new PublicKeyCredentialRpEntity(ceremony.ExpectedRelyingPartyId, ceremony.ExpectedRelyingPartyId, null),
            User = UnusedUser,
            Challenge = Base64Url.DecodeFromChars(ceremony.ExpectedChallenge),
            PubKeyCredParams = Es256Only,
            AuthenticatorSelection = PlatformAuthenticatorWithUserVerification,
            Attestation = AttestationConveyancePreference.None,
        };

        RegisteredPublicKeyCredential credential;
        try
        {
            credential = await CreateFido2(ceremony.ExpectedRelyingPartyId, ceremony.ExpectedOrigin)
                .MakeNewCredentialAsync(
                    new MakeNewCredentialParams
                    {
                        AttestationResponse = new AuthenticatorAttestationRawResponse
                        {
                            Id = Base64Url.EncodeToString(ceremony.CredentialId),
                            RawId = ceremony.CredentialId,
                            Type = PublicKeyCredentialType.PublicKey,
                            Response = new AuthenticatorAttestationRawResponse.AttestationResponse
                            {
                                AttestationObject = ceremony.AttestationObject,
                                ClientDataJson = ceremony.ClientDataJson,
                            },
                        },
                        OriginalOptions = options,
                        IsCredentialIdUniqueToUserCallback = (_, _) => Task.FromResult(true),
                    },
                    cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Fido2VerificationException exception)
        {
            return WebAuthnRegistrationResult.Failure(Classify(exception.Code));
        }
        catch (InvalidOperationException)
        {
            return WebAuthnRegistrationResult.Failure(WebAuthnCeremonyFailureReason.MalformedResponse);
        }

        return WebAuthnRegistrationResult.Success(new WebAuthnCredentialRegistration(
            credential.Id,
            credential.PublicKey,
            credential.SignCount,
            credential.AaGuid));
    }

    public async Task<WebAuthnAssertionResult> VerifyAssertionAsync(
        WebAuthnAssertionCeremony ceremony,
        CancellationToken cancellationToken = default)
    {
        var clientDataFailure = ValidateClientData(
            ceremony.ClientDataJson,
            "webauthn.get",
            ceremony.ExpectedChallenge,
            ceremony.ExpectedOrigin);

        if (clientDataFailure is not null)
        {
            return WebAuthnAssertionResult.Failure(clientDataFailure.Value);
        }

        if (ceremony.AuthenticatorData.Length < AuthenticatorDataMinimumLength)
        {
            return WebAuthnAssertionResult.Failure(WebAuthnCeremonyFailureReason.MalformedResponse);
        }

        var newSignCount = BinaryPrimitives.ReadUInt32BigEndian(
            ceremony.AuthenticatorData.AsSpan(SignCountOffset, sizeof(uint)));

        if (!HasAdvanced(newSignCount, ceremony.StoredSignCount))
        {
            return WebAuthnAssertionResult.Failure(WebAuthnCeremonyFailureReason.SignCountNotAdvanced);
        }

        var options = new AssertionOptions
        {
            Challenge = Base64Url.DecodeFromChars(ceremony.ExpectedChallenge),
            RpId = ceremony.ExpectedRelyingPartyId,
            AllowCredentials = [new PublicKeyCredentialDescriptor(ceremony.CredentialId)],
            UserVerification = UserVerificationRequirement.Required,
        };

        try
        {
            await CreateFido2(ceremony.ExpectedRelyingPartyId, ceremony.ExpectedOrigin)
                .MakeAssertionAsync(
                    new MakeAssertionParams
                    {
                        AssertionResponse = new AuthenticatorAssertionRawResponse
                        {
                            Id = Base64Url.EncodeToString(ceremony.CredentialId),
                            RawId = ceremony.CredentialId,
                            Type = PublicKeyCredentialType.PublicKey,
                            Response = new AuthenticatorAssertionRawResponse.AssertionResponse
                            {
                                AuthenticatorData = ceremony.AuthenticatorData,
                                ClientDataJson = ceremony.ClientDataJson,
                                Signature = ceremony.Signature,
                                UserHandle = ceremony.UserHandle,
                            },
                        },
                        OriginalOptions = options,
                        StoredPublicKey = ceremony.StoredCosePublicKey,
                        StoredSignatureCounter = ceremony.StoredSignCount,
                        // Unconditionally true by design: account binding already happened via the magic link.
                        IsUserHandleOwnerOfCredentialIdCallback = (_, _) => Task.FromResult(true),
                    },
                    cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Fido2VerificationException exception)
        {
            return WebAuthnAssertionResult.Failure(Classify(exception.Code));
        }
        catch (InvalidOperationException)
        {
            return WebAuthnAssertionResult.Failure(WebAuthnCeremonyFailureReason.MalformedResponse);
        }

        return WebAuthnAssertionResult.Success(newSignCount);
    }

    // 0-to-0 is the one legitimate exception: some authenticators never count and report 0
    // forever. Any other non-increasing transition (e.g. 5-to-0, 5-to-5) signals a clone/replay.
    private static bool HasAdvanced(uint newSignCount, uint storedSignCount) =>
        newSignCount > storedSignCount || (newSignCount == 0 && storedSignCount == 0);

    private static Fido2 CreateFido2(string relyingPartyId, string origin) =>
        new(new Fido2Configuration
        {
            ServerDomain = relyingPartyId,
            ServerName = relyingPartyId,
            Origins = new HashSet<string>(StringComparer.Ordinal) { origin },
        });

    private static WebAuthnCeremonyFailureReason? ValidateClientData(
        byte[] clientDataJson,
        string expectedType,
        string expectedChallenge,
        string expectedOrigin)
    {
        string? type = null;
        string? challenge = null;
        string? origin = null;

        try
        {
            using var document = JsonDocument.Parse(clientDataJson);

            foreach (var member in document.RootElement.EnumerateObject())
            {
                switch (member.Name)
                {
                    case "type":
                        type = member.Value.GetString();
                        break;
                    case "challenge":
                        challenge = member.Value.GetString();
                        break;
                    case "origin":
                        origin = member.Value.GetString();
                        break;
                }
            }
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException)
        {
            return WebAuthnCeremonyFailureReason.MalformedResponse;
        }

        if (!string.Equals(type, expectedType, StringComparison.Ordinal))
        {
            return WebAuthnCeremonyFailureReason.CeremonyTypeMismatch;
        }

        if (!string.Equals(challenge, expectedChallenge, StringComparison.Ordinal))
        {
            return WebAuthnCeremonyFailureReason.ChallengeMismatch;
        }

        if (!string.Equals(origin, expectedOrigin, StringComparison.Ordinal))
        {
            return WebAuthnCeremonyFailureReason.OriginMismatch;
        }

        return null;
    }

    // InvalidOperationException is caught separately at each call site: Fido2NetLib 4.0.1 lets
    // one escape on attacker-controlled input (a COSE key whose kty/alg disagree), so without
    // that catch a hostile client could turn a rejected ceremony into an unhandled exception.
    private static WebAuthnCeremonyFailureReason Classify(Fido2ErrorCode code) => code switch
    {
        Fido2ErrorCode.InvalidRpidHash => WebAuthnCeremonyFailureReason.RelyingPartyMismatch,
        Fido2ErrorCode.UserPresentFlagNotSet => WebAuthnCeremonyFailureReason.UserNotPresent,
        Fido2ErrorCode.UserVerificationRequirementNotMet => WebAuthnCeremonyFailureReason.UserNotVerified,
        Fido2ErrorCode.CredentialAlgorithmRequirementNotMet or Fido2ErrorCode.UnimplementedAlgorithm =>
            WebAuthnCeremonyFailureReason.UnsupportedAlgorithm,
        Fido2ErrorCode.InvalidSignature => WebAuthnCeremonyFailureReason.InvalidSignature,
        _ => WebAuthnCeremonyFailureReason.MalformedResponse,
    };
}
