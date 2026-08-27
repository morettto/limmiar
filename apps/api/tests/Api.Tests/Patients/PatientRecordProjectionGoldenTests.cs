using Api.Patients;

namespace Api.Tests.Patients;

/// <summary>
/// Golden master for <see cref="PatientRecordProjection.Project"/> over a fixed set of
/// entries -- literal expected values, no snapshot library (Api.Tests has none, and this
/// shape is small/fixed enough that a hand-rolled assertion is cheaper and clearer).
/// </summary>
public sealed class PatientRecordProjectionGoldenTests
{
    private static readonly Guid PatientId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid TenantId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static readonly Guid EntryId1 = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly Guid EntryId2 = Guid.Parse("00000000-0000-0000-0000-000000000002");
    private static readonly Guid EntryId3 = Guid.Parse("00000000-0000-0000-0000-000000000003");

    private static readonly byte[] WrappedDek = [0x01, 0x02, 0x03];
    private static readonly byte[] Ciphertext1 = [0xA1];
    private static readonly byte[] Ciphertext2 = [0xA2];
    private static readonly byte[] Ciphertext3 = [0xA3];

    private static readonly DateTimeOffset CreatedAt1 = new(2026, 1, 1, 10, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset CreatedAt2 = new(2026, 1, 2, 10, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset CreatedAt3 = new(2026, 1, 3, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Project_WithFixedEntrySet_ReturnsExpectedRecord()
    {
        var entries = new List<PatientRecordEntry>
        {
            new(EntryId1, TenantId, PatientId, 1, WrappedDek, Ciphertext1, CreatedAt1),
            new(EntryId2, TenantId, PatientId, 2, null, Ciphertext2, CreatedAt2),
            new(EntryId3, TenantId, PatientId, 3, null, Ciphertext3, CreatedAt3),
        };

        var record = PatientRecordProjection.Project(entries);

        Assert.NotNull(record);
        Assert.Equal(PatientId, record!.PatientId);
        Assert.Equal(WrappedDek, record.WrappedDek);
        Assert.Equal(CreatedAt1, record.CreatedAt);
        Assert.Equal(CreatedAt3, record.LastEntryAt);
        Assert.Equal(3, record.Entries.Count);
        Assert.Equal(EntryId1, record.Entries[0].Id);
        Assert.Equal(1, record.Entries[0].Sequence);
        Assert.Equal(EntryId2, record.Entries[1].Id);
        Assert.Equal(2, record.Entries[1].Sequence);
        Assert.Equal(EntryId3, record.Entries[2].Id);
        Assert.Equal(3, record.Entries[2].Sequence);
    }

    [Fact]
    public void Project_WithOutOfOrderInput_StillSortsBySequence()
    {
        var entries = new List<PatientRecordEntry>
        {
            new(EntryId3, TenantId, PatientId, 3, null, Ciphertext3, CreatedAt3),
            new(EntryId1, TenantId, PatientId, 1, WrappedDek, Ciphertext1, CreatedAt1),
            new(EntryId2, TenantId, PatientId, 2, null, Ciphertext2, CreatedAt2),
        };

        var record = PatientRecordProjection.Project(entries);

        Assert.NotNull(record);
        Assert.Equal([1, 2, 3], record!.Entries.Select(e => e.Sequence));
        Assert.Equal(CreatedAt1, record.CreatedAt);
        Assert.Equal(CreatedAt3, record.LastEntryAt);
    }

    [Fact]
    public void Project_WithEmptyList_ReturnsNull()
    {
        Assert.Null(PatientRecordProjection.Project([]));
    }

    [Fact]
    public void Project_WithNoSequence1Entry_ReturnsNull()
    {
        var entries = new List<PatientRecordEntry>
        {
            new(EntryId2, TenantId, PatientId, 2, null, Ciphertext2, CreatedAt2),
            new(EntryId3, TenantId, PatientId, 3, null, Ciphertext3, CreatedAt3),
        };

        Assert.Null(PatientRecordProjection.Project(entries));
    }

    /// <summary>Sequence-1 present but missing its wrapped DEK -- distinct branch from Project_WithNoSequence1Entry_ReturnsNull (which has no sequence-1 row at all). The DB's wrapped_dek_only_on_sequence_1 CHECK constraint prevents this shape at the source, but Project is a pure function tested independently of that guarantee.</summary>
    [Fact]
    public void Project_WithSequence1MissingWrappedDek_ReturnsNull()
    {
        var entries = new List<PatientRecordEntry>
        {
            new(EntryId1, TenantId, PatientId, 1, null, Ciphertext1, CreatedAt1),
        };

        Assert.Null(PatientRecordProjection.Project(entries));
    }
}
