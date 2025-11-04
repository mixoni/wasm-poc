# Architecture Diagram

```mermaid
flowchart LR
  A[Camera/File in Browser] --> B[WebAssembly OCR/Preprocess (SDK)]
  B --> C{Feature Flag}
  C -- SDK ON --> D[Extracted JSON in Browser]
  C -- SDK OFF --> E[Send image via multipart to API]
  E --> F[.NET Verify Endpoint]
  D --> G[Backend Verification Rules]
  F --> G
  G --> H[Audit/Events/Queue]
  G --> I[GDPR Retention & Cleanup]
  D --> J[Optional: Get Signed URL]
  J --> K[PUT upload to /api/upload (signed)]
```
