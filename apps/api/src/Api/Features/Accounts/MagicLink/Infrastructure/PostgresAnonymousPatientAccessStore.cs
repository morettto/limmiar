using Api.Data;
using Npgsql;

namespace Api.Accounts;

public sealed class PostgresAnonymousPatientAccessStore(NpgsqlDataSource dataSource, Func<DateTimeOffset>? clock = null)
    : IAnonymousPatientAccessStore
{
    private readonly Func<DateTimeOffset> _clock = clock ?? (() => DateTimeOffset.UtcNow);

    private async Task<PatientAccessInvitation?> ReadInvitationAsync(TenantScopedTransaction scope, string code, bool lockRows, CancellationToken ct)
    {
        return await scope.QuerySingleAsync($"""
            SELECT i.code, i.professional_account_id, i.patient_id, l.patient_account_id
            FROM patient_link_invites i
            JOIN accounts a ON a.id = i.professional_account_id
            LEFT JOIN patient_links l ON l.professional_account_id = i.professional_account_id
                AND l.patient_id = i.patient_id AND l.unlinked_at IS NULL
            WHERE i.code = @code AND i.expires_at > @now
              AND a.role = 'Professional' AND a.verification_status = 'Active'
            {(lockRows ? "FOR SHARE OF a" : "")}
            """, reader => new PatientAccessInvitation(reader.GetString(0), reader.GetGuid(1), reader.GetGuid(2),
                reader.IsDBNull(3) ? null : reader.GetGuid(3)), ct, command =>
            {
                command.Parameters.AddWithValue("code", code);
                command.Parameters.AddWithValue("now", _clock());
            });
    }

    public async Task<PatientAccessInvitation?> FindInvitationAsync(string code, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(cancellationToken, ("app.invite_code", code));
        var invitation = await ReadInvitationAsync(scope, code, false, cancellationToken);
        await scope.Transaction.CommitAsync(cancellationToken);
        return invitation;
    }

    public Task<bool> RegisterAsync(PatientAccessInvitation invitation, Account account, CancellationToken cancellationToken) =>
        CompleteAsync(invitation, account, expectedSignCount: null, cancellationToken);

    public Task<bool> AssertAsync(PatientAccessInvitation invitation, Account account, uint expectedSignCount, CancellationToken cancellationToken) =>
        CompleteAsync(invitation, account, expectedSignCount, cancellationToken);

    private async Task<bool> CompleteAsync(PatientAccessInvitation invitation, Account account, uint? expectedSignCount, CancellationToken ct)
    {
        if (account.Role != AccountRole.Patient || account.Email is not null || account.PasswordVerifier is not null
            || account.GoogleSubjectId is not null || account.WebAuthnCredentialId is null || account.WebAuthnCosePublicKey is null
            || account.WebAuthnSignCount is null || account.WebAuthnAaGuid is null) return false;
        if (expectedSignCount is { } counter && account.WebAuthnSignCount <= counter
            && (account.WebAuthnSignCount != 0 || counter != 0)) return false;

        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(ct,
            ("app.invite_code", invitation.Code), ("app.tenant_id", invitation.ProfessionalAccountId.ToString()));
        var current = await ReadInvitationAsync(scope, invitation.Code, true, ct);
        if (current is null || current.ProfessionalAccountId != invitation.ProfessionalAccountId
            || current.PatientId != invitation.PatientId || (current.PatientAccountId is { } boundId && boundId != account.Id)
            || (expectedSignCount is null && current.PatientAccountId is not null)) return false;

        try
        {
            await using var consumeCommand = scope.CreateCommand("DELETE FROM patient_link_invites WHERE code = @code AND expires_at > @now");
            consumeCommand.Parameters.AddWithValue("code", current.Code);
            consumeCommand.Parameters.AddWithValue("now", _clock());
            if (await consumeCommand.ExecuteNonQueryAsync(ct) != 1) return false;
            await scope.SetTenantAsync(account.Id, ct);

            await using var accountCommand = scope.CreateCommand(expectedSignCount is null ? """
                INSERT INTO accounts (id, email, role, verification_status, webauthn_credential_id,
                    webauthn_cose_public_key, webauthn_sign_count, webauthn_aaguid)
                VALUES (@id, NULL, 'Patient', 'Active', @credentialId, @publicKey, @signCount, @aaGuid)
                """ : """
                UPDATE accounts SET webauthn_sign_count = @signCount
                WHERE id = @id AND role = 'Patient' AND verification_status = 'Active'
                  AND webauthn_sign_count = @expectedSignCount AND webauthn_credential_id = @credentialId
                  AND webauthn_cose_public_key = @publicKey
                """);
            accountCommand.Parameters.AddWithValue("id", account.Id);
            accountCommand.Parameters.AddWithValue("credentialId", account.WebAuthnCredentialId);
            accountCommand.Parameters.AddWithValue("publicKey", account.WebAuthnCosePublicKey);
            accountCommand.Parameters.AddWithValue("signCount", (long)account.WebAuthnSignCount.Value);
            accountCommand.Parameters.AddWithValue("aaGuid", account.WebAuthnAaGuid.Value);
            if (expectedSignCount is { } expected) accountCommand.Parameters.AddWithValue("expectedSignCount", (long)expected);
            if (await accountCommand.ExecuteNonQueryAsync(ct) != 1) return false;

            if (current.PatientAccountId is null)
            {
                await using var linkCommand = scope.CreateCommand("""
                    INSERT INTO patient_links (professional_account_id, patient_account_id, patient_id, linked_at)
                    VALUES (@professionalId, @accountId, @patientId, @now)
                    """);
                linkCommand.Parameters.AddWithValue("professionalId", current.ProfessionalAccountId);
                linkCommand.Parameters.AddWithValue("accountId", account.Id);
                linkCommand.Parameters.AddWithValue("patientId", current.PatientId);
                linkCommand.Parameters.AddWithValue("now", _clock());
                await linkCommand.ExecuteNonQueryAsync(ct);
            }

            await scope.Transaction.CommitAsync(ct);
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return false;
        }
        return true;
    }
}
