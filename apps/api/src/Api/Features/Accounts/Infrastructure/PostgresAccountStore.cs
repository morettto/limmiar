using Api.Data;
using Npgsql;

namespace Api.Accounts;

/// <summary>
/// Postgres-backed <see cref="IAccountStore"/> (S11-03, fatia 6, migration
/// 0010_create_accounts.sql). Every method sets the one RLS lookup key it actually has --
/// <c>app.tenant_id</c> for id-based lookups (<see cref="OpenTenantScopedTransactionAsync"/>),
/// <c>app.account_email</c> for <see cref="FindByEmailAsync"/> (runs before a session exists:
/// login, register, Google, magic link, recovery), <c>app.staff_review</c> for
/// <see cref="ListPendingDocumentReviewAsync"/> (staff queue, no account at all) -- so a query
/// that forgets to set any of the three sees zero rows instead of leaking across accounts.
/// </summary>
public sealed class PostgresAccountStore(NpgsqlDataSource dataSource) : IAccountStore
{
    private const string SelectColumns = """
        id, email, role, password_verifier_sha256, google_subject_id, verification_status,
        rejection_reason, verification_submitted_at, totp_secret, totp_enabled_at,
        totp_backup_code_hashes, webauthn_credential_id, webauthn_cose_public_key,
        webauthn_sign_count, webauthn_aaguid, recovery_verifier_sha256, voice_wrapped_dek,
        voice_sealed_embedding
        """;

    public async Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using (var setEmailCommand = connection.CreateCommand())
        {
            setEmailCommand.Transaction = transaction;
            setEmailCommand.CommandText = "SELECT set_config('app.account_email', @email, true)";
            setEmailCommand.Parameters.AddWithValue("email", normalizedEmail);
            await setEmailCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var selectCommand = connection.CreateCommand();
        selectCommand.Transaction = transaction;
        selectCommand.CommandText = $"SELECT {SelectColumns} FROM accounts WHERE email = @email";
        selectCommand.Parameters.AddWithValue("email", normalizedEmail);

        Account? account = null;
        await using (var reader = await selectCommand.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                account = ReadAccount(reader);
            }
        }

