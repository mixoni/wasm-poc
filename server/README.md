# VerificationApi (.NET 8 Minimal API)

Simple mock endpoint to simulate document verification / OCR.

## Run

```bash
cd server/VerificationApi
dotnet restore
dotnet run
```

- Health: `GET http://localhost:5079/api/health` (port may vary; check console)
- Verify: `POST http://localhost:5079/api/verify` (multipart/form-data, field: `image`)
