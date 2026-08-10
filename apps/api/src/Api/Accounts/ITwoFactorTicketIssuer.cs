namespace Api.Accounts;

public interface ITwoFactorTicketIssuer
{
    string Issue(Guid accountId);

    bool Validate(string ticket, Guid accountId);

    void Invalidate(string ticket);
}