        await transaction.CommitAsync(cancellationToken);
        return account;
    }

    public async Task<Account?> FindByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(id, cancellationToken);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = $"SELECT {SelectColumns} FROM accounts WHERE id = @id";
        selectCommand.Parameters.AddWithValue("id", id);

        Account? account = null;
        await using (var reader = await selectCommand.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                account = ReadAccount(reader);
            }
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return account;
    }

    public async Task InsertAsync(Account account, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(account.Id, cancellationToken);

        await using var insertCommand = scope.Connection.CreateCommand();
        insertCommand.Transaction = scope.Transaction;
        insertCommand.CommandText = """
            INSERT INTO accounts (
                id, email, role, password_verifier_sha256, google_subject_id, verification_status,
                rejection_reason, verification_submitted_at, totp_secret, totp_enabled_at,
                totp_backup_code_hashes, webauthn_credential_id, webauthn_cose_public_key,
                webauthn_sign_count, webauthn_aaguid, recovery_verifier_sha256, voice_wrapped_dek,
                voice_sealed_embedding)
            VALUES (
                @id, @email, @role, @passwordVerifier, @googleSubjectId, @verificationStatus,
                @rejectionReason, @verificationSubmittedAt, @totpSecret, @totpEnabledAt,
                @totpBackupCodeHashes, @webauthnCredentialId, @webauthnCosePublicKey,
                @webauthnSignCount, @webauthnAaGuid, @recoveryVerifier, @voiceWrappedDek,
                @voiceSealedEmbedding)
            """;
        AddAccountParameters(insertCommand, account);
        await insertCommand.ExecuteNonQueryAsync(cancellationToken);

        await scope.Transaction.CommitAsync(cancellationToken);
    }

    public async Task UpdateAsync(Account account, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(account.Id, cancellationToken);

        await using var updateCommand = scope.Connection.CreateCommand();
        updateCommand.Transaction = scope.Transaction;
        updateCommand.CommandText = """
            UPDATE accounts SET
                role = @role,
                password_verifier_sha256 = @passwordVerifier,
                google_subject_id = @googleSubjectId,
                verification_status = @verificationStatus,
                rejection_reason = @rejectionReason,
                verification_submitted_at = @verificationSubmittedAt,
                totp_secret = @totpSecret,
                totp_enabled_at = @totpEnabledAt,
                totp_backup_code_hashes = @totpBackupCodeHashes,
                webauthn_credential_id = @webauthnCredentialId,
                webauthn_cose_public_key = @webauthnCosePublicKey,
                webauthn_sign_count = @webauthnSignCount,
                webauthn_aaguid = @webauthnAaGuid,
                recovery_verifier_sha256 = @recoveryVerifier,
                voice_wrapped_dek = @voiceWrappedDek,
                voice_sealed_embedding = @voiceSealedEmbedding
            WHERE id = @id
            """;
        AddAccountParameters(updateCommand, account);
        await updateCommand.ExecuteNonQueryAsync(cancellationToken);

        await scope.Transaction.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Account>> ListPendingDocumentReviewAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using (var setStaffReviewCommand = connection.CreateCommand())
        {
            setStaffReviewCommand.Transaction = transaction;
            setStaffReviewCommand.CommandText = "SELECT set_config('app.staff_review', 'on', true)";
            await setStaffReviewCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var selectCommand = connection.CreateCommand();
        selectCommand.Transaction = transaction;
        selectCommand.CommandText = $"""
            SELECT {SelectColumns}
            FROM accounts
            WHERE role = 'Professional' AND verification_status = 'InReview'
            ORDER BY verification_submitted_at
            """;

        var queue = new List<Account>();
        await using (var reader = await selectCommand.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                queue.Add(ReadAccount(reader));
            }
        }

        await transaction.CommitAsync(cancellationToken);
        return queue;
    }

    private static void AddAccountParameters(NpgsqlCommand command, Account account)
    {
        command.Parameters.AddWithValue("id", account.Id);
        command.Parameters.AddWithValue("email", account.Email);
        command.Parameters.AddWithValue("role", account.Role.ToString());
        command.Parameters.AddWithValue("passwordVerifier", (object?)account.PasswordVerifier ?? DBNull.Value);
        command.Parameters.AddWithValue("googleSubjectId", (object?)account.GoogleSubjectId ?? DBNull.Value);
        command.Parameters.AddWithValue("verificationStatus", account.VerificationStatus.ToString());
        command.Parameters.AddWithValue("rejectionReason", (object?)account.RejectionReason ?? DBNull.Value);
        command.Parameters.AddWithValue("verificationSubmittedAt", (object?)account.VerificationSubmittedAt ?? DBNull.Value);
        command.Parameters.AddWithValue("totpSecret", (object?)account.TotpSecret ?? DBNull.Value);
        command.Parameters.AddWithValue("totpEnabledAt", (object?)account.TotpEnabledAt ?? DBNull.Value);
        command.Parameters.AddWithValue("totpBackupCodeHashes", (object?)account.TotpBackupCodeHashes?.ToArray() ?? DBNull.Value);
        command.Parameters.AddWithValue("webauthnCredentialId", (object?)account.WebAuthnCredentialId ?? DBNull.Value);
        command.Parameters.AddWithValue("webauthnCosePublicKey", (object?)account.WebAuthnCosePublicKey ?? DBNull.Value);
        command.Parameters.AddWithValue("webauthnSignCount", account.WebAuthnSignCount is { } signCount ? (long)signCount : DBNull.Value);
        command.Parameters.AddWithValue("webauthnAaGuid", (object?)account.WebAuthnAaGuid ?? DBNull.Value);
        command.Parameters.AddWithValue("recoveryVerifier", (object?)account.RecoveryVerifier ?? DBNull.Value);
        command.Parameters.AddWithValue("voiceWrappedDek", (object?)account.VoiceEnrollment?.WrappedDek ?? DBNull.Value);
        command.Parameters.AddWithValue("voiceSealedEmbedding", (object?)account.VoiceEnrollment?.SealedEmbedding ?? DBNull.Value);
    }

    private static Account ReadAccount(NpgsqlDataReader reader)
    {
        var wrappedDek = reader.IsDBNull(16) ? null : reader.GetFieldValue<byte[]>(16);
        var sealedEmbedding = reader.IsDBNull(17) ? null : reader.GetFieldValue<byte[]>(17);

        return new Account(
            Id: reader.GetGuid(0),
            Email: reader.GetString(1),
            Role: Enum.Parse<AccountRole>(reader.GetString(2)),
            PasswordVerifier: reader.IsDBNull(3) ? null : reader.GetFieldValue<byte[]>(3),
            GoogleSubjectId: reader.IsDBNull(4) ? null : reader.GetString(4),
            VerificationStatus: Enum.Parse<AccountVerificationStatus>(reader.GetString(5)),
            RejectionReason: reader.IsDBNull(6) ? null : reader.GetString(6),
            VerificationSubmittedAt: reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7),
            TotpSecret: reader.IsDBNull(8) ? null : reader.GetString(8),
            TotpEnabledAt: reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9),
            TotpBackupCodeHashes: reader.IsDBNull(10) ? null : reader.GetFieldValue<string[]>(10),
            WebAuthnCredentialId: reader.IsDBNull(11) ? null : reader.GetFieldValue<byte[]>(11),
            WebAuthnCosePublicKey: reader.IsDBNull(12) ? null : reader.GetFieldValue<byte[]>(12),
            WebAuthnSignCount: reader.IsDBNull(13) ? null : (uint)reader.GetInt64(13),
            WebAuthnAaGuid: reader.IsDBNull(14) ? null : reader.GetGuid(14),
            RecoveryVerifier: reader.IsDBNull(15) ? null : reader.GetFieldValue<byte[]>(15),
            VoiceEnrollment: wrappedDek is null ? null : new VoiceEnrollment(wrappedDek, sealedEmbedding!));
    }
}
