using System.Security.Claims;
using System.Text;
using System.Text.Json.Serialization;
using Hangfire;
using Hangfire.MemoryStorage;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.IdentityModel.Tokens;
using VerificationApi.Config;
using VerificationApi.Infra;
using VerificationApi.Jobs;

var builder = WebApplication.CreateBuilder(args);

// ---------- Options (appsettings.json + env) ----------
builder.Services.Configure<SecurityOptions>(builder.Configuration.GetSection("Security"));
builder.Services.Configure<RetentionOptions>(builder.Configuration.GetSection("Retention"));
var sec = builder.Configuration.GetSection("Security").Get<SecurityOptions>() ?? new SecurityOptions();

var jwtIssuer    = sec.JwtIssuer;
var jwtAudience  = sec.JwtAudience;
var jwtKey       = sec.JwtKey;
var uploadSecret = sec.UploadSecret;

// ---------- CORS ----------
builder.Services.AddCors(opt =>
{
    opt.AddDefaultPolicy(p => p
        .AllowAnyHeader()
        .AllowAnyMethod()
        .WithOrigins("http://localhost:4200", "http://127.0.0.1:4200"));
});

// ---------- Multipart limits ----------
builder.Services.Configure<FormOptions>(o =>
{
    o.MultipartBodyLengthLimit = 50 * 1024 * 1024; // 50MB demo
});

// ---------- System.Text.Json ----------
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

// ---------- Audit + Jobs ----------
builder.Services.AddSingleton<IAuditLog, InMemoryAuditLog>();
builder.Services.AddSingleton<VerificationJobs>();

// ---------- Hangfire (in-memory) ----------
builder.Services.AddHangfire(x =>
{
    x.UseSimpleAssemblyNameTypeSerializer()
     .UseRecommendedSerializerSettings()
     .UseMemoryStorage();
});
builder.Services.AddHangfireServer();

// ---------- AuthN / AuthZ ----------
var keyBytes = Encoding.UTF8.GetBytes(jwtKey);
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(keyBytes),
            ClockSkew = TimeSpan.FromSeconds(5)
        };
    });

builder.Services.AddAuthorization(); // ← OVO JE NEDOSTAJALO

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// Hangfire dashboard (dev/demo; otvoren)
app.UseHangfireDashboard("/jobs");

// Recurring GDPR cleanup (svaki minut, demo)
RecurringJob.AddOrUpdate<VerificationJobs>("retention-cleanup", j => j.CleanupAsync(), Cron.Minutely);

// Health
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

// Demo token (NE za produkciju): GET /api/token?user=Miljan
app.MapGet("/api/token", (string user) =>
{
    var handler = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler();
    var descriptor = new SecurityTokenDescriptor
    {
        Subject = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Name, user),
            new Claim("scope", "verify upload")
        }),
        Expires = DateTime.UtcNow.AddHours(4),
        Issuer = jwtIssuer,
        Audience = jwtAudience,
        SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(keyBytes), SecurityAlgorithms.HmacSha256Signature)
    };
    var token = handler.CreateToken(descriptor);
    var jwt = handler.WriteToken(token);
    return Results.Ok(new { access_token = jwt, token_type = "Bearer", expires_in = 4 * 3600 });
});

