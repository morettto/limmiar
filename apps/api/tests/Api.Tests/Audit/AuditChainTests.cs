using Api.Audit;

namespace Api.Tests.Audit;

/// <summary>
/// AuditChain.ComputeHash/Verify are pure -- zero I/O, zero DI -- so every test here runs
/// without Testcontainers. Fixed inputs, not random ones: a hash function's contract is
/// "same bytes in, same bytes out", and fixed inputs make a failing assertion reproducible.
/// </summary>
public sealed class AuditChainTests
{
    private static readonly Guid TenantId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid DeviceId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly DateTimeOffset RecordedAt = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly byte[] PreviousHash = AuditChain.GenesisHash.ToArray();

    [Theory]
    [InlineData("TenantId")]
    [InlineData("Sequence")]
    [InlineData("Action")]
    [InlineData("DeviceId")]
    [InlineData("RecordedAt")]
    [InlineData("PreviousHash")]
    public void ComputeHash_WhenAnySingleFieldDiffers_ProducesADifferentHash(string variedField)
    {
        var baseline = AuditChain.ComputeHash(TenantId, 1, AuditAction.SignIn, DeviceId, RecordedAt, PreviousHash);

        var varied = variedField switch
        {
            "TenantId" => AuditChain.ComputeHash(Guid.Parse("99999999-9999-9999-9999-999999999999"), 1, AuditAction.SignIn, DeviceId, RecordedAt, PreviousHash),
            "Sequence" => AuditChain.ComputeHash(TenantId, 2, AuditAction.SignIn, DeviceId, RecordedAt, PreviousHash),
            "Action" => AuditChain.ComputeHash(TenantId, 1, AuditAction.SignOut, DeviceId, RecordedAt, PreviousHash),
            "DeviceId" => AuditChain.ComputeHash(TenantId, 1, AuditAction.SignIn, Guid.Parse("88888888-8888-8888-8888-888888888888"), RecordedAt, PreviousHash),
            "RecordedAt" => AuditChain.ComputeHash(TenantId, 1, AuditAction.SignIn, DeviceId, RecordedAt.AddSeconds(1), PreviousHash),
            "PreviousHash" => AuditChain.ComputeHash(TenantId, 1, AuditAction.SignIn, DeviceId, RecordedAt, Enumerable.Repeat((byte)0xFF, 32).ToArray()),
            _ => throw new ArgumentOutOfRangeException(nameof(variedField)),
        };

        Assert.NotEqual(baseline, varied);
    }

    [Fact]
    public void Verify_WhenChainIsIntact_ReportsOk()
    {
        var entries = BuildIntactChain(3);

        var result = AuditChain.Verify(entries, []);

        Assert.True(result.Intact);
        Assert.Null(result.FirstBrokenSequence);
        Assert.Null(result.BreakKind);
    }

    /// <summary>Content tampered in place, stored EntryHash left stale -- Critério de aceite 1:
    /// verification must fail from the tampered sequence onward.</summary>
    [Fact]
    public void Verify_WhenEntryKIsTampered_ReportsFirstBrokenSequenceK()
    {
        var entries = BuildIntactChain(3);
        entries[1] = entries[1] with { Action = AuditAction.SignOut };

        var result = AuditChain.Verify(entries, []);

        Assert.False(result.Intact);
        Assert.Equal(2, result.FirstBrokenSequence);
        Assert.Equal(AuditBreakKind.HashMismatch, result.BreakKind);
    }

    /// <summary>PreviousHash pointer rewritten to no longer match the prior entry's EntryHash --
    /// the link check must catch this before ever recomputing the entry's own hash.</summary>
    [Fact]
    public void Verify_WhenPreviousHashPointerIsTampered_ReportsBrokenLink()
    {
        var entries = BuildIntactChain(3);
        entries[2] = entries[2] with { PreviousHash = Enumerable.Repeat((byte)0xAB, 32).ToArray() };

        var result = AuditChain.Verify(entries, []);

        Assert.False(result.Intact);
        Assert.Equal(3, result.FirstBrokenSequence);
        Assert.Equal(AuditBreakKind.BrokenLink, result.BreakKind);
    }

    /// <summary>Fatia 7, critério 3: the chain is internally coherent -- every hash recomputes,
    /// every link points where it should -- and the only thing that gives the rewrite away is
    /// the anchor captured beforehand: the entry at AnchoredSequence no longer carries the hash
    /// the witness recorded.</summary>
    [Fact]
    public void Verify_WhenTheAnchoredEntryNoLongerCarriesTheAnchoredHash_ReportsAnchorMismatch()
    {
        var entries = BuildIntactChain(3);
        var anchors = new[] { new AuditAnchor(TenantId, 3, Enumerable.Repeat((byte)0xCD, 32).ToArray(), RecordedAt) };

        var result = AuditChain.Verify(entries, anchors);

        Assert.False(result.Intact);
        Assert.Equal(3, result.FirstBrokenSequence);
        Assert.Equal(AuditBreakKind.AnchorMismatch, result.BreakKind);
    }

    /// <summary>Truncation is a rewrite too: dropping every entry after the anchor leaves a
    /// chain that walks intact from genesis, so the anchor pointing at a sequence that no
    /// longer exists is the only remaining evidence. A missing entry cannot carry the
    /// anchored hash, so it is the same break as a rewritten one.</summary>
    [Fact]
    public void Verify_WhenTheAnchoredEntryIsMissingFromTheChain_ReportsAnchorMismatch()
    {
        var entries = BuildIntactChain(3);
        var anchors = new[] { new AuditAnchor(TenantId, 3, entries[2].EntryHash, RecordedAt) };
        entries.RemoveAt(2);

        var result = AuditChain.Verify(entries, anchors);

        Assert.False(result.Intact);
        Assert.Equal(3, result.FirstBrokenSequence);
        Assert.Equal(AuditBreakKind.AnchorMismatch, result.BreakKind);
    }

    /// <summary>Detection order, locked: a break inside the chain wins over a violated anchor.
    /// The anchor is the net for a rewrite that leaves no internal break at all, so reporting
    /// it ahead of a stale hash would point at the anchored sequence instead of at the entry
    /// that is actually wrong (criterion 1's "a partir daí").</summary>
    [Fact]
    public void Verify_WhenBothAnEntryAndItsAnchorAreViolated_ReportsTheChainBreakNotTheAnchor()
    {
        var entries = BuildIntactChain(3);
        var anchors = new[] { new AuditAnchor(TenantId, 3, Enumerable.Repeat((byte)0xCD, 32).ToArray(), RecordedAt) };
        entries[1] = entries[1] with { Action = AuditAction.SignOut };

        var result = AuditChain.Verify(entries, anchors);

        Assert.Equal(2, result.FirstBrokenSequence);
        Assert.Equal(AuditBreakKind.HashMismatch, result.BreakKind);
    }

    private static List<AuditEntry> BuildIntactChain(int count)
    {
        var entries = new List<AuditEntry>();
        var previousHash = AuditChain.GenesisHash.ToArray();

        for (long sequence = 1; sequence <= count; sequence++)
        {
            var entryHash = AuditChain.ComputeHash(TenantId, sequence, AuditAction.SignIn, DeviceId, RecordedAt, previousHash);
            entries.Add(new AuditEntry(TenantId, sequence, AuditAction.SignIn, DeviceId, RecordedAt, previousHash, entryHash));
            previousHash = entryHash;
        }

        return entries;
    }
}
