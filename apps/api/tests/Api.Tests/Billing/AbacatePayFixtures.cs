namespace Api.Tests.Billing;

/// <summary>
/// Molde <c>ProblemDetailsProviderPactTests.ResolvePactFilePath</c>
/// (apps/api/tests/Api.Tests/Contracts/ProblemDetailsProviderPactTests.cs:70-88):
/// <see cref="AppContext.BaseDirectory"/> em tempo de teste é o diretório de output do build,
/// não a árvore de fontes -- sobe a partir daí em vez de assumir uma profundidade relativa
/// fixa. As fixtures vivem em Billing/fixtures/ ao lado deste ficheiro, sem item de csproj.
/// </summary>
internal static class AbacatePayFixtures
{
    public static byte[] ReadBytes(string fileName)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "Billing", "fixtures", fileName);
            if (File.Exists(candidate))
            {
                return File.ReadAllBytes(candidate);
            }

            directory = directory.Parent;
        }

        throw new FileNotFoundException($"Could not locate Billing/fixtures/{fileName} by walking up from AppContext.BaseDirectory.");
    }
}
