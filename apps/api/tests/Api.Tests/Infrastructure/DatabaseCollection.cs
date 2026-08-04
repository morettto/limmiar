namespace Api.Tests.Infrastructure;

[CollectionDefinition("Database")]
public sealed class DatabaseCollection : ICollectionFixture<PostgresContainerFixture>
{
}
