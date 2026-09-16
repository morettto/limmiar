namespace Api.Accounts;

/// <summary>
/// The account's static X25519 key pair (ADR-S11-06): <see cref="PublicKey"/> travels in the
/// clear (it is what a peer encrypts to); the private key never leaves this envelope unsealed
/// -- <see cref="WrappedDek"/> and <see cref="SealedPrivateKey"/> are the same DEK/KEK envelope
/// shape as <see cref="VoiceEnrollment"/>, one field on <see cref="Account"/> so the three parts
/// always travel together.
/// </summary>
public sealed record AccountKeyPair(byte[] PublicKey, byte[] WrappedDek, byte[] SealedPrivateKey);
