using Api.Consent;

namespace Api.Tests.Consent;

/// <summary>
/// ConsentState.Fold is pure -- zero I/O, zero DI -- so every test here runs without
/// Testcontainers. Events are always built oldest-first, the order
/// <c>ConsentEventStore.ListAsync</c> returns (see the parameter doc on <see cref="ConsentState.Fold"/>).
/// </summary>
public sealed class ConsentStateTests
{
    private static readonly Guid TenantId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid PatientId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly DateTimeOffset T0 = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Fold_WithNoEvents_IsPendente()
    {
        var status = ConsentState.Fold([], ConsentPurpose.Gravacao);

        Assert.Equal(ConsentStatus.Pendente, status);
    }

    [Fact]
    public void Fold_AfterGrantThenRevoke_IsRevogado()
    {
        var events = new[]
        {
            Event(ConsentPurpose.Gravacao, ConsentDecision.Concedido, T0),
            Event(ConsentPurpose.Gravacao, ConsentDecision.Revogado, T0.AddMinutes(1)),
        };

        var status = ConsentState.Fold(events, ConsentPurpose.Gravacao);

        Assert.Equal(ConsentStatus.Revogado, status);
        // Sanity check that the event carries the identity it was constructed with -- the
        // tenant/patient a real caller filters by before this fold ever runs.
        Assert.Equal(TenantId, events[0].TenantId);
        Assert.Equal(PatientId, events[0].PatientId);
    }

    [Fact]
    public void Fold_AfterRevokeThenGrantAgain_IsConcedido()
    {
        var events = new[]
        {
            Event(ConsentPurpose.Gravacao, ConsentDecision.Concedido, T0),
            Event(ConsentPurpose.Gravacao, ConsentDecision.Revogado, T0.AddMinutes(1)),
            Event(ConsentPurpose.Gravacao, ConsentDecision.Concedido, T0.AddMinutes(2)),
        };

        var status = ConsentState.Fold(events, ConsentPurpose.Gravacao);

        Assert.Equal(ConsentStatus.Concedido, status);
    }

    [Fact]
    public void Fold_RevokingOnePurpose_LeavesTheOtherGranted()
    {
        var events = new[]
        {
            Event(ConsentPurpose.Gravacao, ConsentDecision.Concedido, T0),
            Event(ConsentPurpose.AnaliseIa, ConsentDecision.Concedido, T0.AddMinutes(1)),
            Event(ConsentPurpose.Gravacao, ConsentDecision.Revogado, T0.AddMinutes(2)),
        };

        var gravacao = ConsentState.Fold(events, ConsentPurpose.Gravacao);
        var analiseIa = ConsentState.Fold(events, ConsentPurpose.AnaliseIa);

        Assert.Equal(ConsentStatus.Revogado, gravacao);
        Assert.Equal(ConsentStatus.Concedido, analiseIa);
    }

    private static ConsentEvent Event(ConsentPurpose purpose, ConsentDecision decision, DateTimeOffset recordedAt) =>
        new(TenantId, PatientId, purpose, decision, recordedAt);
}
