namespace Api.Consent;

/// <summary>
/// The closed set of purposes a consent decision can apply to, each with a real, distinct
/// consumer (the microphone gate, the copilot). Ordinal value is what the
/// <c>consent_purpose_range</c> CHECK constraint on <c>consent_events</c> allows.
/// </summary>
public enum ConsentPurpose
{
    Gravacao,
    AnaliseIa,
}

/// <summary>
/// The decision a single consent event records. Ordinal value is what the
/// <c>consent_decision_range</c> CHECK constraint on <c>consent_events</c> allows.
/// </summary>
public enum ConsentDecision
{
    Concedido,
    Revogado,
}

/// <summary>
/// The current state for a (patient, purpose) pair, derived by folding the event log --
/// never a column of its own, see <see cref="ConsentState.Fold"/>.
/// </summary>
public enum ConsentStatus
{
    Pendente,
    Concedido,
    Revogado,
}

/// <summary>
/// One row of the append-only <c>consent_events</c> log: "this decision, for this purpose,
/// at this instant." Revoking is an INSERT, never an UPDATE -- the log itself is the audit
/// trail for the decision, and the current state is always a fold over it
/// (<see cref="ConsentState.Fold"/>), never stored directly.
/// </summary>
public sealed record ConsentEvent(
    Guid TenantId,
    Guid PatientId,
    ConsentPurpose Purpose,
    ConsentDecision Decision,
    DateTimeOffset RecordedAt);
