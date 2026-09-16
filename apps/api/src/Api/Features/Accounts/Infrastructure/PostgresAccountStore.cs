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
public sealed class PostgresAccountStore(NpgsqlDataSource dataSource, TotpSecretCipher totpSecretCipher) : IAccountStore
{
    private const string SelectColumns = """
        id, email, role, password_verifier_sha256, google_subject_id, verification_status,
        rejection_reason, verification_submitted_at, totp_secret_encrypted, totp_enabled_at,
        totp_backup_code_hashes, webauthn_credential_id, webauthn_cose_public_key,
        webauthn_sign_count, webauthn_aaguid, recovery_verifier_sha256, voice_wrapped_dek,
        voice_sealed_embedding
        """;

    public Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken)
        => FindOneAsync("email = @email", "email", normalizedEmail, cancellationToken, ("app.account_email", normalizedEmail));

    public Task<Account?> FindByIdAsync(Guid id, CancellationToken cancellationToken)
        => FindOneAsync("id = @id", "id", id, cancellationToken, ("app.tenant_id", id.ToString()));

    private async Task<Account?> FindOneAsync(
        string predicate,
        string parameterName,
        object parameterValue,
        CancellationToken cancellationToken,
        params (string Name, string Value)[] gucs)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(cancellationToken, gucs);
        var account = await scope.QuerySingleAsync(
            $"SELECT {SelectColumns} FROM accounts WHERE {predicate}",
            ReadAccount,
            cancellationToken,
            command => command.Parameters.AddWithValue(parameterName, parameterValue));
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
                rejection_reason, verification_submitted_at, totp_secret_encrypted, totp_enabled_at,
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
                totp_secret_encrypted = @totpSecret,
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
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(cancellationToken, ("app.staff_review", "on"));

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
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

        await scope.Transaction.CommitAsync(cancellationToken);
        return queue;
    }

    private void AddAccountParameters(NpgsqlCommand command, Account account)
    {
        command.Parameters.AddWithValue("id", account.Id);
        command.Parameters.AddWithValue("email", account.Email);
        command.Parameters.AddWithValue("role", account.Role.ToString());
        command.Parameters.AddWithValue("passwordVerifier", (object?)account.PasswordVerifier ?? DBNull.Value);
        command.Parameters.AddWithValue("googleSubjectId", (object?)account.GoogleSubjectId ?? DBNull.Value);
        command.Parameters.AddWithValue("verificationStatus", account.VerificationStatus.ToString());
        command.Parameters.AddWithValue("rejectionReason", (object?)account.RejectionReason ?? DBNull.Value);
        command.Parameters.AddWithValue("verificationSubmittedAt", (object?)account.VerificationSubmittedAt ?? DBNull.Value);
        command.Parameters.AddWithValue("totpSecret", account.TotpSecret is { } totpSecret ? totpSecretCipher.Encrypt(account.Id, totpSecret) : DBNull.Value);
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

    private Account ReadAccount(NpgsqlDataReader reader)
    {
        int Ord(string name) => reader.GetOrdinal(name);
        var wrappedDek = reader.IsDBNull(Ord("voice_wrapped_dek")) ? null : reader.GetFieldValue<byte[]>(Ord("voice_wrapped_dek"));
        var sealedEmbedding = reader.IsDBNull(Ord("voice_sealed_embedding")) ? null : reader.GetFieldValue<byte[]>(Ord("voice_sealed_embedding"));
        if (wrappedDek is not null && sealedEmbedding is null)
        {
            throw new InvalidOperationException("An account voice enrollment is missing its sealed embedding.");
        }

        return new Account(
            Id: reader.GetGuid(Ord("id")),
            Email: reader.GetString(Ord("email")),
            Role: Enum.Parse<AccountRole>(reader.GetString(Ord("role"))),
            PasswordVerifier: reader.IsDBNull(Ord("password_verifier_sha256")) ? null : reader.GetFieldValue<byte[]>(Ord("password_verifier_sha256")),
            GoogleSubjectId: reader.IsDBNull(Ord("google_subject_id")) ? null : reader.GetString(Ord("google_subject_id")),
            VerificationStatus: Enum.Parse<AccountVerificationStatus>(reader.GetString(Ord("verification_status"))),
            RejectionReason: reader.IsDBNull(Ord("rejection_reason")) ? null : reader.GetString(Ord("rejection_reason")),
            VerificationSubmittedAt: reader.IsDBNull(Ord("verification_submitted_at")) ? null : reader.GetFieldValue<DateTimeOffset>(Ord("verification_submitted_at")),
            TotpSecret: reader.IsDBNull(Ord("totp_secret_encrypted")) ? null : totpSecretCipher.Decrypt(reader.GetGuid(Ord("id")), reader.GetFieldValue<byte[]>(Ord("totp_secret_encrypted"))),
            TotpEnabledAt: reader.IsDBNull(Ord("totp_enabled_at")) ? null : reader.GetFieldValue<DateTimeOffset>(Ord("totp_enabled_at")),
            TotpBackupCodeHashes: reader.IsDBNull(Ord("totp_backup_code_hashes")) ? null : reader.GetFieldValue<string[]>(Ord("totp_backup_code_hashes")),
            WebAuthnCredentialId: reader.IsDBNull(Ord("webauthn_credential_id")) ? null : reader.GetFieldValue<byte[]>(Ord("webauthn_credential_id")),
            WebAuthnCosePublicKey: reader.IsDBNull(Ord("webauthn_cose_public_key")) ? null : reader.GetFieldValue<byte[]>(Ord("webauthn_cose_public_key")),
            WebAuthnSignCount: reader.IsDBNull(Ord("webauthn_sign_count")) ? null : (uint)reader.GetInt64(Ord("webauthn_sign_count")),
            WebAuthnAaGuid: reader.IsDBNull(Ord("webauthn_aaguid")) ? null : reader.GetGuid(Ord("webauthn_aaguid")),
            RecoveryVerifier: reader.IsDBNull(Ord("recovery_verifier_sha256")) ? null : reader.GetFieldValue<byte[]>(Ord("recovery_verifier_sha256")),
            VoiceEnrollment: wrappedDek is null ? null : new VoiceEnrollment(wrappedDek, sealedEmbedding ?? throw new InvalidOperationException("An account voice enrollment is missing its sealed embedding.")));
    }
}
