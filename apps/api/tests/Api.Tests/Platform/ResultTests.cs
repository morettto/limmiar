using Api.Platform;

namespace Api.Tests.Platform;

public sealed class ResultTests
{
    [Fact]
    public void Success_TryGetValue_ReturnsTrueAndTheValue()
    {
        var result = Result<string, TestFailure>.Success("payload");

        var got = result.TryGetValue(out var value);

        Assert.True(got);
        Assert.Equal("payload", value);
    }

    [Fact]
    public void Failure_TryGetValue_ReturnsFalseAndNullValue()
    {
        var result = Result<string, TestFailure>.Failure(TestFailure.SomethingWentWrong);

        var got = result.TryGetValue(out var value);

        Assert.False(got);
        Assert.Null(value);
    }

    [Fact]
    public void Success_Match_InvokesOnSuccessWithTheValue()
    {
        var result = Result<string, TestFailure>.Success("payload");

        var matched = result.Match(value => value, failure => $"failure:{failure}");

        Assert.Equal("payload", matched);
    }

    [Fact]
    public void Failure_Match_InvokesOnFailureWithTheReason()
    {
        var result = Result<string, TestFailure>.Failure(TestFailure.SomethingWentWrong);

        var matched = result.Match(value => $"value:{value}", failure => failure.ToString());

        Assert.Equal(nameof(TestFailure.SomethingWentWrong), matched);
    }

    // Critério de aceite 1: TestFailure tem a forma real de produção (0 é membro
    // significativo). Se Match alguma vez chamasse onFailure num sucesso, este onFailure
    // provaria a lê-lo -- e não chama.
    [Fact]
    public void Success_Match_NeverInvokesOnFailure_EvenWithAMeaningfulZeroReason()
    {
        var result = Result<string, TestFailure>.Success("payload");

        var matched = result.Match(
            onSuccess: value => value,
            onFailure: _ => throw new InvalidOperationException("onFailure must not run for a successful result"));

        Assert.Equal("payload", matched);
    }

    [Fact]
    public void ImplicitConversion_FromValue_ProducesSuccess()
    {
        Result<string, TestFailure> result = "payload";

        Assert.Equal("payload", result.Match(value => value, failure => failure.ToString()));
    }

    [Fact]
    public void ImplicitConversion_FromFailure_ProducesFailure()
    {
        Result<string, TestFailure> result = TestFailure.SomethingWentWrong;

        Assert.Equal(nameof(TestFailure.SomethingWentWrong), result.Match(value => value, failure => failure.ToString()));
    }

    // default(Result<,>) agora é construível (struct) e lê-se como falha com a razão 0 --
    // trava o invariante documentado no sumário do tipo.
    [Fact]
    public void Default_Match_ReadsAsFailureWithReasonZero()
    {
        var result = default(Result<string, TestFailure>);

        var matched = result.Match(
            onSuccess: _ => throw new InvalidOperationException("expected default to read as failure"),
            onFailure: failure => failure);

        Assert.Equal(TestFailure.AccountNotFound, matched);
    }

    public enum TestFailure
    {
        AccountNotFound,
        SomethingWentWrong,
    }
}
