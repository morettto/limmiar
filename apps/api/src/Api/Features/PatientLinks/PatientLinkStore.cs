using System.Security.Cryptography;
using Api.Platform;

namespace Api.PatientLinks;

public enum RedeemFailure
{
    InviteNotFound,

    AlreadyLinked,
}

/// <summary>
/// Convites e vínculos em memória (abordagem (c): as contas já vivem em memória, um vínculo
/// dura exatamente o que a conta dura). Singleton, um único lock -- o volume é baixo (um
/// convite por vínculo humano), não vale a pena granularidade por código.
/// </summary>
/// <remarks>
/// ponytail: lock global e memória; teto = reinício perde vínculos (como as contas). Upgrade:
/// tabela quando as contas forem para Postgres.
/// </remarks>
public sealed class PatientLinkStore(Func<DateTimeOffset>? clock = null)
{
    // Crockford's Base32: exclui I/L/O/U para não confundir com 1/0/V -- 32 símbolos, 12
    // caracteres = 60 bits de entropia, inadivinhável mesmo por tentativa em massa dentro do
    // TTL de 7 dias.
    private const string CodeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private const int CodeLength = 12;

    public static readonly TimeSpan InviteLifetime = TimeSpan.FromDays(7);

    private readonly Func<DateTimeOffset> _clock = clock ?? (() => DateTimeOffset.UtcNow);
    private readonly Lock _lock = new();
    private readonly Dictionary<string, LinkInvite> _invites = new(StringComparer.Ordinal);
    private readonly List<PatientLink> _links = [];

    public LinkInvite CreateInvite(Guid professionalAccountId, Guid patientId)
    {
        var invite = new LinkInvite(
            RandomNumberGenerator.GetString(CodeAlphabet, CodeLength),
            professionalAccountId,
            patientId,
            _clock() + InviteLifetime);

        lock (_lock)
        {
            _invites[invite.Code] = invite;
        }

        return invite;
    }

    /// <summary>
    /// Invalid, expired, or already-redeemed code all collapse into <see cref="RedeemFailure.InviteNotFound"/>
    /// -- a caller cannot tell "never existed" from "already used" apart. The invite is consumed
    /// only on success, inside the same lock as the duplicate check, so two concurrent redeems of
    /// the same code always leave exactly one winner (proven by
    /// PatientLinkStoreTests.Redeem_TwoConcurrentAttemptsOnSameCode_ExactlyOneWins).
    /// </summary>
    public Result<PatientLink, RedeemFailure> Redeem(string code, Guid patientAccountId)
    {
        lock (_lock)
        {
            if (!_invites.TryGetValue(code, out var invite) || invite.ExpiresAt <= _clock())
            {
                return RedeemFailure.InviteNotFound;
            }

            var alreadyLinked = _links.Exists(link =>
                link.ProfessionalAccountId == invite.ProfessionalAccountId &&
                (link.PatientAccountId == patientAccountId || link.PatientId == invite.PatientId));
            if (alreadyLinked)
            {
                return RedeemFailure.AlreadyLinked;
            }

            var link = new PatientLink(invite.ProfessionalAccountId, patientAccountId, invite.PatientId, _clock());
            _links.Add(link);
            _invites.Remove(code);
            return link;
        }
    }

    /// <summary>Every link where <paramref name="accountId"/> is either side -- the professional or the patient.</summary>
    public IReadOnlyList<PatientLink> ListFor(Guid accountId)
    {
        lock (_lock)
        {
            return _links.FindAll(link => link.ProfessionalAccountId == accountId || link.PatientAccountId == accountId);
        }
    }

    /// <summary>Either party may unlink. False if no link exists between the two accounts.</summary>
    public bool Unlink(Guid accountId, Guid peerAccountId)
    {
        lock (_lock)
        {
            var index = _links.FindIndex(link =>
                (link.ProfessionalAccountId == accountId && link.PatientAccountId == peerAccountId) ||
                (link.ProfessionalAccountId == peerAccountId && link.PatientAccountId == accountId));
            if (index < 0)
            {
                return false;
            }

            _links.RemoveAt(index);
            return true;
        }
    }
}
