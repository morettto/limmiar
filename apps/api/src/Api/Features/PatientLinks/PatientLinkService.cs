using Api.Accounts;
using Api.Platform;

namespace Api.PatientLinks;

public enum CreateInviteFailure
{
    AccountNotFound,

    NotAuthorized,
}

public enum RedeemLinkFailure
{
    AccountNotFound,

    NotAPatient,

    InviteNotFound,

    AlreadyLinked,
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

        return links.CreateInvite(professionalAccountId, patientId);
    }

    public async Task<Result<LinkView, RedeemLinkFailure>> RedeemAsync(
        Guid patientAccountId, string code, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(patientAccountId, cancellationToken);
        if (account is null)
        {
            return RedeemLinkFailure.AccountNotFound;
        }

        if (account.Role != AccountRole.Patient)
        {
            return RedeemLinkFailure.NotAPatient;
        }

        return await links.Redeem(code, patientAccountId).Match(
            async link =>
            {
                Result<LinkView, RedeemLinkFailure> view = await ToViewAsync(link, patientAccountId, cancellationToken);
                return view;
            },
            failure => Task.FromResult<Result<LinkView, RedeemLinkFailure>>(
                failure == RedeemFailure.InviteNotFound ? RedeemLinkFailure.InviteNotFound : RedeemLinkFailure.AlreadyLinked));
    }

    public async Task<IReadOnlyList<LinkView>> ListAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var views = new List<LinkView>();
        foreach (var link in links.ListFor(accountId))
        {
            views.Add(await ToViewAsync(link, accountId, cancellationToken));
        }

        return views;
    }

    public bool Unlink(Guid accountId, Guid peerAccountId) => links.Unlink(accountId, peerAccountId);

    private async Task<LinkView> ToViewAsync(PatientLink link, Guid viewerAccountId, CancellationToken cancellationToken)
    {
        var peerAccountId = viewerAccountId == link.ProfessionalAccountId ? link.PatientAccountId : link.ProfessionalAccountId;
        var peer = await accounts.FindByIdAsync(peerAccountId, cancellationToken);
        return new LinkView(link.ProfessionalAccountId, link.PatientAccountId, link.PatientId, link.LinkedAt, peer?.KeyPair?.PublicKey);
    }
}
