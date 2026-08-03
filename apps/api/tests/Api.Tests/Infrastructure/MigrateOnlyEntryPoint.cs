using System.Reflection;

namespace Api.Tests.Infrastructure;

/// <summary>
/// Invokes the compiled Api.dll entry point directly with "--migrate-only", same as
/// `dotnet Api.dll --migrate-only` would. WebApplicationFactory&lt;Program&gt; always invokes
/// the entry point with an empty args array (it has no supported way to inject custom
/// process args), so this is the only way to genuinely exercise the --migrate-only branch
/// of Program.cs's top-level statements.
/// </summary>
public static class MigrateOnlyEntryPoint
{
    public static async Task InvokeAsync()
    {
        var entryPoint = typeof(Program).Assembly.EntryPoint
            ?? throw new InvalidOperationException("Api assembly has no entry point.");

        var args = new[] { "--migrate-only" };
        var invokeArgs = entryPoint.GetParameters().Length == 0
            ? []
            : new object?[] { args };

        try
        {
            var result = entryPoint.Invoke(null, invokeArgs);
            if (result is Task task)
            {
                await task;
            }
        }
        catch (TargetInvocationException ex) when (ex.InnerException is not null)
        {
            // MethodInfo.Invoke wraps exceptions thrown by the invoked method. Program's
            // generated <Main>$ wrapper blocks synchronously on the async body, so a throw
            // from inside surfaces here rather than through a faulted Task -- unwrap it so
            // callers see the real exception.
            throw ex.InnerException;
        }
    }
}
