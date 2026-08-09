using System.Buffers.Binary;
using System.Buffers.Text;
using System.Text.Json;
using Fido2NetLib;
using Fido2NetLib.Exceptions;
using Fido2NetLib.Objects;

namespace Api.Accounts;

/// <summary>
/// <see cref="IWebAuthnCeremonyVerifier"/> on top of Fido2NetLib (package <c>Fido2</c> 4.0.1).
///
/// Why a library and not a hand-rolled verifier: the whole project publishes with
/// <c>PublishAot=true</c> and CI fails on any trim/AOT warning, which rules out most auth
/// libraries -- but Fido2NetLib 4.x is AOT-clean (it ships its own
/// <c>System.Text.Json</c> source-generated contexts and parses CBOR without reflection), so
/// a Native AOT publish of this project stays at zero IL warnings with it referenced.
///
/// What this class still does itself, rather than delegating:
/// <list type="bullet">
/// <item>clientDataJSON (<c>type</c>/<c>challenge</c>/<c>origin</c>) -- so each failure maps
/// to a precise <see cref="WebAuthnCeremonyFailureReason"/> instead of one library exception
/// whose only distinguishing feature is an English message.</item>
/// <item>the signature counter rule -- see <see cref="HasAdvanced"/>, which is strictly
/// stricter than the library's.</item>
/// </list>
/// Everything below that (CBOR attestation object, COSE key decoding, RP ID hash, UP/UV
/// flags, and the ECDSA signature over <c>authenticatorData || SHA-256(clientDataJSON)</c>)
/// is the library's.
/// </summary>
public sealed class WebAuthnCeremonyVerifier : IWebAuthnCeremonyVerifier
{
    /// <summary>
    /// The only credential algorithm offered or accepted: ES256 (COSE alg -7, ECDSA on P-256
    /// with SHA-256). Every platform authenticator S02-05 targets -- Face ID, Touch ID,
    /// Windows Hello -- produces ES256 by default, as do the virtual authenticators the E2E
    /// suite drives. Offering RS256/EdDSA as well would widen the verification surface for
    /// credentials nothing in this product actually creates.
    /// </summary>
    private static readonly IReadOnlyList<PubKeyCredParam> Es256Only =
        [new PubKeyCredParam(COSE.Algorithm.ES256, PublicKeyCredentialType.PublicKey)];

    /// <summary>
    /// Both ceremonies demand User Verification, not merely User Presence.
    ///
    /// This is the judgment call S02-05 hinges on. User Presence (UP) only proves someone
    /// touched the authenticator; User Verification (UV) proves the authenticator ran a
    /// biometric or PIN gesture and it succeeded. The ticket is "magic-link login + device
    /// BIOMETRIC confirmation": a UP-only assertion would let anyone holding an unlocked
    /// phone that once received a magic link complete the confirmation step, which is exactly
    /// the threat the second factor exists to stop. Platform authenticators always report UV
    /// for the ceremonies this product triggers, so requiring it costs no real-world
    /// compatibility -- the only authenticators it excludes (UP-only security keys with no
    /// PIN) are ones this flow never offers.
    /// </summary>
    private static readonly AuthenticatorSelection PlatformAuthenticatorWithUserVerification = new()
    {
        AuthenticatorAttachment = Fido2NetLib.Objects.AuthenticatorAttachment.Platform,
        ResidentKey = ResidentKeyRequirement.Discouraged,
        UserVerification = UserVerificationRequirement.Required,
    };

    /// <summary>
    /// Authenticator data is <c>rpIdHash(32) || flags(1) || signCount(4)</c> before any
    /// optional attested-credential/extension tail, so 37 bytes is the floor below which
    /// there is nothing to read.
    /// </summary>
    private const int AuthenticatorDataMinimumLength = 37;

    private const int SignCountOffset = 33;

