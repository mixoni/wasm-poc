# Microblink-Style ID Verification — PoC (Angular + .NET 8)

This is a **self-contained demo** that simulates an ID verification flow inspired by WebAssembly/edge-first design:
- Angular frontend (mobile & tablet responsive, camera capture)
- .NET 8 minimal API backend
- Mocked OCR/inference (no external SDKs) to focus on **system design**

## Prereqs
- Node 18+ & npm
- .NET SDK 8+
- (Optional) Angular CLI globally installed: `npm i -g @angular/cli`

## Run locally

### 1) Backend
```bash
cd server/VerificationApi
dotnet restore
dotnet run
```
> Note the port printed in the console (e.g. `http://localhost:5079`).

### 2) Frontend
```bash
cd client
npm ci
npm start
```
Open http://localhost:4200.  
If backend port differs, open `src/app/app.component.ts` and edit `apiBase`.

## What this demonstrates
- **Edge-first capture** (browser camera or file)
- **Low-latency pipeline** (simulated WASM pre-processing in client)
- **Secure backend hand-off** (JSON only; images not persisted)
- **Responsive UI** for phones & tablets (use DevTools device mode)

## Next steps (if you want to go further)
- Swap the mock endpoint with a real ID/OCR SDK (e.g., Microblink Web SDK).
- Add JWT + signed URL upload to a private object store.
- Implement GDPR retention policy (auto-delete jobs) and audit trails.
- Add retries via a background queue (e.g., Hangfire, Azure Queue).

Enjoy!


---

## 🔐 JWT Auth (demo)

Get a demo token (dev only):
```bash
curl "http://localhost:5079/api/token?user=Miljan"
```
Copy `access_token` to `localStorage` (the app does this via **Auth** panel).  
Protected endpoints: `/api/verify`, `/api/upload-url`.

## 📤 Signed URL Upload (simulated)

1. Call `GET /api/upload-url` (requires token) → returns a one-time `PUT` URL valid 5 minutes.
2. `PUT` the original image bytes to that URL.
3. In this PoC we **do not persist** the bytes — only simulate storage.

## 🐳 Docker Compose

From repo root:
```bash
docker compose up --build
```
- API: http://localhost:5079
- Web: http://localhost:4200

> On first run, Node image builds the Angular dev server. API is exposed on 5079.

## 📐 Diagram

See `docs/architecture.md` for a **Mermaid** diagram of the flow (SDK flag, API, signed URL, GDPR cleanup).



## 🧰 Hangfire & Retention

- Hangfire dashboard: `http://localhost:5079/jobs`
- Recurring job: `retention-cleanup` (runs every minute)
- In-memory AuditLog (`/api/audit?take=50`) — protected; fetch after getting token.

## ⚙️ Configuration

Edit `server/VerificationApi/appsettings.json` or override via env vars:
- `Security:JwtKey`, `Security:JwtIssuer`, `Security:JwtAudience`, `Security:UploadSecret`
- `Retention:Minutes`

In Docker Compose, override env variables in `api` service if needed.

## 🌐 Angular environments

- `src/environments/environment.ts` controls `apiBase` for dev/prod.
- Toasts + small skeletons are included for better UX feedback.
