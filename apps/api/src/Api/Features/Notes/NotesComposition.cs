using System.Text.Json.Serialization;
using Api.Accounts;

namespace Api.Notes;

public static class NotesComposition
{
    public static void AddNotes(this IServiceCollection services)
    {
        services.AddSingleton<NoteSignatureStore>();
        services.AddSingleton(sp => new NoteService(
            sp.GetRequiredService<IAccountStore>(),
            sp.GetRequiredService<NoteSignatureStore>()));

        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, NotesJsonContext.Default);
        });
    }

    public static void MapNotes(this WebApplication app)
    {
        app.MapNoteEndpoints();
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(SignNoteRequest))]
[JsonSerializable(typeof(SignNoteResponse))]
[JsonSerializable(typeof(NoteSignatureResponse))]
public partial class NotesJsonContext : JsonSerializerContext
{
}
