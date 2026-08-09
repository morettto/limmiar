using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Accounts;
using Api.Endpoints;
using Api.Serialization;
using Api.Tests.Accounts;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests.Auth;

/// <summary>
/// S02-04 endpoint tests: the HTTP surface of the device-pairing-by-QR handshake
/// (<see cref="IDevicePairingIssuer"/>, already covered as pure domain by
/// Api.Tests/Accounts/DevicePairingIssuerTests). These tests exist to prove the HTTP layer
/// itself: who each of the five endpoints authenticates, which failure maps to which
/// status/problem code, and that the two single-use surfaces (claim, payload fetch) stay
/// single-use when driven over real HTTP rather than in-process.
/// </summary>
public sealed class DevicePairingEndpointsTests
{
    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    /// <summary>Stand-ins for raw X25519 public keys -- opaque to this backend, so any distinguishable bytes will do.</summary>
    private static readonly byte[] PrimaryPublicKey = [0xA0, 0xA1, 0xA2, 0xA3];

    private static readonly byte[] NewDevicePublicKey = [0xB0, 0xB1, 0xB2, 0xB3];

    /// <summary>
    /// Stand-in for the primary's KEK encrypted to the claiming device. Deliberately
    /// includes 0x00 and 0xFF and is not valid UTF-8: this backend must relay it verbatim,
    /// and a byte-exact round-trip through base64/JSON is what the full-flow test proves.
    /// </summary>
    private static readonly byte[] EncryptedKek = [0x00, 0xFF, 0x10, 0x80, 0x7F, 0xC3, 0x28];

    [Fact]
    public async Task PostPairingSession_WithoutAuth_Returns401()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-create-no-token@example.com");
        client.DefaultRequestHeaders.Authorization = null;

