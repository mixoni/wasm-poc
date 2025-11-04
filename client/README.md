# Microblink PoC — Angular Frontend

Minimal Angular standalone app (v17) with responsive UI, mobile/tablet friendly.
- Choose file or capture camera frame
- Sends to `.NET` backend `/api/verify`
- Renders mock verification result

## Run

```bash
cd client
npm ci
npm start
```
Then open http://localhost:4200

> Adjust API base URL inside `src/app/app.component.ts` if your backend listens on a different port.


---

## Using BlinkID In‑Browser SDK (feature flag)

This PoC can run in two modes:
- **Mock backend** (default) — sends image to `.NET` `/api/verify` and returns simulated data.
- **BlinkID SDK (in-browser)** — processes the image directly in the browser via WebAssembly.

### Setup

1. Install dependencies (already referenced in `package.json`):
   ```bash
   npm ci
   ```

2. Acquire a **BlinkID license key** from Microblink and set it in:
   - `src/app/app.component.ts` → `licenseKey = signal<string>('YOUR_KEY_HERE')`

3. (Optional) If you need to self-host the engine files, set:
   ```ts
   // blinkid-sdk.service.ts
   // loadSettings.engineLocation = '/assets/blinkid';
   ```
   Then place engine files under `src/assets/blinkid`.

4. Start the app:
   ```bash
   npm start
   ```

5. Toggle **“Use BlinkID SDK (in-browser)”** switch at the top.  
   - When ON: image is processed locally (no backend call).  
   - When OFF: image is sent to the mock backend.

> On production, camera access via `getUserMedia` requires HTTPS. On `localhost`, it is allowed.
