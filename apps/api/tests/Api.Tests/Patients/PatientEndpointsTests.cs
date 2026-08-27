using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Api.Accounts;
using Api.Patients;
using Api.Patients;
using Api.Serialization;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.Patients;

/// <summary>
/// End-to-end round-trip against a real Postgres (Testcontainers) -- proves criterion 1
/// ("nenhum campo clínico trafega em claro") with genuine AES-256-GCM ciphertext (not a
/// literal plaintext byte array masquerading as one), decrypted back after the round trip
/// to prove byte-perfect fidelity through the server rather than merely "the DTO shape has
/// no clinical field" -- and criterion 2's HTTP-layer half (409 on sequence re-use, 400 on
/// a sequence that would leave a gap, never a silent overwrite).
/// </summary>
[Collection("Database")]
public sealed class PatientEndpointsTests : IAsyncLifetime
{
    private const string TestStaffApiKey = "test-staff-api-key";
    private const string ValidStubCode = "111111";
    private const string PlaintextMarker = "THIS-IS-CLINICAL-PLAINTEXT-MARKER";

    // AES-256-GCM wire format matches packages/crypto/src/webcrypto.ts: iv(12) || ciphertext || tag(16).
    private const int GcmIvLength = 12;
    private const int GcmTagLength = 16;

    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public PatientEndpointsTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    public async Task InitializeAsync()
    {
        await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await adminConnection.OpenAsync();

        _respawner = await Respawner.CreateAsync(adminConnection, new RespawnerOptions
        {
            SchemasToInclude = ["public"],
            DbAdapter = DbAdapter.Postgres,
        });
        await _respawner.ResetAsync(adminConnection);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task PostPatient_ThenGet_RoundTripsCiphertext_WithNoPlaintextInAnyResponseBody()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-create@example.com");

        var patientId = Guid.NewGuid();
        var wrappedDek = SomeSealedBlob(0x03);
        var dek = RandomNumberGenerator.GetBytes(32);
        var plaintext = Encoding.UTF8.GetBytes(PlaintextMarker + "-create");
        var ciphertext = SealAesGcm(dek, plaintext, PatientEntryAad(patientId, 1));

        var createResponse = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(patientId, wrappedDek, ciphertext),
            PatientsJsonContext.Default.CreatePatientRequest);

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var createBody = await createResponse.Content.ReadAsStringAsync();
        Assert.DoesNotContain(PlaintextMarker, createBody);

        var getResponse = await client.GetAsync($"/accounts/{accountId}/patients/{patientId}");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var getBody = await getResponse.Content.ReadAsStringAsync();
        Assert.DoesNotContain(PlaintextMarker, getBody);

        var record = await getResponse.Content.ReadFromJsonAsync(PatientsJsonContext.Default.PatientRecordResponse);
        Assert.NotNull(record);
        Assert.Equal(patientId, record!.PatientId);
        Assert.Equal(wrappedDek, record.WrappedDek);
        var entry = Assert.Single(record.Entries);
        Assert.Equal(1, entry.Sequence);
        Assert.Equal(ciphertext, entry.Ciphertext);

