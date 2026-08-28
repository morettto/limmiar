using System.Buffers.Binary;
using System.Security.Cryptography;

namespace Api.Audit;

/// <summary>
/// Pure hash-chain math for the audit trail -- zero I/O, zero DI, so every entry's integrity
/// can be recomputed by any future verifier from nothing but the seven columns of
/// <c>audit_entries</c> (see ADR-S10-01 for why exactly these seven, in this order).
/// </summary>
public static class AuditChain
{
    private static readonly byte[] Zeros32 = new byte[32];

    /// <summary>The chain's root: 32 zero bytes, never NULL -- a NULL previous_hash would let
    /// two concurrent genesis inserts both pass the <c>UNIQUE (tenant_id, previous_hash)</c>
    /// constraint, since NULL != NULL in a unique index.</summary>
    public static ReadOnlySpan<byte> GenesisHash => Zeros32;

    /// <summary>
    /// SHA-256 over the 82-byte, fixed-width, big-endian preamble:
    /// previous_hash(32) | tenant_id(16) | sequence(8) | action(2) | device_id(16) | recorded_at(8).
    /// Fixed widths for every field make this concatenation unambiguous without a separator
    /// or a length prefix. <paramref name="recordedAt"/> is encoded as microseconds since the
    /// Unix epoch, not <see cref="DateTimeOffset.Ticks"/>, so the hash does not depend on the
    /// .NET tick resolution of whichever runtime recomputes it later.
    /// </summary>
    public static byte[] ComputeHash(
        Guid tenantId,
        long sequence,
        AuditAction action,
        Guid deviceId,
        DateTimeOffset recordedAt,
        ReadOnlySpan<byte> previousHash)
    {
        Span<byte> preamble = stackalloc byte[82];

        previousHash.CopyTo(preamble[..32]);
        tenantId.TryWriteBytes(preamble.Slice(32, 16), bigEndian: true, out _);
        BinaryPrimitives.WriteInt64BigEndian(preamble.Slice(48, 8), sequence);
        BinaryPrimitives.WriteInt16BigEndian(preamble.Slice(56, 2), (short)action);
        deviceId.TryWriteBytes(preamble.Slice(58, 16), bigEndian: true, out _);
        var microsecondsSinceEpoch = (recordedAt - DateTimeOffset.UnixEpoch).Ticks / 10;
        BinaryPrimitives.WriteInt64BigEndian(preamble.Slice(74, 8), microsecondsSinceEpoch);

        return SHA256.HashData(preamble);
    }

    /// <summary>
    /// Walks the chain from genesis, recomputing each entry's hash and checking it links to
    /// the one before it. Stops at the first break -- acceptance criterion 1's "a partir daí":
    /// once one entry is wrong, every claim after it is unproven, so nothing past the break is
    /// worth reporting separately.
    /// </summary>
    /// <remarks>
    /// <paramref name="anchors"/> is accepted now to match the ticket's fixed signature but not
    /// yet consulted -- <see cref="AuditBreakKind.AnchorMismatch"/> is wired in by fatia 7
    /// (out of this session's scope), which owns the concurrency/anchor slices of S10-01.
    /// </remarks>
    public static AuditVerification Verify(IReadOnlyList<AuditEntry> chain, IReadOnlyList<AuditAnchor> anchors)
    {
        var expectedPreviousHash = GenesisHash.ToArray();

        foreach (var entry in chain)
        {
            if (!entry.PreviousHash.AsSpan().SequenceEqual(expectedPreviousHash))
            {
                return AuditVerification.Broken(entry.Sequence, AuditBreakKind.BrokenLink);
            }

            var recomputedHash = ComputeHash(entry.TenantId, entry.Sequence, entry.Action, entry.DeviceId, entry.RecordedAt, entry.PreviousHash);
            if (!CryptographicOperations.FixedTimeEquals(recomputedHash, entry.EntryHash))
            {
                return AuditVerification.Broken(entry.Sequence, AuditBreakKind.HashMismatch);
            }

            expectedPreviousHash = entry.EntryHash;
        }

        return AuditVerification.Ok();
    }
}
