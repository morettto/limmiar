using System.Text.RegularExpressions;
using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class BackupCodeGeneratorTests
{
    private static readonly Regex CodeFormat = new("^[0-9a-f]{5}-[0-9a-f]{5}$", RegexOptions.Compiled);

    [Fact]
    public void GenerateCodes_ReturnsRequestedCount_AllUnique_AndCorrectFormat()
    {
        var codes = BackupCodeGenerator.GenerateCodes(10);

        Assert.Equal(10, codes.Count);
        Assert.Equal(10, codes.Distinct().Count());
        Assert.All(codes, code => Assert.Matches(CodeFormat, code));
    }

    [Fact]
    public void GenerateCodes_WithCustomCount_ReturnsThatManyUniqueCodes()
    {
        var codes = BackupCodeGenerator.GenerateCodes(25);

        Assert.Equal(25, codes.Count);
        Assert.Equal(25, codes.Distinct().Count());
    }

    [Fact]
    public void Hash_IsDeterministic_ForTheSameCode()
    {
        var code = "abcde-12345";

        Assert.Equal(BackupCodeGenerator.Hash(code), BackupCodeGenerator.Hash(code));
    }

    [Fact]
    public void Hash_DiffersForDifferentCodes()
    {
        Assert.NotEqual(BackupCodeGenerator.Hash("abcde-12345"), BackupCodeGenerator.Hash("abcde-99999"));
    }

    [Theory]
    [InlineData("abcde-12345", "abcde12345")]
    [InlineData("abcde-12345", "ABCDE-12345")]
    [InlineData("abcde-12345", "ABCDE12345")]
    public void Hash_NormalizesHyphenAndCase_ToTheSameHash(string canonical, string variant)
    {
        Assert.Equal(BackupCodeGenerator.Hash(canonical), BackupCodeGenerator.Hash(variant));
    }
}