    /// <summary>
    /// Placeholder user handle. Fido2NetLib's registration path insists on a
    /// <see cref="Fido2User"/> because it offers to check credential-id uniqueness per user;
    /// this verifier does no such lookup (see
    /// <see cref="IWebAuthnCeremonyVerifier"/> -- account binding is the caller's job), so the
    /// value is never compared against anything and never leaves this class.
    /// </summary>
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

        // Read straight out of the signed authenticator data rather than waiting for the
        // library's own (laxer) counter check, so the rule below is the only one that ever
        // decides -- see HasAdvanced.
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
                        // Unconditionally true by design, not by omission -- see
                        // WebAuthnAssertionCeremony.UserHandle for why this verifier does not
                        // re-derive the credential-to-account binding from a client-supplied
                        // handle. The library only invokes this when a handle is present.
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

    /// <summary>
    /// WebAuthn L3 section 6.1.1's cloned-authenticator signal: a counter that does not
    /// strictly advance means the same credential was used twice from what the authenticator
    /// believes is the same point in its own history -- either a replayed assertion or a
    /// cloned key.
    ///
    /// The one legitimate exception is an authenticator that does not count at all and
    /// reports 0 forever (the spec explicitly permits it, and several platform authenticators
    /// do exactly this). 0-to-0 therefore passes, while 5-to-0 and 5-to-5 do not: an
    /// authenticator that once reported a non-zero counter must keep advancing it.
    ///
    /// This is deliberately stricter than Fido2NetLib's own check, which ignores an incoming
    /// counter of 0 outright and would let 5-to-0 through.
    /// </summary>
    private static bool HasAdvanced(uint newSignCount, uint storedSignCount) =>
        newSignCount > storedSignCount || (newSignCount == 0 && storedSignCount == 0);

    /// <summary>
    /// A fresh instance per call: Fido2NetLib binds the expected RP id and origin to the
    /// configuration object rather than to the ceremony, while
    /// <see cref="IWebAuthnCeremonyVerifier"/> takes both per ceremony (so a single
    /// registered service can serve several hosts, and so tests can vary them freely).
    /// Construction is a plain object allocation -- no I/O, no key material, no metadata
    /// service is attached.
    /// </summary>
    private static Fido2 CreateFido2(string relyingPartyId, string origin) =>
        new(new Fido2Configuration
        {
            ServerDomain = relyingPartyId,
            ServerName = relyingPartyId,
            Origins = new HashSet<string>(StringComparer.Ordinal) { origin },
        });

    /// <summary>
    /// Parses clientDataJSON and holds it to the three values the server chose.
    ///
    /// The challenge is compared as the base64url text the browser wrote, using an ordinary
    /// ordinal comparison: it is a server-issued public nonce that the client already holds,
    /// so there is no secret for a timing side-channel to leak (unlike
    /// <see cref="ConstantTimePasswordVerifierComparer"/>, where both sides are secret).
    /// </summary>
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

            // EnumerateObject throws if the root is not an object, and GetString throws if a
            // member is not a string -- both land in the catch below as a malformed response.
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

    /// <summary>
    /// Maps the library's typed error codes onto this module's vocabulary. Only the codes the
    /// checks above can actually still reach are listed: clientDataJSON codes never arrive
    /// here (already handled), and neither does <c>InvalidSignCount</c> (the counter rule in
    /// <see cref="HasAdvanced"/> is strictly stricter, so the library's own check can no
    /// longer be the first to fail).
    ///
    /// The separate <see cref="InvalidOperationException"/> catch at each call site is not
    /// belt-and-braces: Fido2NetLib 4.0.1 lets a plain <see cref="InvalidOperationException"/>
    /// escape when a COSE key's <c>kty</c> and <c>alg</c> disagree (an EC2 key labelled
    /// RS256, say), which is attacker-controlled input, so without that catch a hostile
    /// client could turn a rejected ceremony into an unhandled exception.
    /// </summary>
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
