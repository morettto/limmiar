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

    // ponytail: sem teto de itens por vínculo, além da memória do processo. Upgrade: tabela
    // junto com patient_links quando as contas saírem de InMemoryAccountStore.
    private readonly Dictionary<(Guid PatientAccountId, Guid ProfessionalAccountId), List<SharedItem>> _sharedItems = new();
    private readonly Dictionary<Guid, SharingPreferences> _preferences = new();

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

    /// <summary>False if no link exists between the two accounts in this direction -- share only travels along a real (patient, professional) link. Unlink does not remove what was already appended here (README invariant: revoking is a preferences-blob change, never a delete of past envelopes).</summary>
    public bool Share(Guid patientAccountId, Guid professionalAccountId, byte[] ciphertext)
    {
        lock (_lock)
        {
            if (!IsLinked(patientAccountId, professionalAccountId))
            {
                return false;
            }

            var key = (patientAccountId, professionalAccountId);
            if (!_sharedItems.TryGetValue(key, out var items))
            {
                items = [];
                _sharedItems[key] = items;
            }

            items.Add(new SharedItem(professionalAccountId, patientAccountId, _clock(), ciphertext));
            return true;
        }
    }

    /// <summary>Null if no link exists between the two accounts in this direction; otherwise the items in arrival order, possibly empty. Re-linking after Unlink surfaces whatever was shared before -- the list is keyed by account pair, not by link instance.</summary>
    public IReadOnlyList<SharedItem>? ListShared(Guid professionalAccountId, Guid patientAccountId)
    {
        lock (_lock)
        {
            if (!IsLinked(patientAccountId, professionalAccountId))
            {
                return null;
            }

            return _sharedItems.TryGetValue((patientAccountId, professionalAccountId), out var items)
                ? items.ToArray()
                : [];
        }
    }

    /// <summary>Null if the account never saved sharing preferences.</summary>
    public SharingPreferences? GetPreferences(Guid accountId)
    {
        lock (_lock)
        {
            return _preferences.TryGetValue(accountId, out var preferences) ? preferences : null;
        }
    }

    /// <summary>
    /// Optimistic concurrency, same lock as the read: succeeds only if <paramref name="expectedVersion"/>
    /// matches the account's current version (0 = never saved), and always advances by exactly 1
    /// on success. On mismatch, returns the current version so the caller can re-read and retry --
    /// proven under concurrent callers racing the same expectedVersion by
    /// PatientLinkStoreTests.PutPreferences_ConcurrentSameExpectedVersion_ExactlyOneWins.
    /// </summary>
    public Result<SharingPreferences, long> PutPreferences(Guid accountId, long expectedVersion, byte[] wrappedDek, byte[] ciphertext)
    {
        lock (_lock)
        {
            var currentVersion = _preferences.TryGetValue(accountId, out var current) ? current.Version : 0;
            if (currentVersion != expectedVersion)
            {
                return Result<SharingPreferences, long>.Failure(currentVersion);
            }

            var updated = new SharingPreferences(expectedVersion + 1, wrappedDek, ciphertext);
            _preferences[accountId] = updated;
            return updated;
        }
    }

    private bool IsLinked(Guid patientAccountId, Guid professionalAccountId) =>
        _links.Exists(link => link.ProfessionalAccountId == professionalAccountId && link.PatientAccountId == patientAccountId);
}
