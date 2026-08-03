# Build stage: Native AOT compilation requires the SDK image with the Linux native
# toolchain (clang, libraries for static linking) preinstalled.
FROM mcr.microsoft.com/dotnet/sdk:10.0-noble-aot AS build
WORKDIR /src

COPY apps/api/Api.sln apps/api/Directory.Build.props ./
COPY apps/api/src/Api/Api.csproj src/Api/
RUN dotnet restore src/Api/Api.csproj

COPY apps/api/src/Api/ src/Api/
COPY apps/api/migrations/ migrations/

RUN dotnet publish src/Api/Api.csproj \
    -c Release \
    -r linux-x64 \
    --self-contained \
    -p:PublishAot=true \
    -o /app/publish

# Runtime stage: runtime-deps has no .NET runtime at all -- the AOT binary is fully
# self-contained and needs only OS-level shared libraries (libc, OpenSSL, ICU is not
# needed since InvariantGlobalization is enabled). Same "noble" Ubuntu family as the
# build stage keeps glibc/OpenSSL ABI compatible between the two stages.
FROM mcr.microsoft.com/dotnet/runtime-deps:10.0-noble-chiseled AS runtime
WORKDIR /app

COPY --from=build /app/publish .

EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080

ENTRYPOINT ["/app/Api"]
