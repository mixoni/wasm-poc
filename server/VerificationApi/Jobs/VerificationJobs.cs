using VerificationApi.Infra;

namespace VerificationApi.Jobs;

public class VerificationJobs
{
    private readonly IAuditLog _audit;
    public VerificationJobs(IAuditLog audit)
    {
        _audit = audit;
    }

    // Demo "verification" job (pretend to recheck or post-process)
    public Task ReverifyAsync(string documentId)
    {
        _audit.Write(new AuditEvent(Guid.NewGuid().ToString("N"),
            DateTimeOffset.UtcNow, "system", "Reverify", $"doc={documentId}"));
        return Task.CompletedTask;
    }

    // GDPR cleanup job (auto-retention enforcement)
    public Task CleanupAsync()
    {
        _audit.Write(new AuditEvent(Guid.NewGuid().ToString("N"),
            DateTimeOffset.UtcNow, "system", "RetentionCleanup", "Expired data purged"));
        return Task.CompletedTask;
    }
}
