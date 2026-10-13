using Microsoft.Extensions.Caching.Memory;

namespace Api.OnlineSessions;

public sealed class OnlineSessionStore(Func<DateTimeOffset>? clock = null) : IDisposable
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(2);
    private readonly MemoryCache _rooms = new(new MemoryCacheOptions { SizeLimit = 256 });
    private readonly Func<DateTimeOffset> _clock = clock ?? (() => DateTimeOffset.UtcNow);

    public OnlineSessionRoom? Create(Guid professionalId, Guid patientId)
    {
        var room = new OnlineSessionRoom(professionalId, patientId, _clock() + Lifetime);
        _rooms.Set(room.Id, room, new MemoryCacheEntryOptions().SetSize(1).SetAbsoluteExpiration(Lifetime)
            .RegisterPostEvictionCallback((_, value, _, _) => ((OnlineSessionRoom)value!).Dispose()));
        if (_rooms.TryGetValue(room.Id, out _)) return room;
        room.Dispose();
        return null;
    }

    public OnlineSessionRoom? Find(Guid id)
    {
        if (!_rooms.TryGetValue<OnlineSessionRoom>(id, out var room)) return null;
        if (room!.ExpiresAt <= _clock() || room.IsClosed) { room.Close(); _rooms.Remove(id); return null; }
        return room;
    }

    public void Close(OnlineSessionRoom room) { room.Close(); _rooms.Remove(room.Id); }
    public void Dispose()
    {
        foreach (var key in _rooms.Keys)
            if (_rooms.TryGetValue<OnlineSessionRoom>(key, out var room)) room!.Dispose();
        _rooms.Dispose();
    }
}