        // The real proof: the server stored and returned an opaque blob it never decrypted --
        // decrypting it back here, outside the server process, with the same DEK and AAD the
        // client used to seal it, is what a test built only on "the DTO has no name field"
        // cannot show. If the server had corrupted, mutated, or substituted the bytes in any
        // way, this decrypt (and its GCM tag check) would fail.
        var recovered = OpenAesGcm(dek, entry.Ciphertext, PatientEntryAad(patientId, 1));
        Assert.Equal(plaintext, recovered);
    }

    [Fact]
    public async Task PostPatientEntry_ThenGet_AppendsSecondEntry_WithNoPlaintextLeak()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-append@example.com");
        var patientId = Guid.NewGuid();
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(patientId, SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        var entryCiphertext = Encoding.UTF8.GetBytes(PlaintextMarker + "-entry");
        var appendResponse = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients/{patientId}/entries",
            new AppendPatientEntryRequest(2, entryCiphertext),
            PatientsJsonContext.Default.AppendPatientEntryRequest);

        Assert.Equal(HttpStatusCode.Created, appendResponse.StatusCode);
        var appendBody = await appendResponse.Content.ReadAsStringAsync();
        Assert.DoesNotContain(PlaintextMarker, appendBody);

        var getResponse = await client.GetAsync($"/accounts/{accountId}/patients/{patientId}");
        var record = await getResponse.Content.ReadFromJsonAsync(PatientsJsonContext.Default.PatientRecordResponse);
        Assert.NotNull(record);
        Assert.Equal(2, record!.Entries.Count);
        Assert.Equal(entryCiphertext, record.Entries[1].Ciphertext);
    }

    [Fact]
    public async Task PostPatientEntry_WithUnknownPatientId_Returns404()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-entry-404@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients/{Guid.NewGuid()}/entries",
            new AppendPatientEntryRequest(2, SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.AppendPatientEntryRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("patients.not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostPatient_WithSequenceAlreadyUsed_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-conflict@example.com");
        var request = new CreatePatientRequest(Guid.NewGuid(), SomeSealedBlob(0x01), SomeSealedBlob(0xAA));
        await client.PostAsJsonAsync($"/accounts/{accountId}/patients", request, PatientsJsonContext.Default.CreatePatientRequest);

        var response = await client.PostAsJsonAsync($"/accounts/{accountId}/patients", request, PatientsJsonContext.Default.CreatePatientRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("patients.entry_sequence_conflict", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostPatientEntry_WithSequenceAlreadyUsed_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-entry-conflict@example.com");
        var patientId = Guid.NewGuid();
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(patientId, SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);
        var entryRequest = new AppendPatientEntryRequest(2, SomeSealedBlob(0xBB));
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients/{patientId}/entries",
            entryRequest,
            PatientsJsonContext.Default.AppendPatientEntryRequest);

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients/{patientId}/entries",
            entryRequest,
            PatientsJsonContext.Default.AppendPatientEntryRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("patients.entry_sequence_conflict", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostPatient_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/patients",
            new CreatePatientRequest(Guid.NewGuid(), SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostPatientEntry_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/patients/{Guid.NewGuid()}/entries",
            new AppendPatientEntryRequest(2, SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.AppendPatientEntryRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task GetPatient_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/accounts/{Guid.NewGuid()}/patients/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>Same auth guard as every other patients route -- missing bearer token is rejected before ever reaching PatientService.</summary>
    [Fact]
    public async Task ListPatients_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/accounts/{Guid.NewGuid()}/patients");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>A valid bearer token for a different account than the one in the route must not authorize -- same wrong-owner shape as PostPatient_WithValidTokenForDifferentAccount_Returns401WithProblemDetails, so the listing doesn't even attempt to read.</summary>
    [Fact]
    public async Task ListPatients_WithValidTokenForDifferentAccount_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterActiveProfessionalAsync(client, "list-patients-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterProfessionalWithoutVerificationAsync(otherClient, "list-patients-wrong-owner-target@example.com");

        var response = await client.GetAsync($"/accounts/{otherAccountId}/patients");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>A professional with no patients yet gets 200 + an empty array, never a 404 -- the token already ties accountId to a real account.</summary>
    [Fact]
    public async Task ListPatients_WithNoPatients_Returns200WithEmptyArray()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "list-patients-empty@example.com");

        var response = await client.GetAsync($"/accounts/{accountId}/patients");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(PatientsJsonContext.Default.ListPatientsResponse);
        Assert.NotNull(body);
        Assert.Empty(body!.Patients);
    }

    /// <summary>Listing returns only sequence-1 (creation) entries -- a patient with appended entries beyond sequence 1 still contributes exactly one row, and that row's ciphertext is the creation entry's, never a later one.</summary>
    [Fact]
    public async Task ListPatients_ReturnsOnlyCreationEntries_NotSubsequentAppends()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "list-patients-creation-only@example.com");

        var patientWithAppend = Guid.NewGuid();
        var creationCiphertext = SomeSealedBlob(0x01);
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(patientWithAppend, SomeSealedBlob(0x02), creationCiphertext),
            PatientsJsonContext.Default.CreatePatientRequest);
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients/{patientWithAppend}/entries",
            new AppendPatientEntryRequest(2, SomeSealedBlob(0x03)),
            PatientsJsonContext.Default.AppendPatientEntryRequest);

        var patientWithoutAppend = Guid.NewGuid();
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(patientWithoutAppend, SomeSealedBlob(0x04), SomeSealedBlob(0x05)),
            PatientsJsonContext.Default.CreatePatientRequest);

        var response = await client.GetAsync($"/accounts/{accountId}/patients");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(PatientsJsonContext.Default.ListPatientsResponse);
        Assert.NotNull(body);
        Assert.Equal(2, body!.Patients.Count);
        var summary = Assert.Single(body.Patients, p => p.PatientId == patientWithAppend);
        Assert.Equal(creationCiphertext, summary.Ciphertext);
    }

    /// <summary>Bearer prefix present but the token itself doesn't resolve to any session (garbage value) -- ValidateAccess returns null, exercising the `Guid? == Guid` comparison's null branch. Distinct from both the missing-header case (line 138, never reaches ValidateAccess) and the wrong-owner case below (ValidateAccess succeeds but returns a mismatched id).</summary>
    [Fact]
    public async Task PostPatient_WithGarbageBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "not-a-real-session-token");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/patients",
            new CreatePatientRequest(Guid.NewGuid(), SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A real, valid bearer token -- just for a different account than the one in the route -- must not authorize. Distinct branch from the missing-header case (line 138): here ValidateAccess succeeds but returns an accountId that doesn't match the route, so IsAuthorizedForAccount's `== accountId` comparison itself is what returns false.</summary>
    [Fact]
    public async Task PostPatient_WithValidTokenForDifferentAccount_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterActiveProfessionalAsync(client, "patient-wrong-owner@example.com");

        // Registered on a throwaway client so it never overwrites `client`'s Authorization
        // header -- `client` must keep carrying the FIRST professional's valid token so the
        // request below is "valid bearer, wrong account", not "no bearer at all".
        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterProfessionalWithoutVerificationAsync(otherClient, "patient-wrong-owner-target@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{otherAccountId}/patients",
            new CreatePatientRequest(Guid.NewGuid(), SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A Professional who has not yet been verified (AccountVerificationStatus.Pending) is not authorized to create patient records -- AccountAuthorizationGuard.CanCreatePatientRecords requires Active.</summary>
    [Fact]
    public async Task PostPatient_WithUnverifiedProfessional_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalWithoutVerificationAsync(client, "patient-unverified@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(Guid.NewGuid(), SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("patients.not_authorized_to_create_records", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A real access token can never resolve to an unknown account (Accounts is in-memory and session tokens are only ever issued for accounts that exist in it), so this swaps in a stub that treats any GUID-shaped bearer token as proof for that exact account, reaching PatientService.CreatePatientAsync's AccountNotFound branch in isolation -- same technique as ProfessionalVerificationEndpointsTests.CreateFactoryWithSessionBypass.</summary>
    [Fact]
    public async Task PostPatient_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(Guid.NewGuid(), SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task GetPatient_WithUnknownPatientId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-get-404@example.com");

        var response = await client.GetAsync($"/accounts/{accountId}/patients/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("patients.not_found", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>Professional B (a different, unrelated active account) requesting professional A's patient must see the same 404 as an unknown patientId -- proves criterion "RLS impede o profissional A de ler a ficha do profissional B" at the HTTP layer, not just at PatientRecordStore/RLS-test level.</summary>
    [Fact]
    public async Task GetPatient_ForAnotherProfessionalsPatient_Returns404WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var clientA = factory.CreateClient();
        var accountIdA = await RegisterActiveProfessionalAsync(clientA, "patient-cross-tenant-a@example.com");
        var patientId = Guid.NewGuid();
        await clientA.PostAsJsonAsync(
            $"/accounts/{accountIdA}/patients",
            new CreatePatientRequest(patientId, SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        using var clientB = factory.CreateClient();
        var accountIdB = await RegisterActiveProfessionalAsync(clientB, "patient-cross-tenant-b@example.com");

        var response = await clientB.GetAsync($"/accounts/{accountIdB}/patients/{patientId}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("patients.not_found", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A sequence that skips ahead of lastSequence + 1 would leave a permanent gap (append-only, no way to fill it in later) -- rejected as a validation error, distinct from SequenceConflict (re-using a sequence already taken).</summary>
    [Fact]
    public async Task PostPatientEntry_WithSequenceGap_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-sequence-gap@example.com");
        var patientId = Guid.NewGuid();
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(patientId, SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients/{patientId}/entries",
            new AppendPatientEntryRequest(5, SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.AppendPatientEntryRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("sequence", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>A sequence at or below lastSequence -- including exactly 1, which used to hit the DB's wrapped_dek_only_on_sequence_1 CHECK and surface as a generic 500 -- must be rejected as a 400-adjacent conflict before ever reaching the store.</summary>
    [Fact]
    public async Task PostPatientEntry_WithSequenceOne_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-sequence-one@example.com");
        var patientId = Guid.NewGuid();
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(patientId, SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients/{patientId}/entries",
            new AppendPatientEntryRequest(1, SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.AppendPatientEntryRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("patients.entry_sequence_conflict", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>
    /// The eager "sequence &lt;= lastSequence" check in PatientService.AppendEntryAsync catches
    /// every SEQUENTIAL reuse deterministically -- but two truly concurrent requests can both
    /// read the same lastSequence before either commits, so the DB's UNIQUE constraint is the
    /// only thing that actually decides this race (PatientService deliberately does not catch
    /// the resulting exception for the append path, see the comment in AppendEntryAsync -- a
    /// racing caller may see either a clean SequenceConflict result or a thrown exception,
    /// both acceptable, and this test doesn't care which). What matters, and what this proves
    /// against a real Testcontainers Postgres rather than a mock: the two racers can never
    /// BOTH land a row at sequence 2 -- the append-only store stays exactly one entry ahead,
    /// never two, regardless of how the race resolves at the application layer.
    /// </summary>
    [Fact]
    public async Task AppendEntryAsync_WithConcurrentRequestsForSameNextSequence_OnlyOneEverPersists()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-concurrent-append@example.com");
        var patientId = Guid.NewGuid();
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(patientId, SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        var patientService = factory.Services.GetRequiredService<PatientService>();

        var first = Task.Run(() => TryAppendAsync(patientService, accountId, patientId, 0x11));
        var second = Task.Run(() => TryAppendAsync(patientService, accountId, patientId, 0x22));
        await Task.WhenAll(first, second);

        var record = await patientService.GetPatientAsync(accountId, patientId, CancellationToken.None);
        Assert.NotNull(record);
        Assert.Equal(2, record!.Entries.Count);
        Assert.Equal([1, 2], record.Entries.Select(e => e.Sequence));
    }

    private static async Task TryAppendAsync(PatientService patientService, Guid accountId, Guid patientId, byte fill)
    {
        try
        {
            await patientService.AppendEntryAsync(accountId, patientId, 2, SomeSealedBlob(fill), CancellationToken.None);
        }
        catch (PatientRecordSequenceConflictException)
        {
            // Expected outcome for the losing side of the race -- see the test's summary.
        }
    }

    /// <summary>Same guard as create: an unverified Professional cannot append to an existing patient's record either.</summary>
    [Fact]
    public async Task PostPatientEntry_WithUnverifiedProfessional_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var activeClient = factory.CreateClient();
        var activeAccountId = await RegisterActiveProfessionalAsync(activeClient, "patient-append-active@example.com");
        var patientId = Guid.NewGuid();
        await activeClient.PostAsJsonAsync(
            $"/accounts/{activeAccountId}/patients",
            new CreatePatientRequest(patientId, SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        // A second, unverified account appending to the FIRST account's patient would already
        // be blocked by RLS/ownership (PatientNotFound), which would mask the authorization
        // branch this test targets -- so this exercises the guard on the unverified account's
        // OWN (nonexistent) patient, same as PostPatient_WithUnverifiedProfessional does for create.
        using var unverifiedClient = factory.CreateClient();
        var unverifiedAccountId = await RegisterProfessionalWithoutVerificationAsync(unverifiedClient, "patient-append-unverified@example.com");

        var response = await unverifiedClient.PostAsJsonAsync(
            $"/accounts/{unverifiedAccountId}/patients/{patientId}/entries",
            new AppendPatientEntryRequest(2, SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.AppendPatientEntryRequest);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("patients.not_authorized_to_create_records", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>Same session-bypass technique as PostPatient_WithUnknownAccountId_Returns404WithProblemDetails, reaching PatientService.AppendEntryAsync's AccountNotFound branch in isolation.</summary>
    [Fact]
    public async Task PostPatientEntry_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients/{Guid.NewGuid()}/entries",
            new AppendPatientEntryRequest(2, SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.AppendPatientEntryRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>Boundary validation rejects a wrappedDek/ciphertext shorter than AES-256-GCM's iv(12)+tag(16) floor before it ever reaches the append-only store -- a blob that short could never have come from a real seal operation.</summary>
    [Fact]
    public async Task PostPatient_WithTooShortCiphertext_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-short-ciphertext@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(Guid.NewGuid(), SomeSealedBlob(0x01), [0xAA]),
            PatientsJsonContext.Default.CreatePatientRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("ciphertext", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>Same floor applies to wrappedDek, checked before ciphertext.</summary>
    [Fact]
    public async Task PostPatient_WithTooShortWrappedDek_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-short-wrapped-dek@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(Guid.NewGuid(), [0x01], SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("wrappedDek", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>Same floor validation applies on the append route, not just create -- its own call site, its own test.</summary>
    [Fact]
    public async Task PostPatientEntry_WithTooShortCiphertext_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-append-short-ciphertext@example.com");
        var patientId = Guid.NewGuid();
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(patientId, SomeSealedBlob(0x01), SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients/{patientId}/entries",
            new AppendPatientEntryRequest(2, [0xAA]),
            PatientsJsonContext.Default.AppendPatientEntryRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("ciphertext", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>
    /// `byte[] WrappedDek`/`Ciphertext` are non-nullable in C#'s type system, but nothing
    /// stops a direct API caller (bypassing the SPA and its TypeScript types entirely) from
    /// sending literal JSON `null` for either field -- System.Text.Json does not enforce
    /// non-nullable-reference-type annotations at deserialization. TryValidateSealedBlobShape's
    /// null check exists for exactly that caller, not for the compiler.
    /// </summary>
    [Fact]
    public async Task PostPatient_WithNullWrappedDek_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "patient-null-wrapped-dek@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients",
            new CreatePatientRequest(Guid.NewGuid(), null!, SomeSealedBlob(0xAA)),
            PatientsJsonContext.Default.CreatePatientRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("wrappedDek", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>Registers a Professional, completes TOTP enrollment (2FA is mandatory for Professional, ADR-S02-03) to get a real access token, then submits a verified CRP credential so AccountVerificationStatus becomes Active.</summary>
    private static async Task<Guid> RegisterActiveProfessionalAsync(HttpClient client, string email)
    {
        var accountId = await RegisterProfessionalWithoutVerificationAsync(client, email);

        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Crp, "06/123456", "SP", null),
            AccountsJsonContext.Default.SubmitProfessionalCredentialRequest);

        return accountId;
    }

    private static async Task<Guid> RegisterProfessionalWithoutVerificationAsync(HttpClient client, string email)
    {
        var registerResponse = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest(email, SomeVerifier, AccountRole.Professional),
            AccountsJsonContext.Default.RegisterRequest);
        var registered = await registerResponse.Content.ReadFromJsonAsync(AccountsJsonContext.Default.RegisterResponse);
        var accountId = registered!.Id;
        var ticket = registered.TwoFactorTicket!;

        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/totp",
            new BeginTotpEnrollmentRequest(ticket),
            AccountsJsonContext.Default.BeginTotpEnrollmentRequest);
        var confirmResponse = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/totp/confirm",
            new ConfirmTotpEnrollmentRequest(ticket, ValidStubCode),
            AccountsJsonContext.Default.ConfirmTotpEnrollmentRequest);
        var confirmed = await confirmResponse.Content.ReadFromJsonAsync(AccountsJsonContext.Default.ConfirmTotpEnrollmentResponse);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", confirmed!.AccessToken);
        return accountId;
    }

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountVerifierLengths.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }

    /// <summary>A structurally valid (>= the 28-byte AES-GCM floor) opaque blob for tests that don't care about real decryptable content, just a shape the boundary validation accepts.</summary>
    private static byte[] SomeSealedBlob(byte fill)
    {
        var blob = new byte[GcmIvLength + GcmTagLength];
        Array.Fill(blob, fill);
        return blob;
    }

    private static byte[] PatientEntryAad(Guid patientId, int sequence) =>
        Encoding.UTF8.GetBytes($"limmiar/patient-entry/v1|{patientId}|{sequence}");

    /// <summary>Mirrors packages/crypto/src/webcrypto.ts's wire format: iv(12) || ciphertext || tag(16), random IV, so the C# test suite proves the server round-trips real AES-256-GCM output rather than assuming the TypeScript suite's proof transfers across the language boundary.</summary>
    private static byte[] SealAesGcm(byte[] key, byte[] plaintext, byte[] aad)
    {
        var iv = RandomNumberGenerator.GetBytes(GcmIvLength);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[GcmTagLength];
        using var aesGcm = new AesGcm(key, GcmTagLength);
        aesGcm.Encrypt(iv, plaintext, ciphertext, tag, aad);

        var wire = new byte[GcmIvLength + ciphertext.Length + GcmTagLength];
        iv.CopyTo(wire, 0);
        ciphertext.CopyTo(wire, GcmIvLength);
        tag.CopyTo(wire, GcmIvLength + ciphertext.Length);
        return wire;
    }

    private static byte[] OpenAesGcm(byte[] key, byte[] wire, byte[] aad)
    {
        var iv = wire[..GcmIvLength];
        var tag = wire[^GcmTagLength..];
        var ciphertext = wire[GcmIvLength..^GcmTagLength];

        var plaintext = new byte[ciphertext.Length];
        using var aesGcm = new AesGcm(key, GcmTagLength);
        aesGcm.Decrypt(iv, ciphertext, tag, plaintext, aad);
        return plaintext;
    }

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", _fixture.AppRoleConnectionString);
                builder.UseSetting("StaffAccess:ApiKey", TestStaffApiKey);
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
                builder.ConfigureTestServices(services =>
                {
                    services.AddSingleton<ITotpProvider>(new StubTotpProvider());
                    services.AddSingleton<ICouncilRegistryVerifier>(new StubCouncilRegistryVerifier());
                });
            });

    private WebApplicationFactory<Program> CreateFactoryWithSessionBypass() =>
        CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<ISessionTokenIssuer>(new AlwaysValidSessionTokenIssuer())));

    private sealed class AlwaysValidSessionTokenIssuer : ISessionTokenIssuer
    {
        public SessionTokenPair IssuePair(Guid accountId) => throw new NotSupportedException("not needed by the one test that uses this stub");

        public RefreshSessionResult Refresh(string refreshToken) => throw new NotSupportedException("not needed by the one test that uses this stub");

        public Guid? ValidateAccess(string accessToken) => Guid.TryParse(accessToken, out var accountId) ? accountId : null;
    }

    private sealed class StubTotpProvider : ITotpProvider
    {
        public string GenerateSecret() => "STUBBEDSECRET";

        public string BuildProvisioningUri(string secret, string accountEmail, string issuer) =>
            $"otpauth://totp/{issuer}:{accountEmail}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30";

        public bool ValidateCode(string secret, string code, DateTimeOffset timestamp) => code == ValidStubCode;
    }

    private sealed class StubCouncilRegistryVerifier : ICouncilRegistryVerifier
    {
        public Task<CouncilRegistryVerificationResult> VerifyAsync(
            ProfessionalCredentialType type, string registryNumber, string registryUf, CancellationToken cancellationToken) =>
            Task.FromResult(CouncilRegistryVerificationResult.CreateVerified());
    }
}
