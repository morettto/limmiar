namespace Api.Accounts;

public sealed record PatientAccessInvitation(string Code, Guid ProfessionalAccountId, Guid PatientId, Guid? PatientAccountId);

public interface IAnonymousPatientAccessStore
{
    Task<PatientAccessInvitation?> FindInvitationAsync(string code, CancellationToken cancellationToken);

    Task<bool> RegisterAsync(PatientAccessInvitation invitation, Account account, CancellationToken cancellationToken);

    Task<bool> AssertAsync(PatientAccessInvitation invitation, Account account, uint expectedSignCount, CancellationToken cancellationToken);
}
