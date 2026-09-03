using System.Diagnostics.CodeAnalysis;

namespace Api.Platform;

/// <summary>
/// A store/service boundary result: either a value or a typed failure reason, never both nor
/// neither.
/// </summary>
public sealed class Result<TValue, TFailure>
    where TValue : class
    where TFailure : struct, Enum
{
    private readonly TValue? value;
    private readonly TFailure failure;

    private Result(TValue? value, TFailure failure)
    {
        this.value = value;
        this.failure = failure;
    }

    public static Result<TValue, TFailure> Success(TValue value) => new(value, default);

    public static Result<TValue, TFailure> Failure(TFailure failure) => new(null, failure);

    /// <summary>True on success.</summary>
    public bool TryGetValue([NotNullWhen(true)] out TValue? value, out TFailure failure)
    {
        value = this.value;
        failure = this.failure;
        return this.value is not null;
    }

    /// <summary>True on failure.</summary>
    public bool TryGetFailure(out TFailure failure)
    {
        failure = this.failure;
        return this.value is null;
    }
}
