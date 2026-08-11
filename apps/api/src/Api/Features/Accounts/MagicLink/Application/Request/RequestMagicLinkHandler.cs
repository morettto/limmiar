using Mediator;

namespace Api.Accounts;

public sealed class RequestMagicLinkHandler(IAccountStore store, IMagicLinkIssuer magicLinkIssuer, IMagicLinkEmailSender magicLinkEmailSender)
    : IRequestHandler<RequestMagicLinkCommand, RequestMagicLinkResult>
{
    public async ValueTask<RequestMagicLinkResult> Handle(RequestMagicLinkCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = AccountEmail.Normalize(request.Email);
        var account = await store.FindByEmailAsync(normalizedEmail, cancellationToken);

        if (account is null || account.Role != AccountRole.Professional)
        {
            var token = magicLinkIssuer.IssueToken(normalizedEmail);
            try
            {
                await magicLinkEmailSender.SendAsync(normalizedEmail, token, cancellationToken);
            }
            catch (Exception)
            {
            }
        }

        return RequestMagicLinkResult.Instance;
    }
}
