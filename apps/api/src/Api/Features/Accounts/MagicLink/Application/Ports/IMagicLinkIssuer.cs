namespace Api.Accounts;

public interface IMagicLinkIssuer
{
    string IssueTicket(MagicLinkTicketData ticket);

    MagicLinkTicketData? ConsumeTicket(string ticket);
}