// Verify (mock) – ZAŠTIĆENO
app.MapPost("/api/verify", async (HttpRequest request, IAuditLog audit, ILoggerFactory loggerFactory) =>
{
    var logger = loggerFactory.CreateLogger("Verify");
    if (!request.HasFormContentType)
        return Results.BadRequest(new { error = "Expected multipart/form-data" });

    var form = await request.ReadFormAsync();
    var file = form.Files["image"];
    if (file is null || file.Length == 0)
        return Results.BadRequest(new { error = "Missing image file (field name 'image')" });

    await Task.Delay(350); // simulate inference

    var sizeKb = (int)(file.Length / 1024);
    var conf = Math.Clamp(0.78 + (sizeKb % 11) * 0.01, 0.78, 0.95);

    var result = new
    {
        documentType = "ID",
        country = "RS",
        fields = new
        {
            firstName = "Miljan",
            lastName = "Janković",
            dateOfBirth = "1990-06-12",
            expires = "2030-06-12",
            documentNumber = $"RS-{(100000 + (sizeKb % 900000))}"
        },
        liveness = new
        {
            glareDetected = (sizeKb % 3 == 0),
            isScreenshotSuspected = (sizeKb % 7 == 0),
            frameQuality = (sizeKb % 5 == 0) ? "medium" : "good"
        },
        confidence = conf,
        processedAt = DateTime.UtcNow
    };

    // enqueue background reverification
    var id = result.fields.documentNumber;
    BackgroundJob.Enqueue<VerificationJobs>(j => j.ReverifyAsync(id));

    // audit
    audit.Write(new AuditEvent(Guid.NewGuid().ToString("N"),
        DateTimeOffset.UtcNow,
        request.HttpContext.User?.Identity?.Name ?? "unknown",
        "Verify",
        $"doc={id}",
        0));

    return Results.Ok(result);
})
.RequireAuthorization()
.DisableAntiforgery();

// Signed URL – ZAŠTIĆENO
app.MapGet("/api/upload-url", (HttpRequest request) =>
{
    var key = Guid.NewGuid().ToString("N");
    var expiresAt = DateTimeOffset.UtcNow.AddMinutes(5).ToUnixTimeSeconds();
    var payload = $"{key}:{expiresAt}";
    var sig = Sign(payload, uploadSecret);
    var url = $"{request.Scheme}://{request.Host}/api/upload?key={key}&exp={expiresAt}&sig={sig}";
    return Results.Ok(new { url, method = "PUT", expiresAt });
})
.RequireAuthorization();

// Upload – verifikacija potpisanih query parametara
app.MapPut("/api/upload", async (HttpRequest request, ILoggerFactory loggerFactory) =>
{
    var logger = loggerFactory.CreateLogger("Upload");
    var key = request.Query["key"].ToString();
    var expStr = request.Query["exp"].ToString();
    var sig = request.Query["sig"].ToString();

    if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(expStr) || string.IsNullOrEmpty(sig))
        return Results.BadRequest(new { error = "Missing signed parameters" });

    if (!long.TryParse(expStr, out var expUnix))
        return Results.BadRequest(new { error = "Invalid exp" });

    if (DateTimeOffset.FromUnixTimeSeconds(expUnix) < DateTimeOffset.UtcNow)
        return Results.StatusCode(410); // Gone / expired

    var payload = $"{key}:{expUnix}";
    var expected = Sign(payload, uploadSecret);
    if (!CryptographicEquals(expected, sig))
        return Results.Unauthorized();

    using var ms = new MemoryStream();
    await request.Body.CopyToAsync(ms);
    logger.LogInformation("Received upload key={key}, bytes={len}", key, ms.Length);

    return Results.Ok(new { ok = true, stored = false, bytes = ms.Length });
});

// Audit – ZAŠTIĆENO
app.MapGet("/api/audit", (IAuditLog audit, int take) =>
    Results.Ok(new { count = audit.Count, items = audit.Read(Math.Clamp(take, 1, 500)) })
).RequireAuthorization();

app.Run();

// ---------- helpers ----------
static string Sign(string payload, string secret)
{
    var key = Encoding.UTF8.GetBytes(secret);
    var data = Encoding.UTF8.GetBytes(payload);
    using var h = new System.Security.Cryptography.HMACSHA256(key);
    var hash = h.ComputeHash(data);
    return Convert.ToHexString(hash).ToLowerInvariant();
}

static bool CryptographicEquals(string a, string b)
{
    if (a.Length != b.Length) return false;
    var diff = 0;
    for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
    return diff == 0;
}
