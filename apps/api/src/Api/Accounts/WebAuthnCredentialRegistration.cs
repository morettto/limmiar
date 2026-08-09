namespace Api.Accounts;

/// <summary>
/// The credential material a successful registration ceremony produces, i.e. exactly what an
/// account record has to persist for later assertions to be verifiable.
/// </summary>
/// <param name="CredentialId">
/// The authenticator-chosen credential id, read out of the attested credential data (NOT
/// echoed from <see cref="WebAuthnRegistrationCeremony.CredentialId"/>) -- the signed copy is
/// the authoritative one. This is the lookup key an assertion arrives with.
/// </param>
/// <param name="CosePublicKey">
/// The credential's public key as raw COSE_Key CBOR bytes, stored verbatim.
///
/// Storage-shape decision (S02-05): the alternative was decomposing the key into its P-256
/// X/Y coordinates so assertions need no CBOR parse. That would be the cheaper shape for a
/// hand-rolled verifier, but this verifier delegates the signature check to Fido2NetLib,
/// whose assertion API consumes COSE bytes directly -- storing X/Y would mean re-encoding
/// them back into a COSE map on every single assertion, which is strictly more work than
/// storing the bytes the library already produced. Keeping the COSE encoding also means the
/// stored value stays self-describing (it carries its own <c>kty</c>/<c>alg</c>/<c>crv</c>),
/// so a future ticket that widens beyond ES256 changes no persisted column.
/// </param>
/// <param name="SignCount">
/// The authenticator's signature counter at registration time -- the baseline every later
/// assertion has to strictly advance past. Frequently 0, which is legitimate and is why
/// <see cref="WebAuthnCeremonyVerifier.HasAdvanced"/> carves out the 0-to-0 case.
/// </param>
/// <param name="AaGuid">
/// Identifies the authenticator MODEL (not the device): all-zero for the <c>none</c>
/// attestation this ceremony asks for, which is the expected value here and is why nothing
/// keys off it. Surfaced only so a later ticket that turns attestation on does not have to
/// reshape this record.
/// </param>
public sealed record WebAuthnCredentialRegistration(
    byte[] CredentialId,
    byte[] CosePublicKey,
    uint SignCount,
    Guid AaGuid);
