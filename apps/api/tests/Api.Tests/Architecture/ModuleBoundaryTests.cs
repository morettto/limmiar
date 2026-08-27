using System.Text.RegularExpressions;

namespace Api.Tests.Architecture;

public sealed class ModuleBoundaryTests
{
    private static readonly string ApiSourceRoot = ResolveApiSourceRoot();

    private static readonly string[] Layers = ["Domain", "Application", "Infrastructure", "Presentation"];

    private static readonly Regex TypeDeclarationPattern = new(
        @"^\s*(?:public|internal)\s+(?:static\s+|sealed\s+|abstract\s+|partial\s+|readonly\s+)*(?:class|record|interface|enum|struct)\s+(\w+)",
        RegexOptions.Multiline | RegexOptions.Compiled);

    [Fact]
    public void DomainFiles_NeverReferenceTheirOwnSlicesApplicationInfrastructureOrPresentationTypes()
    {
        var violations = new List<string>();

        foreach (var sliceRoot in EnumerateSliceRoots())
        {
            var domainFiles = EnumerateLayerFiles(sliceRoot, "Domain");
            if (domainFiles.Count == 0)
            {
                continue;
            }

            var forbiddenTypeNames = CollectTypeNames(sliceRoot, "Application");
            forbiddenTypeNames.UnionWith(CollectTypeNames(sliceRoot, "Infrastructure"));
            forbiddenTypeNames.UnionWith(CollectTypeNames(sliceRoot, "Presentation"));

            foreach (var file in domainFiles)
            {
                violations.AddRange(FindReferencedTypeNames(file, forbiddenTypeNames)
                    .Select(typeName => $"{RelativePath(file)} references {typeName}"));
            }
        }

        Assert.Empty(violations);
    }

    [Fact]
    public void ApplicationFiles_ExcludingPorts_NeverReferenceTheirOwnSlicesInfrastructureOrPresentationTypes()
    {
        var violations = new List<string>();

        foreach (var sliceRoot in EnumerateSliceRoots())
        {
            var applicationFiles = EnumerateLayerFiles(sliceRoot, "Application")
                .Where(file => !IsUnderPortsFolder(file))
                .ToList();
            if (applicationFiles.Count == 0)
            {
                continue;
            }

            var forbiddenTypeNames = CollectTypeNames(sliceRoot, "Infrastructure");
            forbiddenTypeNames.UnionWith(CollectTypeNames(sliceRoot, "Presentation"));

            foreach (var file in applicationFiles)
            {
                violations.AddRange(FindReferencedTypeNames(file, forbiddenTypeNames)
                    .Select(typeName => $"{RelativePath(file)} references {typeName}"));
            }
        }

        Assert.Empty(violations);
    }

    [Fact]
    public void InfrastructureFiles_NeverReferenceTheirOwnSlicesPresentationTypes()
    {
        var violations = new List<string>();

        foreach (var sliceRoot in EnumerateSliceRoots())
        {
            var infrastructureFiles = EnumerateLayerFiles(sliceRoot, "Infrastructure");
            if (infrastructureFiles.Count == 0)
            {
                continue;
            }

            var forbiddenTypeNames = CollectTypeNames(sliceRoot, "Presentation");

            foreach (var file in infrastructureFiles)
            {
                violations.AddRange(FindReferencedTypeNames(file, forbiddenTypeNames)
                    .Select(typeName => $"{RelativePath(file)} references {typeName}"));
            }
        }

        Assert.Empty(violations);
    }

    [Fact]
    public void DomainAndApplicationFiles_NeverReferenceInfrastructureOrPresentationTypesFromAnySlice()
    {
        var forbiddenTypeNames = new HashSet<string>(StringComparer.Ordinal);
        var domainAndApplicationFiles = new List<string>();

        foreach (var sliceRoot in EnumerateSliceRoots())
        {
            forbiddenTypeNames.UnionWith(CollectTypeNames(sliceRoot, "Infrastructure"));
            forbiddenTypeNames.UnionWith(CollectTypeNames(sliceRoot, "Presentation"));

            domainAndApplicationFiles.AddRange(EnumerateLayerFiles(sliceRoot, "Domain"));
            domainAndApplicationFiles.AddRange(EnumerateLayerFiles(sliceRoot, "Application"));
        }

        var violations = new List<string>();

        foreach (var file in domainAndApplicationFiles)
        {
            violations.AddRange(FindReferencedTypeNames(file, forbiddenTypeNames)
                .Select(typeName => $"{RelativePath(file)} references {typeName}"));
        }

        Assert.Empty(violations);
    }

