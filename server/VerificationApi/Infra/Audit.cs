using System.Collections.Concurrent;

namespace VerificationApi.Infra;

public record AuditEvent(string Id, DateTimeOffset Timestamp, string Actor, string Action, string? Details, double? DurationMs = null);

public interface IAuditLog
{
    void Write(AuditEvent evt);
    IReadOnlyList<AuditEvent> Read(int take = 100);
    int Count { get; }
}

public class InMemoryAuditLog : IAuditLog
{
    private readonly ConcurrentQueue<AuditEvent> _events = new();
    private const int MaxItems = 5000;

    public int Count => _events.Count;

    public void Write(AuditEvent evt)
    {
        _events.Enqueue(evt);
        while (_events.Count > MaxItems && _events.TryDequeue(out _)) { }
    }

    public IReadOnlyList<AuditEvent> Read(int take = 100)
    {
        return _events.Reverse().Take(take).ToList();
    }
}
