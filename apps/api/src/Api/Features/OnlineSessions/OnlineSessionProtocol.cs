using System.Text.Json.Serialization;
using System.Text.Json;

namespace Api.OnlineSessions;

public sealed record OnlineSessionInvite(Guid RoomId, string ProfessionalToken, string PatientToken, DateTimeOffset ExpiresAt);
public sealed record OnlineSessionAuthentication(string Token);
public sealed record OnlineIceCandidate(string Candidate, string? SdpMid, int? SdpMLineIndex, string? UsernameFragment);
public sealed record OnlineClientSignal(string Type, string? Sdp = null, OnlineIceCandidate? Candidate = null);
public sealed record OnlineIceServer(string[] Urls, string? Username, string? Credential);
public sealed record OnlineServerSignal(string Type, string? Role = null, string? Sdp = null, OnlineIceCandidate? Candidate = null, OnlineIceServer[]? IceServers = null);

[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow)]
[JsonSerializable(typeof(OnlineSessionInvite))]
[JsonSerializable(typeof(OnlineSessionAuthentication))]
[JsonSerializable(typeof(OnlineClientSignal))]
[JsonSerializable(typeof(OnlineServerSignal))]
public partial class OnlineSessionsJsonContext : JsonSerializerContext;
