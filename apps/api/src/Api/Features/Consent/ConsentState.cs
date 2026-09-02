namespace Api.Consent;

/// <summary>
/// Pure fold over the consent event log -- zero I/O, zero DI, so the current state for a
/// (patient, purpose) pair is always recomputable from nothing but the events themselves
/// (molde <see cref="Api.Audit.AuditChain"/>). Revoking never deletes or overwrites the
/// earlier grant; it appends a new event that outranks it in the fold, which is what makes
/// "revocation does not affect the past action" structural instead of an application rule.
/// </summary>
public static class ConsentState
{
    /// <param name="events">mais antigo primeiro, como ConsentEventStore.ListAsync devolve.</param>
    public static ConsentStatus Fold(IReadOnlyList<ConsentEvent> events, ConsentPurpose purpose)
    {
        var latest = events.LastOrDefault(evt => evt.Purpose == purpose);

        if (latest is null)
        {
            return ConsentStatus.Pendente;
        }

        return latest.Decision == ConsentDecision.Concedido
            ? ConsentStatus.Concedido
            : ConsentStatus.Revogado;
    }
}
