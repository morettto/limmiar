using Api.Platform;

namespace Api.Tests.Platform;

public sealed class ResultTests
{
    [Fact]
    public void Success_TryGetValue_ReturnsTrueAndTheValue()
    {
        var result = Result<string, TestFailure>.Success("payload");

        var got = result.TryGetValue(out var value, out var failure);

        Assert.True(got);
        Assert.Equal("payload", value);
        Assert.Equal(default(TestFailure), failure);
    }

    [Fact]
    public void Success_TryGetFailure_ReturnsFalse()
    {
        var result = Result<string, TestFailure>.Success("payload");

        var isFailure = result.TryGetFailure(out var failure);

        Assert.False(isFailure);
        Assert.Equal(default(TestFailure), failure);
    }

    [Fact]
    public void Failure_TryGetValue_ReturnsFalseAndNullValue()
    {
        var result = Result<string, TestFailure>.Failure(TestFailure.SomethingWentWrong);

        var got = result.TryGetValue(out var value, out var failure);

        Assert.False(got);
        Assert.Null(value);
        Assert.Equal(TestFailure.SomethingWentWrong, failure);
    }

    [Fact]
    public void Failure_TryGetFailure_ReturnsTrueAndTheReason()
    {
        var result = Result<string, TestFailure>.Failure(TestFailure.SomethingWentWrong);

        var isFailure = result.TryGetFailure(out var failure);

        Assert.True(isFailure);
        Assert.Equal(TestFailure.SomethingWentWrong, failure);
    }

    public enum TestFailure
    {
        None,
        SomethingWentWrong,
    }
}
