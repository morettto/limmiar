using System.Text.Json.Serialization;
using Api.Accounts;

namespace Api.Patients;

public static class PatientsComposition
{
    public static void AddPatients(this IServiceCollection services)
    {
        services.AddSingleton<PatientRecordStore>();
        services.AddSingleton(sp => new PatientService(
            sp.GetRequiredService<IAccountStore>(),
            sp.GetRequiredService<PatientRecordStore>()));

        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, PatientsJsonContext.Default);
        });
    }

    public static void MapPatients(this WebApplication app)
    {
        app.MapPatientEndpoints();
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(CreatePatientRequest))]
[JsonSerializable(typeof(CreatePatientResponse))]
[JsonSerializable(typeof(AppendPatientEntryRequest))]
[JsonSerializable(typeof(AppendPatientEntryResponse))]
[JsonSerializable(typeof(PatientRecordResponse))]
[JsonSerializable(typeof(PatientEntryResponse))]
[JsonSerializable(typeof(PatientSummaryResponse))]
[JsonSerializable(typeof(ListPatientsResponse))]
public partial class PatientsJsonContext : JsonSerializerContext
{
}