        var response = await PostCreateAsync(client, accountId);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("auth.access_token_invalid", await ReadCodeAsync(response));
    }

    /// <summary>
    /// An <c>Authorization</c> header that is present but not a <c>Bearer</c> value is
    /// rejected exactly like a missing one -- no partial credit for merely sending
    /// something.
    /// </summary>
    [Fact]
    public async Task PostPairingSession_WithNonBearerAuthorizationHeader_Returns401()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-create-basic-auth@example.com");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", "not-a-bearer-token");

        var response = await PostCreateAsync(client, accountId);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("auth.access_token_invalid", await ReadCodeAsync(response));
    }

    /// <summary>
    /// A well-formed <c>Bearer</c> value carrying a token that was never issued (or has
    /// expired) resolves to no account at all -- rejected exactly like a token belonging to
    /// the wrong account, with no hint as to which of the two it was.
    /// </summary>
    [Fact]
    public async Task PostPairingSession_WithUnrecognizedBearerToken_Returns401()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-create-unknown-token@example.com");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "never-issued-token");

        var response = await PostCreateAsync(client, accountId);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("auth.access_token_invalid", await ReadCodeAsync(response));
    }

    /// <summary>
    /// Core account-scoping regression: a real, valid, unexpired access token for a
    /// DIFFERENT account must not open a pairing session against this account -- otherwise
    /// any authenticated user could mint a QR code that hands out someone else's KEK.
    /// 401 (not 403/404) with <c>auth.access_token_invalid</c> is what every account-scoped
    /// endpoint in this API already returns for "authenticated, but not as this account" --
    /// see <see cref="ProfessionalVerificationEndpoints"/>.
    /// </summary>
    [Fact]
    public async Task PostPairingSession_ForAnotherAccountId_Returns401()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (victimAccountId, _) = await RegisterAsync(client, "pairing-create-victim@example.com");
        // RegisterAsync leaves the client carrying the LAST registered account's token --
        // registering the attacker second means the client is now the attacker.
        await RegisterAsync(client, "pairing-create-attacker@example.com");

        var response = await PostCreateAsync(client, victimAccountId);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("auth.access_token_invalid", await ReadCodeAsync(response));
    }

    [Fact]
    public async Task PostPairingSession_Authenticated_Returns201WithSessionIdAndExpiry()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-create-ok@example.com");
        var before = DateTimeOffset.UtcNow;

        var response = await PostCreateAsync(client, accountId);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.CreatePairingSessionResponse);
        Assert.NotNull(body);
        Assert.False(string.IsNullOrWhiteSpace(body!.SessionId));
        Assert.True(body.ExpiresAt > before);
        Assert.True(body.ExpiresAt <= DateTimeOffset.UtcNow + DevicePairingIssuer.PairingSessionLifetime);
    }

    /// <summary>
    /// One code and one status for "never existed", "expired" and "already claimed" --
    /// see <see cref="ClaimPairingSessionFailureReason"/>. A caller must not be able to
    /// tell a guessed session id apart from a real one someone else already scanned.
    /// </summary>
    [Fact]
    public async Task PostClaim_UnknownSessionId_Returns404WithDevicePairingSessionNotFound()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await PostClaimAsync(client, "not-a-real-session-id");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("auth.device_pairing_session_not_found", await ReadCodeAsync(response));
    }

    [Fact]
    public async Task PostClaim_ValidSession_Returns200WithPrimaryPublicKey()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var sessionId = await CreateSessionAsync(client, "pairing-claim-ok@example.com");
        // The scanning device has no session for this account -- that is the whole point of
        // pairing -- so this call must succeed with no credential whatsoever.
        client.DefaultRequestHeaders.Authorization = null;

        var response = await PostClaimAsync(client, sessionId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.ClaimPairingSessionResponse);
        Assert.NotNull(body);
        Assert.Equal(PrimaryPublicKey, body!.PrimaryPublicKey);
    }

    /// <summary>
    /// Replay proof at the HTTP layer: first caller wins, which is what makes a
    /// photographed/screenshotted/shoulder-surfed QR code worthless.
    /// </summary>
    [Fact]
    public async Task PostClaim_CalledTwiceForSameSession_SecondCallReturns404()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var sessionId = await CreateSessionAsync(client, "pairing-claim-replay@example.com");
        var firstResponse = await PostClaimAsync(client, sessionId);
        Assert.Equal(HttpStatusCode.OK, firstResponse.StatusCode);

        var response = await PostClaimAsync(client, sessionId);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("auth.device_pairing_session_not_found", await ReadCodeAsync(response));
    }

    [Fact]
    public async Task GetClaimStatus_BeforeClaim_ReturnsClaimedFalse()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-status-pending@example.com");
        var sessionId = await CreateSessionForAsync(client, accountId);

        var response = await GetClaimStatusAsync(client, accountId, sessionId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.PairingClaimStatusResponse);
        Assert.NotNull(body);
        Assert.False(body!.Claimed);
        Assert.Null(body.NewDevicePublicKey);
    }

    [Fact]
    public async Task GetClaimStatus_AfterClaim_ReturnsClaimedTrueWithNewDevicePublicKey()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-status-claimed@example.com");
        var sessionId = await CreateSessionForAsync(client, accountId);
        await PostClaimAsync(client, sessionId);

        var response = await GetClaimStatusAsync(client, accountId, sessionId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.PairingClaimStatusResponse);
        Assert.NotNull(body);
        Assert.True(body!.Claimed);
        Assert.Equal(NewDevicePublicKey, body.NewDevicePublicKey);
    }

    [Fact]
    public async Task GetClaimStatus_WithoutAuth_Returns401()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-status-no-token@example.com");
        var sessionId = await CreateSessionForAsync(client, accountId);
        client.DefaultRequestHeaders.Authorization = null;

        var response = await GetClaimStatusAsync(client, accountId, sessionId);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("auth.access_token_invalid", await ReadCodeAsync(response));
    }

    /// <summary>
    /// Account-scoping regression: polling is authenticated, but authentication alone is not
    /// enough -- another account's session must be reported exactly as if it did not exist,
    /// or this endpoint becomes a probe for which pairing sessions other accounts have open.
    /// </summary>
    [Fact]
    public async Task GetClaimStatus_ForAnotherAccountsSession_Returns404WithDevicePairingSessionNotFound()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (victimAccountId, _) = await RegisterAsync(client, "pairing-status-victim@example.com");
        var victimSessionId = await CreateSessionForAsync(client, victimAccountId);
        var (attackerAccountId, _) = await RegisterAsync(client, "pairing-status-attacker@example.com");

        var response = await GetClaimStatusAsync(client, attackerAccountId, victimSessionId);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("auth.device_pairing_session_not_found", await ReadCodeAsync(response));
    }

    /// <summary>
    /// There is nothing to encrypt a KEK for until a device has claimed the session, so the
    /// primary cannot submit yet. 409, not 404: the session is real and the caller owns it.
    /// </summary>
    [Fact]
    public async Task PostPayload_BeforeClaim_Returns409WithDevicePairingPayloadNotReady()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-payload-not-claimed@example.com");
        var sessionId = await CreateSessionForAsync(client, accountId);

        var response = await PostPayloadAsync(client, accountId, sessionId);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("auth.device_pairing_payload_not_ready", await ReadCodeAsync(response));
    }

    [Fact]
    public async Task PostPayload_AfterClaim_Returns204()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-payload-ok@example.com");
        var sessionId = await CreateSessionForAsync(client, accountId);
        await PostClaimAsync(client, sessionId);

        var response = await PostPayloadAsync(client, accountId, sessionId);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    /// <summary>One handshake, one ciphertext -- resubmitting is the same 409 as submitting too early.</summary>
    [Fact]
    public async Task PostPayload_CalledTwice_SecondCallReturns409()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-payload-twice@example.com");
        var sessionId = await CreateSessionForAsync(client, accountId);
        await PostClaimAsync(client, sessionId);
        var firstResponse = await PostPayloadAsync(client, accountId, sessionId);
        Assert.Equal(HttpStatusCode.NoContent, firstResponse.StatusCode);

        var response = await PostPayloadAsync(client, accountId, sessionId);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("auth.device_pairing_payload_not_ready", await ReadCodeAsync(response));
    }

    [Fact]
    public async Task PostPayload_WithoutAuth_Returns401()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-payload-no-token@example.com");
        var sessionId = await CreateSessionForAsync(client, accountId);
        await PostClaimAsync(client, sessionId);
        client.DefaultRequestHeaders.Authorization = null;

        var response = await PostPayloadAsync(client, accountId, sessionId);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("auth.access_token_invalid", await ReadCodeAsync(response));
    }

    /// <summary>
    /// The one submission failure that is a 404 rather than a 409: no such session for this
    /// caller at all (unknown id, expired, or another account's -- the issuer collapses all
    /// three into <see cref="SubmitPairingPayloadFailureReason.NotFound"/>).
    /// </summary>
    [Fact]
    public async Task PostPayload_UnknownSession_Returns404WithDevicePairingSessionNotFound()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-payload-unknown@example.com");

        var response = await PostPayloadAsync(client, accountId, "not-a-real-session-id");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("auth.device_pairing_session_not_found", await ReadCodeAsync(response));
    }

    /// <summary>
    /// One code for "session unknown/expired", "primary hasn't submitted yet" and "already
    /// fetched once" -- the claiming device is expected to simply keep polling on this code
    /// until it gets the ciphertext, and distinguishing the reasons would only help an
    /// attacker enumerate session state (see <see cref="FetchPairingPayloadFailureReason"/>).
    /// </summary>
    [Fact]
    public async Task GetPayload_BeforeSubmit_Returns404WithDevicePairingPayloadNotDelivered()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var sessionId = await CreateSessionAsync(client, "pairing-fetch-early@example.com");
        await PostClaimAsync(client, sessionId);
        client.DefaultRequestHeaders.Authorization = null;

        var response = await GetPayloadAsync(client, sessionId);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("auth.device_pairing_payload_not_delivered", await ReadCodeAsync(response));
    }

    [Fact]
    public async Task GetPayload_AfterSubmit_Returns200WithEncryptedKek()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-fetch-ok@example.com");
        var sessionId = await CreateSessionForAsync(client, accountId);
        await PostClaimAsync(client, sessionId);
        await PostPayloadAsync(client, accountId, sessionId);
        // The claiming device has no session for this account -- it collects the ciphertext
        // with no credential but the session id it just won the claim on.
        client.DefaultRequestHeaders.Authorization = null;

        var response = await GetPayloadAsync(client, sessionId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.PairingSessionPayloadResponse);
        Assert.NotNull(body);
        Assert.Equal(EncryptedKek, body!.EncryptedKek);
    }

    /// <summary>Payload-replay proof at the HTTP layer: a successful fetch consumes the session outright.</summary>
    [Fact]
    public async Task GetPayload_CalledTwice_SecondCallReturns404()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-fetch-twice@example.com");
        var sessionId = await CreateSessionForAsync(client, accountId);
        await PostClaimAsync(client, sessionId);
        await PostPayloadAsync(client, accountId, sessionId);
        var firstResponse = await GetPayloadAsync(client, sessionId);
        Assert.Equal(HttpStatusCode.OK, firstResponse.StatusCode);

        var response = await GetPayloadAsync(client, sessionId);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("auth.device_pairing_payload_not_delivered", await ReadCodeAsync(response));
    }

    /// <summary>
    /// S02-07: a finished handshake alerts the account holder over e-mail -- proven here by
    /// driving the full Create-&gt;Claim-&gt;SubmitPayload flow over real HTTP and reading the
    /// capturing double back, same "override IMagicLinkEmailSender at the DI level, drive it
    /// over HTTP, read the capture back" precedent as AuthEndpointsTests's magic-link E2E
    /// tests.
    /// </summary>
    [Fact]
    public async Task PostPayload_AfterClaim_SendsNewDeviceAlertToAccountEmail()
    {
        const string email = "pairing-alert-sent@example.com";
        var (factory, sender) = CreateFactoryWithNewDeviceAlertCapture();
        using var factoryDisposable = factory;
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, email);
        var sessionId = await CreateSessionForAsync(client, accountId);
        await PostClaimAsync(client, sessionId);

        var response = await PostPayloadAsync(client, accountId, sessionId);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.True(sender.WasSentTo(email));
    }

    /// <summary>
    /// Swallow-on-failure proof over real HTTP, not just at the AccountService unit level
    /// (see <see cref="AccountServiceNewDeviceAlertTests.NotifyNewDeviceLinkedAsync_WhenAlertSenderThrows_CompletesWithoutThrowing"/>):
    /// runs against the DEFAULT <see cref="CreateFactory"/> wiring, which leaves
    /// INewDeviceAlertSender as the real, NotSupportedException-throwing
    /// <see cref="NewDeviceAlertSender"/> placeholder. The handshake must still report success.
    /// </summary>
    [Fact]
    public async Task PostPayload_AfterClaim_WithRealNewDeviceAlertSenderRegistration_StillReturns204()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "pairing-alert-swallowed@example.com");
        var sessionId = await CreateSessionForAsync(client, accountId);
        await PostClaimAsync(client, sessionId);

        var response = await PostPayloadAsync(client, accountId, sessionId);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    /// <summary>
    /// The whole handshake over HTTP, in the order two real devices would drive it, with the
    /// primary polling claim-status between steps exactly as it would while its QR code is on
    /// screen. The point of the final assertion is the transport, not the domain: the
    /// ciphertext the claiming device collects must be byte-for-byte what the primary
    /// submitted, so nothing in the base64/JSON layer mutates the opaque blob.
    /// </summary>
    [Fact]
    public async Task FullFlow_CreateClaimSubmitFetch_RelaysEncryptedKekByteForByte()
    {
        using var factory = CreateFactory();
        using var primary = factory.CreateClient();
        // A second client with no credentials at all -- the device doing the scanning.
        using var newDevice = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(primary, "pairing-full-flow@example.com");

        var sessionId = await CreateSessionForAsync(primary, accountId);

        var pendingStatus = await GetClaimStatusAsync(primary, accountId, sessionId);
        var pending = await pendingStatus.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.PairingClaimStatusResponse);
        Assert.False(pending!.Claimed);

        var claimResponse = await PostClaimAsync(newDevice, sessionId);
        Assert.Equal(HttpStatusCode.OK, claimResponse.StatusCode);
        var claimed = await claimResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.ClaimPairingSessionResponse);
        Assert.Equal(PrimaryPublicKey, claimed!.PrimaryPublicKey);

        var claimedStatus = await GetClaimStatusAsync(primary, accountId, sessionId);
        var observed = await claimedStatus.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.PairingClaimStatusResponse);
        Assert.True(observed!.Claimed);
        Assert.Equal(NewDevicePublicKey, observed.NewDevicePublicKey);

        var submitResponse = await PostPayloadAsync(primary, accountId, sessionId);
        Assert.Equal(HttpStatusCode.NoContent, submitResponse.StatusCode);

        var fetchResponse = await GetPayloadAsync(newDevice, sessionId);
        Assert.Equal(HttpStatusCode.OK, fetchResponse.StatusCode);
        var fetched = await fetchResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.PairingSessionPayloadResponse);
        Assert.Equal(EncryptedKek, fetched!.EncryptedKek);
    }

    private static Task<HttpResponseMessage> GetPayloadAsync(HttpClient client, string sessionId) =>
        client.GetAsync($"/devices/pairing-sessions/{sessionId}/payload");

    private static Task<HttpResponseMessage> PostPayloadAsync(HttpClient client, Guid accountId, string sessionId) =>
        client.PostAsJsonAsync(
            $"/accounts/{accountId}/devices/pairing-sessions/{sessionId}/payload",
            new SubmitPairingPayloadRequest(EncryptedKek),
            ApiJsonSerializerContext.Default.SubmitPairingPayloadRequest);

    private static Task<HttpResponseMessage> GetClaimStatusAsync(HttpClient client, Guid accountId, string sessionId) =>
        client.GetAsync($"/accounts/{accountId}/devices/pairing-sessions/{sessionId}/claim-status");

    private static Task<HttpResponseMessage> PostClaimAsync(HttpClient client, string sessionId) =>
        client.PostAsJsonAsync(
            $"/devices/pairing-sessions/{sessionId}/claim",
            new ClaimPairingSessionRequest(NewDevicePublicKey),
            ApiJsonSerializerContext.Default.ClaimPairingSessionRequest);

    /// <summary>
    /// Registers a fresh account and opens a pairing session for it, returning the session
    /// id the primary device would encode into its QR code. Leaves
    /// <paramref name="client"/> authenticated as that account.
    /// </summary>
    private static async Task<string> CreateSessionAsync(HttpClient client, string email)
    {
        var (accountId, _) = await RegisterAsync(client, email);
        return await CreateSessionForAsync(client, accountId);
    }

    /// <summary>
    /// Opens a pairing session for an account <paramref name="client"/> is already
    /// authenticated as, and returns its session id.
    /// </summary>
    private static async Task<string> CreateSessionForAsync(HttpClient client, Guid accountId)
    {
        var response = await PostCreateAsync(client, accountId);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.CreatePairingSessionResponse);
        return body!.SessionId;
    }

    private static Task<HttpResponseMessage> PostCreateAsync(HttpClient client, Guid accountId) =>
        client.PostAsJsonAsync(
            $"/accounts/{accountId}/devices/pairing-sessions",
            new CreatePairingSessionRequest(PrimaryPublicKey),
            ApiJsonSerializerContext.Default.CreatePairingSessionRequest);

    /// <summary>
    /// Registers a Patient account, whose <see cref="TwoFactorRequirement"/> is always
    /// <see cref="TwoFactorRequirement.NotApplicable"/> (ADR-S02-03) -- so registration
    /// completes a login outright and yields a real access token with no TOTP flow to stub.
    /// Device pairing is not professional-only, so this is the cheapest authenticated
    /// caller these tests can build. Side effect: leaves <paramref name="client"/> carrying
    /// this account's token as its default <c>Authorization: Bearer</c> header.
    /// </summary>
    private static async Task<(Guid AccountId, string AccessToken)> RegisterAsync(HttpClient client, string email)
    {
        var response = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest(email, SomeVerifier, AccountRole.Patient),
            ApiJsonSerializerContext.Default.RegisterRequest);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterResponse);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body!.AccessToken);
        return (body.Id, body.AccessToken!);
    }

    private static async Task<string?> ReadCodeAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("code").GetString();
    }

    private static WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                // Same reasoning as AuthEndpointsTests.CreateFactory: these endpoints never
                // touch Postgres, but app startup still needs a syntactically valid
                // ConnectionStrings:AppDb to construct the NpgsqlDataSource singleton.
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
                builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
            });

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountService.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }

    /// <summary>
    /// The S02-07 tests need a way to read back which e-mail <c>POST .../payload</c> alerted
    /// -- overrides the production <see cref="INewDeviceAlertSender"/> registration with the
    /// capturing fake, same "override at the DI level" precedent as
    /// <c>Api.Tests.Auth.AuthEndpointsTests.CreateFactoryWithMagicLinkCapture</c>.
    /// </summary>
    private static (WebApplicationFactory<Program> Factory, CapturingNewDeviceAlertSender Sender) CreateFactoryWithNewDeviceAlertCapture()
    {
        var sender = new CapturingNewDeviceAlertSender();
        var factory = CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<INewDeviceAlertSender>(sender)));
        return (factory, sender);
    }
}
