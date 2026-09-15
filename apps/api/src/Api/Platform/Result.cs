using System.Diagnostics.CodeAnalysis;

namespace Api.Platform;

/// <summary>
/// A store/service boundary result: either a value or a typed failure reason, never both nor
/// neither. <c>TFailure</c> may be any struct, not only an enum -- e.g. <c>long</c>, the current
/// version on a CAS conflict. <c>default(Result&lt;TValue, TFailure&gt;)</c> is constructible (it
/// is a struct) and reads as a failure with reason <c>default(TFailure)</c> -- for every enum
/// <c>TFailure</c> in this repository that is a real, named member (0); for a non-enum
/// <c>TFailure</c> such as <c>long</c> (an optimistic-concurrency version number), it is the
/// type's own default (0).
/// </summary>
public readonly record struct Result<TValue, TFailure>
    where TValue : class
    where TFailure : struct
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

    // Unambiguous because TValue : class and TFailure : struct can never be the same type.
    public static implicit operator Result<TValue, TFailure>(TValue value) => Success(value);

    public static implicit operator Result<TValue, TFailure>(TFailure failure) => Failure(failure);

    // No production caller left after S08-26 (all went through Match); kept for tests that
    // only need the value, not worth rewriting ~19 call sites to Match for this.
    /// <summary>True on success.</summary>
    public bool TryGetValue([NotNullWhen(true)] out TValue? value)
    {
        value = this.value;
        return this.value is not null;
    }

    /// <summary>Calls exactly one of the two, never both.</summary>
    public TResult Match<TResult>(Func<TValue, TResult> onSuccess, Func<TFailure, TResult> onFailure) =>
        value is not null ? onSuccess(value) : onFailure(failure);
}
