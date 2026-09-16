using Api.Accounts;
using Api.Platform;

namespace Api.PatientLinks;

public enum CreateInviteFailure
{
    AccountNotFound,

    NotAuthorized,
}

/// <summary>Same shape as <see cref="AccountKeyPair"/>: the fields the client needs to encrypt/decrypt to the peer, never the peer's private material.</summary>
public sealed record LinkView(Guid ProfessionalAccountId, Guid PatientAccountId, Guid PatientId, DateTimeOffset LinkedAt, byte[]? PeerPublicKey);

/// <summary>
/// Role checks and account lookups around <see cref="PatientLinkStore"/>: the store knows
/// nothing about accounts or roles, only codes and pairs of ids.
/// </summary>
public sealed class PatientLinkService(IAccountStore accounts, PatientLinkStore links)
{
    /// <summary>Same guard as ConsentService.RecordAsync/NoteService.SignAsync: generating an invite for a patientId carries the same authorization risk as creating a patient record.</summary>
    public async Task<Result<LinkInvite, CreateInviteFailure>> CreateInviteAsync(
        Guid professionalAccountId, Guid patientId, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(professionalAccountId, cancellationToken);
        if (account is null)
        {
            return CreateInviteFailure.AccountNotFound;
        }

        if (!AccountAuthorizationGuard.CanCreatePatientRecords(account))
        {
            return CreateInviteFailure.NotAuthorized;
        }

        return await links.CreateInviteAsync(professionalAccountId, patientId, cancellationToken);
    }

    public async Task<Result<LinkView, RedeemFailure>> RedeemAsync(
        Guid patientAccountId, string code, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(patientAccountId, cancellationToken);
        if (account is null)
        {
            return RedeemFailure.AccountNotFound;
        }

        if (account.Role != AccountRole.Patient)
        {
            return RedeemFailure.NotAPatient;
        }

        var redeemResult = await links.RedeemWithPeerKeyAsync(code, patientAccountId, cancellationToken);
        return await redeemResult.Match<Task<Result<LinkView, RedeemFailure>>>(
            async link =>
            {
                return new LinkView(link.Link.ProfessionalAccountId, link.Link.PatientAccountId, link.Link.PatientId, link.Link.LinkedAt, link.PeerPublicKey);
            },
            failure => Task.FromResult<Result<LinkView, RedeemFailure>>(failure));
    }

    public async Task<IReadOnlyList<LinkView>> ListAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var views = new List<LinkView>();
        foreach (var link in await links.ListForWithPeerKeyAsync(accountId, cancellationToken))
        {
            views.Add(new LinkView(link.Link.ProfessionalAccountId, link.Link.PatientAccountId, link.Link.PatientId, link.Link.LinkedAt, link.PeerPublicKey));
        }

        return views;
    }

    public async Task<bool> UnlinkAsync(Guid accountId, Guid peerAccountId, CancellationToken cancellationToken) =>
        await links.UnlinkAsync(accountId, peerAccountId, cancellationToken);

}
