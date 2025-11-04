namespace VerificationApi.Infra;

// Simple queue abstraction. We'll implement a Hangfire-based version for demo.
public interface IJobQueue
{
    string EnqueueVerificationJob(string documentId);
    string EnqueueCleanupJob();
}

// Azure Queue stub (for illustration)
public class AzureQueueJobQueue : IJobQueue
{
    public string EnqueueVerificationJob(string documentId)
    {
        // TODO: Implement using Azure.Storage.Queues
        return $"azure-{Guid.NewGuid():N}";
    }
    public string EnqueueCleanupJob()
    {
        // TODO
        return $"azure-clean-{Guid.NewGuid():N}";
    }
}
