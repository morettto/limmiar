using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using Api.Data;
using Api.Scheduling;
using Npgsql;

namespace Api.Billing;

public enum ReserveOutcome
{
    Reserved,
    SlotTaken,
    LinkInvalidOrExpired,
    PaymentPending,
}

public sealed record PublicReserveRequest(DateTimeOffset StartsAt, string Name, string Contact);

public sealed record PublicReserveResponse(Guid SessionId, string? CheckoutUrl);

public enum NoShowVerdict
{
    [JsonStringEnumMemberName("excused")] Excused,
    [JsonStringEnumMemberName("forfeitsFee")] ForfeitsFee,
}

/// <summary>Política única global (sem config por tenant): a primeira falta é desculpada.</summary>
public static class NoShowPolicy
{
    public static NoShowVerdict Decide(int faltasPrevias) =>
        faltasPrevias <= 0 ? NoShowVerdict.Excused : NoShowVerdict.ForfeitsFee;
}

/// <summary>O seam puro do dinheiro perdido: só há reembolso a pedir quando a tentativa perdeu
/// a corrida E o checkout já está pago.</summary>
public static class RefundDecision
{
    public static bool ShouldRefund(bool conflito, PaymentStatus status) =>
        conflito && status == PaymentStatus.Paid;
}

public sealed record NoShowResponse(NoShowVerdict Verdict);

/// <summary>Token opaco do link público: 256 bits em base64url, só o hash SHA256 é guardado.</summary>
public static class PublicLinkToken
{
    public static string Generate() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(token))).ToLowerInvariant();
}

public interface IPublicLinkStore
{
    Task<Guid?> ResolveTenantAsync(string tokenHash, CancellationToken cancellationToken);
}

/// <summary>Resolve o tenant pelo hash sem contexto de tenant (o endpoint público ainda não o
/// conhece): GUC local + política <c>link_resolve</c>, nunca transação com tenant.</summary>
public sealed class PublicLinkStore(NpgsqlDataSource dataSource) : IPublicLinkStore
{
    public async Task<Guid?> ResolveTenantAsync(string tokenHash, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using (var setCommand = connection.CreateCommand())
        {
            setCommand.Transaction = transaction;
            setCommand.CommandText = "SELECT set_config('app.resolve_hash', @hash, true)";
            setCommand.Parameters.AddWithValue("hash", tokenHash);
            await setCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var selectCommand = connection.CreateCommand())
        {
            selectCommand.Transaction = transaction;
            selectCommand.CommandText = "SELECT tenant_id FROM public_booking_links WHERE token_hash = @hash AND (expires_at IS NULL OR expires_at > now())";
            selectCommand.Parameters.AddWithValue("hash", tokenHash);
            await using var reader = await selectCommand.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                return reader.GetGuid(0);
            }
        }

        return null;
    }
}

public interface IPublicBooking
{
    Task<ReserveResult> ReserveAsync(string token, PublicReserveRequest command, CancellationToken cancellationToken);
}

/// <summary>Fronteira service→endpoint (ADR-0011): resultado nomeado, nunca tuplo. Sessão vazia
/// = sem sessão (pagamento pendente ou tentativa que perdeu a corrida).</summary>
public sealed record ReserveResult(ReserveOutcome Outcome, Guid SessionId, string? CheckoutUrl, bool IsDuplicate);

/// <summary>Reserva pública: link→tenant, efeito deduplica, checkout cobra, <see cref="SchedulingService"/>
/// decide a corrida. Checkout antes da sessão: quem perde com Paid é reembolsado (fatia 5).</summary>
public sealed class PublicBookingService(
    IPublicLinkStore links,
    IBookingPaymentStore payments,
    IAbacatePayClient pay,
    SchedulingService scheduling) : IPublicBooking
{
    private const int DefaultDurationMinutes = 50;

    public async Task<ReserveResult> ReserveAsync(
        string token, PublicReserveRequest command, CancellationToken cancellationToken)
    {
        var tenantId = await links.ResolveTenantAsync(PublicLinkToken.Hash(token), cancellationToken);
        if (tenantId is null)
        {
            return new ReserveResult(ReserveOutcome.LinkInvalidOrExpired, Guid.Empty, null, false);
        }

        var externalId = DeriveExternalId(token, command.StartsAt);
        var claimed = await payments.ClaimEffectAsync(
            new BookingEffect(
                externalId, tenantId.Value, null, string.Empty,
                PaymentStatus.Pending, 0, command.Name, command.Contact),
            cancellationToken);
        if (claimed.IsDuplicate)
        {
            var stored = claimed.Effect;
            return new ReserveResult(ReserveOutcome.Reserved, stored.SessionId ?? Guid.Empty, stored.CheckoutUrl, true);
        }

        // ponytail: item/método fixos; o catálogo real do tenant fica fora deste ticket.
        var checkout = await pay.CreateCheckoutAsync(
            new CreateCheckoutRequest([new CheckoutItem("public-booking", 1)], ["pix"], externalId, null, null),
            cancellationToken);
        if (!checkout.TryGetValue(out var created))
        {
            return new ReserveResult(ReserveOutcome.PaymentPending, Guid.Empty, null, false);
        }

        await payments.SetCheckoutAsync(
            externalId, tenantId.Value, created.Id, created.Url,
            AbacatePayMapper.ToPaymentStatus(created.Status), created.Amount, cancellationToken);

        var scheduled = await scheduling.ScheduleAsync(
            tenantId.Value, Guid.NewGuid(), command.StartsAt, DefaultDurationMinutes, cancellationToken);
        return await scheduled.Match(
            async session =>
            {
                await payments.SetSessionAsync(externalId, tenantId.Value, session.Id, cancellationToken);
                return new ReserveResult(ReserveOutcome.Reserved, session.Id, created.Url, false);
            },
            async reason =>
            {
                if (reason is not SchedulingFailureReason.SlotTaken)
                {
                    return new ReserveResult(ReserveOutcome.LinkInvalidOrExpired, Guid.Empty, null, false);
                }

                // Reclama de novo: no caminho duplicado devolve a linha fresca (o webhook pode
                // ter marcado Paid na janela entre o claim e o conflito), nunca vazio.
                var current = await payments.ClaimEffectAsync(
                    new BookingEffect(
                        externalId, tenantId.Value, null, string.Empty,
                        PaymentStatus.Pending, 0, command.Name, command.Contact),
                    cancellationToken);
                if (RefundDecision.ShouldRefund(true, current.Effect.Status))
                {
                    var refund = await pay.RefundAsync(externalId, cancellationToken);
                    if (refund is RefundOutcome.Refunded)
                    {
                        await payments.MarkRefundedAsync(externalId, tenantId.Value, cancellationToken);
                    }
                }

                return new ReserveResult(ReserveOutcome.SlotTaken, Guid.Empty, null, false);
            });
    }

    /// <summary>Chave de idempotência determinística (link+slot): a repetição do mesmo POST
    /// reclama o mesmo efeito em vez de cobrar duas vezes.</summary>
    private static string DeriveExternalId(string token, DateTimeOffset startsAt) =>
        "rsv_" + Convert.ToHexString(
            SHA256.HashData(Encoding.ASCII.GetBytes(token + "|" + startsAt.ToUnixTimeSeconds()))).ToLowerInvariant();
}
