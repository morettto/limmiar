namespace Api.Accounts;

public interface IMagicLinkIssuer
{
    string IssueToken(string email);

    string? ConsumeToken(string token);

    string IssueTicket(MagicLinkTicketData ticket);

    MagicLinkTicketData? ConsumeTicket(string ticket);
}
