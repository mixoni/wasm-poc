namespace VerificationApi.Config;

public class RetentionOptions
{
    public int Minutes { get; set; } = 30;
}

public class SecurityOptions
{
    public string JwtIssuer { get; set; } = "DemoIssuer";
    public string JwtAudience { get; set; } = "DemoAudience";
    public string JwtKey { get; set; } = "DemoJwtKey_ChangeMe1234567890";
    public string UploadSecret { get; set; } = "UploadSecret_ChangeMe";
}
