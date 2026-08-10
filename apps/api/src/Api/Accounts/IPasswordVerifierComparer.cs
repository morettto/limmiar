namespace Api.Accounts;

public interface IPasswordVerifierComparer
{
    bool Matches(byte[] submitted, byte[] stored);
}