    [Fact]
    public void FeatureFiles_NeverReferenceAnotherFeaturesNamespace()
    {
        var featureNamespacesByFolder = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Accounts"] = "Api.Accounts",
            ["Health"] = "Api.Health",
        };
        var violations = new List<string>();

        foreach (var (featureFolder, _) in featureNamespacesByFolder)
        {
            var featureRoot = Path.Combine(ApiSourceRoot, "Features", featureFolder);
            foreach (var file in Directory.GetFiles(featureRoot, "*.cs", SearchOption.AllDirectories))
            {
                var content = File.ReadAllText(file);
                foreach (var (otherFolder, otherNamespace) in featureNamespacesByFolder)
                {
                    if (otherFolder == featureFolder)
                    {
                        continue;
                    }

                    if (content.Contains(otherNamespace, StringComparison.Ordinal))
                    {
                        violations.Add($"{RelativePath(file)} references {otherNamespace}");
                    }
                }
            }
        }

        Assert.Empty(violations);
    }

    [Fact]
    public void PlatformFiles_NeverReferenceAccountsOrHealth()
    {
        var platformRoot = Path.Combine(ApiSourceRoot, "Platform");
        var violations = new List<string>();

        foreach (var file in Directory.GetFiles(platformRoot, "*.cs", SearchOption.AllDirectories))
        {
            var content = File.ReadAllText(file);
            if (content.Contains("Api.Accounts", StringComparison.Ordinal))
            {
                violations.Add($"{RelativePath(file)} references Api.Accounts");
            }

            if (content.Contains("Api.Health", StringComparison.Ordinal))
            {
                violations.Add($"{RelativePath(file)} references Api.Health");
            }
        }

        Assert.Empty(violations);
    }

    private static IEnumerable<string> EnumerateSliceRoots()
    {
        var accountsRoot = Path.Combine(ApiSourceRoot, "Features", "Accounts");
        yield return accountsRoot;

        foreach (var directory in Directory.GetDirectories(accountsRoot))
        {
            if (HasAnyLayerFolder(directory))
            {
                yield return directory;
            }
        }
    }

    private static bool HasAnyLayerFolder(string sliceRoot) =>
        Layers.Any(layer => Directory.Exists(Path.Combine(sliceRoot, layer)));

    private static List<string> EnumerateLayerFiles(string sliceRoot, string layer)
    {
        var layerDirectory = Path.Combine(sliceRoot, layer);
        return Directory.Exists(layerDirectory)
            ? Directory.GetFiles(layerDirectory, "*.cs", SearchOption.AllDirectories).ToList()
            : [];
    }

    private static bool IsUnderPortsFolder(string file) =>
        file.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Contains("Ports");

    private static HashSet<string> CollectTypeNames(string sliceRoot, string layer)
    {
        var typeNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in EnumerateLayerFiles(sliceRoot, layer))
        {
            foreach (Match match in TypeDeclarationPattern.Matches(File.ReadAllText(file)))
            {
                typeNames.Add(match.Groups[1].Value);
            }
        }

        return typeNames;
    }

    private static IEnumerable<string> FindReferencedTypeNames(string file, IReadOnlyCollection<string> candidateTypeNames)
    {
        if (candidateTypeNames.Count == 0)
        {
            yield break;
        }

        var content = File.ReadAllText(file);
        var declaredHere = TypeDeclarationPattern.Matches(content).Select(match => match.Groups[1].Value).ToHashSet(StringComparer.Ordinal);

        foreach (var typeName in candidateTypeNames)
        {
            if (declaredHere.Contains(typeName))
            {
                continue;
            }

            if (Regex.IsMatch(content, $@"\b{Regex.Escape(typeName)}\b"))
            {
                yield return typeName;
            }
        }
    }

    private static string RelativePath(string fullPath) => Path.GetRelativePath(ApiSourceRoot, fullPath);

    private static string ResolveApiSourceRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "src", "Api");
            if (Directory.Exists(Path.Combine(candidate, "Features")) && Directory.Exists(Path.Combine(candidate, "Platform")))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate apps/api/src/Api by walking up from AppContext.BaseDirectory.");
    }
}
