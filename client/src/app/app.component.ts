import { environment } from '../environments/environment';
import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { BlinkIdSdkService } from './blinkid-sdk.service';

type VerifyResult = {
  documentType: string;
  country: string;
  fields: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    expires: string;
    documentNumber: string;
  };
  liveness: {
    glareDetected: boolean;
    isScreenshotSuspected: boolean;
    frameQuality: string;
  };
  confidence: number;
  processedAt: string;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div class="page">
    <header class="header">
      <h1>Identity Verification PoC</h1>
      <p class="subtitle">Camera → BlinkID (WASM, multi-side) or Backend mock → Result</p>
    </header>

    <div class="flagbar">
      <label class="toggle">
        <input type="checkbox" [checked]="useSdk()" (change)="toggleMode($event)" />
        <span>Use BlinkID SDK (in-browser)</span>
      </label>
      <!-- <button class="btn small" (click)="openSettings = !openSettings">Settings</button> -->
    </div>

    <section class="card settings" *ngIf="openSettings">
      <label>License key
        <input [value]="licenseKey()" (input)="updateLicenseKey($event)" placeholder="BlinkID License key" />
      </label>
      <label>API Base
        <input [value]="apiBase()" (input)="apiBase.set($event.target.value)" placeholder="http://localhost:5000" />
      </label>
      <div class="row">
        <button class="btn" (click)="saveSettings()">Save</button>
        <small *ngIf="settingsSaved">Saved ✔</small>
      </div>
    </section>

    <main class="content">
      <section class="card">
        <h2>Auth</h2>
        <div class="uploader">
          <input placeholder="User name" [value]="username()" (input)="username.set($event.target.value)" />
          <button class="btn" (click)="getToken()">Get demo token</button>
          <small *ngIf="token()">Token stored in localStorage</small>
        </div>
      </section>

      <section class="card">
        <h2>1) Capture / Upload</h2>

        <div class="stepper">
          <div class="step" [class.active]="step() === 'front'">Front</div>
          <div class="sep"></div>
          <div class="step" [class.active]="step() === 'back'">Back</div>
          <div class="sep"></div>
          <div class="step" [class.active]="step() === 'done'">Result</div>
        </div>

        <div class="uploader">
          <input type="file" accept="image/*" (change)="onFrontFileChange($event)" />
          <input type="file" accept="image/*" (change)="onBackFileChange($event)" />
          <button class="btn" (click)="startCamera()" *ngIf="!cameraActive">Use Camera</button>
          <button class="btn" (click)="stopCamera()" *ngIf="cameraActive">Stop Camera</button>
        </div>

        <div class="camera" *ngIf="cameraActive">
          <div class="camera-wrap">
            <video #video autoplay playsinline muted></video>

            <!-- Overlay vodič -->
            <div class="overlay">
              <div class="mask"></div>
              <div class="guide" [class.good]="guideGood" [class.capturing]="autoCapturing">
                <div class="corners"><span></span><span></span><span></span><span></span></div>
                <div class="hint">
                  <span *ngIf="!guideGood && !autoCapturing">{{ step()==='front' ? 'Align FRONT side inside the frame' : 'Align BACK side inside the frame' }}</span>
                  <span *ngIf="guideGood && !autoCapturing">Hold steady…</span>
                  <span *ngIf="autoCapturing">Capturing…</span>
                </div>
              </div>
            </div>
          </div>

          <div class="camera-actions">
            <button class="btn" (click)="captureFrame(video)">Capture Frame ({{ step() | uppercase }})</button>
            <label class="toggle">
              <input type="checkbox" [checked]="autoMode" (change)="toggleAuto(video, $event)">
              <span>Auto-capture</span>
            </label>
          </div>

          <canvas #canvas class="hidden"></canvas>
        </div>

        <div class="preview-wrap">
          <div class="preview" *ngIf="frontPreview()">
            <h4>Front</h4>
            <img [src]="frontPreview()!" alt="front"/>
          </div>
          <div class="preview" *ngIf="backPreview()">
            <h4>Back</h4>
            <img [src]="backPreview()!" alt="back"/>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>2) Verify</h2>
        <button class="btn" [disabled]="verDisabled()" (click)="verify()">Run Verification</button>
        <div *ngIf="uploading()">Working... {{progress()}}%</div>
      </section>

      <section class="card">
        <h2>2b) Upload via Signed URL</h2>
        <button class="btn" [disabled]="!frontFile()" (click)="signedUpload()">Upload Front Image</button>
        <div *ngIf="uploadInfo()">{{ uploadInfo() | json }}</div>
      </section>

      <section class="card" *ngIf="result()">
        <h2>Result</h2>
        <pre class="json">{{ result() | json }}</pre>
        <div class="grid">
          <div class="kv"><span>Type</span><strong>{{ result()!.documentType }}</strong></div>
          <div class="kv"><span>Country</span><strong>{{ result()!.country }}</strong></div>
          <div class="kv"><span>First name</span><strong>{{ result()!.fields.firstName }}</strong></div>
          <div class="kv"><span>Last name</span><strong>{{ result()!.fields.lastName }}</strong></div>
          <div class="kv"><span>DoB</span><strong>{{ result()!.fields.dateOfBirth }}</strong></div>
          <div class="kv"><span>Expires</span><strong>{{ result()!.fields.expires }}</strong></div>
          <div class="kv"><span>Doc #</span><strong>{{ result()!.fields.documentNumber }}</strong></div>
          <div class="kv"><span>Confidence</span><strong>{{ (result()!.confidence*100).toFixed(1) }}%</strong></div>
          <div class="kv"><span>Quality</span><strong>{{ result()!.liveness.frameQuality }}</strong></div>
        </div>
      </section>
    </main>

    <footer class="footer">
      <small>Responsive design — mobile & tablets ready.</small>
    </footer>
  </div>
  `,
  styles: [`
  :root { --bg:#0b0c10; --card:#16181d; --text:#e8e8ea; --muted:#a9acb2; --accent:#7ab4ff; }
  * { box-sizing: border-box; }
  body, html, .page { margin:0; padding:0; background:var(--bg); color:var(--text); font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }

  .header { padding: 20px; text-align: center; }
  .header h1 { margin: 0 0 6px; font-size: clamp(22px, 2.6vw, 34px); }
  .subtitle { color: var(--muted); margin: 0; }

  .flagbar { position: sticky; top: 0; z-index: 5; background: rgba(20,22,28,0.85); backdrop-filter: blur(6px); padding: 8px 16px; display:flex; gap:12px; justify-content:center; align-items:center; }
  .toggle { display:flex; gap:10px; align-items:center; font-size:14px; }
  .toggle input { width: 18px; height: 18px; }
  .btn { background: #2a2f3a; border: none; border-radius: 12px; padding: 10px 14px; color: var(--text); cursor: pointer; }
  .btn.small { padding: 6px 10px; font-size: 12px; }
  .btn.primary { background: var(--accent); color: #0a0a0a; font-weight: 600; }
  .content { display: grid; gap: 16px; padding: 16px; grid-template-columns: 1fr; max-width: 1100px; margin: 0 auto; }
  @media (min-width: 900px) { .content { grid-template-columns: 1fr 1fr; } }
  .card { background: var(--card); border-radius: 16px; padding: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }

  .settings label { display:flex; flex-direction:column; gap:6px; margin-bottom: 10px; }
  .settings input { background:#0d0f14; color:var(--text); border:1px solid #2a2f3a; border-radius:10px; padding:8px 10px; }

  .uploader { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .preview-wrap { display:flex; gap:12px; margin-top: 10px; }
  .preview img { max-width: 100%; height: auto; border-radius: 12px; border: 1px solid #2a2f3a; width: 100%; }

  .stepper { display:flex; align-items:center; gap:10px; margin: 10px 0 16px; }
  .step { padding:6px 10px; border-radius: 999px; background:#232733; color:#cdd0d6; font-size:12px; }
  .step.active { background: var(--accent); color:#0a0a0a; font-weight: 600; }
  .sep { width: 20px; height: 2px; background:#2a2f3a; border-radius:2px; }

  .camera-wrap { position: relative; }
  .camera-wrap video { width: 100%; max-height: 420px; border-radius: 12px; display: block; }

  .overlay { position: absolute; inset: 0; pointer-events: none; }
  .overlay .mask {
    position: absolute; inset: 0;
    background: radial-gradient(transparent 60%, rgba(0,0,0,0.45));
    border-radius: 12px;
  }
  .overlay .guide {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(85%, 520px); aspect-ratio: 1.586;
    border: 2px dashed rgba(255,255,255,0.45); border-radius: 12px;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.35);
  }
  .overlay .guide.good { border-color: #84fba0; }
  .overlay .guide.capturing { border-style: solid; }
  .overlay .corners span {
    position: absolute; width: 28px; height: 28px; border: 3px solid rgba(255,255,255,0.75);
  }
  .overlay .corners span:nth-child(1){ left:-3px; top:-3px; border-right:0; border-bottom:0; border-radius:12px 0 0 0; }
  .overlay .corners span:nth-child(2){ right:-3px; top:-3px; border-left:0; border-bottom:0; border-radius:0 12px 0 0; }
  .overlay .corners span:nth-child(3){ left:-3px; bottom:-3px; border-right:0; border-top:0; border-radius:0 0 0 12px; }
  .overlay .corners span:nth-child(4){ right:-3px; bottom:-3px; border-left:0; border-top:0; border-radius:0 0 12px 0; }
  .overlay .hint {
    position: absolute; left: 50%; bottom: -34px; transform: translateX(-50%);
    font-size: 12px; color: #a9acb2; background: rgba(0,0,0,0.4);
    padding: 4px 8px; border-radius: 8px;
  }

  .camera-actions { display:flex; gap:8px; align-items:center; margin-top: 8px; }

  .json { background: #0d0f14; padding: 12px; border-radius: 12px; overflow: auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; margin-top: 12px; }
  .kv { background: #0d0f14; padding: 10px; border-radius: 8px; }
  .kv span { color: var(--muted); display: block; font-size: 12px; }

  .footer { text-align: center; padding: 16px; color: var(--muted); }
  .hidden { display:none; }
  /* Zeleno kad je “good” */
  .overlay .guide.good {
    border-color: #22c55e; /* zeleno */
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.35), 0 0 12px 2px rgba(34,197,94,0.6);
  }
  .overlay .guide.good .corners span { border-color: rgba(34,197,94,0.9); }

  /* U trenutku auto-snimka malo jači “pulse” */
  @keyframes guidePulse {
    0%   { box-shadow: 0 0 0 9999px rgba(0,0,0,0.35), 0 0 10px 2px rgba(34,197,94,0.6); }
    50%  { box-shadow: 0 0 0 9999px rgba(0,0,0,0.35), 0 0 20px 6px rgba(34,197,94,0.8); }
    100% { box-shadow: 0 0 0 9999px rgba(0,0,0,0.35), 0 0 10px 2px rgba(34,197,94,0.6); }
  }
  .overlay .guide.capturing {
    border-style: solid;
    animation: guidePulse 0.6s ease-in-out 2;
  }

  `]
})
export class AppComponent implements OnDestroy {
  // settings
  updateLicenseKey(event: Event) {
    this.licenseKey.set((event.target as HTMLInputElement).value);
  }
  apiBase = signal<string>((environment as any).apiBase || 'http://localhost:5000');
  licenseKey = signal<string>((environment as any).licenseKey ?? ''); 
  openSettings = false; settingsSaved = false;

  // auth
  username = signal<string>('demo_user');
  token = signal<string | null>(localStorage.getItem('demo_token'));

  // sdk/mode
  useSdk = signal<boolean>(false);

  // capture state
  step = signal<'front' | 'back' | 'done'>('front');
  frontFile = signal<File | null>(null);
  backFile  = signal<File | null>(null);
  frontPreview = signal<string | null>(null);
  backPreview  = signal<string | null>(null);

  // verify
  result = signal<VerifyResult | null>(null);
  uploadInfo = signal<any | null>(null);
  uploading = signal<boolean>(false);
  progress = signal<number>(0);

  // camera
  cameraActive = false;
  private mediaStream: MediaStream | null = null;
  guideGood = false; autoMode = true; autoCapturing = false; private rafId: number | null = null;

  private stableFrames = 0;
  private readonly STABLE_THRESHOLD = 10; // ~10 uzastopnih “dobrih” frame-ova

  constructor(private http: HttpClient, private blink: BlinkIdSdkService) {}

  // Settings
  saveSettings() {
    localStorage.setItem('blinkid_key', this.licenseKey());
    localStorage.setItem('api_base', this.apiBase());
    this.settingsSaved = true;
    setTimeout(()=> this.settingsSaved = false, 1500);
  }

  // Auth
  getToken() {
    const u = this.username();
    this.http.get<{access_token:string}>(`${this.apiBase()}/api/token`, { params: { user: u } })
      .subscribe(t => { localStorage.setItem('demo_token', t.access_token); this.token.set(t.access_token); });
  }

  // Mode
  async toggleMode(ev: Event) {
    const on = (ev.target as HTMLInputElement).checked;
    if (on) {
      try {
        await this.blink.init(this.licenseKey());
        this.useSdk.set(true);
      } catch (e:any) {
        console.error(e); this.useSdk.set(false);
        alert(e?.message ?? 'BlinkID init failed (license/engine?)');
      }
    } else {
      this.useSdk.set(false);
      await this.blink.dispose();
    }
  }

  // Files
  onFrontFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (input.files && input.files.length) {
      const f = input.files[0]; this.frontFile.set(f);
      this.frontPreview.set(URL.createObjectURL(f));
      this.step.set('back');
    }
  }
  onBackFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (input.files && input.files.length) {
      const f = input.files[0]; this.backFile.set(f);
      this.backPreview.set(URL.createObjectURL(f));
      this.step.set('done');
    }
  }

  // Camera
  async startCamera() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      this.cameraActive = true;
      setTimeout(() => {
        const video = document.querySelector('video') as HTMLVideoElement;
        if (video && this.mediaStream) {
          video.srcObject = this.mediaStream;
          if (this.autoMode) this.startAutoCaptureLoop(video);
        }
      }, 0);
    } catch { alert('Camera permission denied'); }
  }
  stopCamera() {
    this.stopAutoCaptureLoop();
    this.mediaStream?.getTracks().forEach(t => t.stop());
    this.mediaStream = null;
    this.cameraActive = false;
  }

  captureFrame(videoEl: HTMLVideoElement) {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const w = videoEl.videoWidth, h = videoEl.videoHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.drawImage(videoEl, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const f = new File([blob], (this.step()==='front'?'front':'back') + '.jpg', { type: 'image/jpeg' });
      const url = URL.createObjectURL(f);
      if (this.step()==='front') {
        this.frontFile.set(f); this.frontPreview.set(url); this.step.set('back');
      } else {
        this.backFile.set(f); this.backPreview.set(url); this.step.set('done');
      }
    }, 'image/jpeg', 0.95);
  }

  toggleAuto(video: HTMLVideoElement, ev: Event) {
    this.autoMode = (ev.target as HTMLInputElement).checked;
    if (this.autoMode) this.startAutoCaptureLoop(video);
    else this.stopAutoCaptureLoop();
  }
  private stopAutoCaptureLoop() {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null; this.guideGood = false; this.autoCapturing = false;
  }
  private startAutoCaptureLoop(video: HTMLVideoElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      if (!video.videoWidth || !video.videoHeight) return;
    
      const W = 480, H = Math.round((video.videoHeight / video.videoWidth) * W);
      canvas.width = W; canvas.height = H;
      ctx.drawImage(video, 0, 0, W, H);
      const img = ctx.getImageData(0, 0, W, H).data;
    
      // 1) “Oštrina” (varijansa luminanse)
      let sum=0, sumSq=0;
      for (let i=0;i<img.length;i+=4) {
        const y = 0.2126*img[i] + 0.7152*img[i+1] + 0.0722*img[i+2];
        sum += y; sumSq += y*y;
      }
      const n = img.length/4;
      const mean = sum/n;
      const variance = (sumSq/n) - (mean*mean);
    
      // 2) “Popunjenost” vodiča
      const guideWidthFrac = Math.min(video.clientWidth * 0.85, 520) / video.clientWidth;
      const fillOk = guideWidthFrac >= 0.6;
    
      // Prag za oštrinu – podešavaj po uređaju
      const sharpOk = variance > 1800;
    
      // 3) Stabilizacija: tražimo X uzastopnih dobrih frame-ova
      if (sharpOk && fillOk) {
        this.stableFrames = Math.min(this.stableFrames + 1, this.STABLE_THRESHOLD + 5);
      } else {
        this.stableFrames = Math.max(this.stableFrames - 1, 0);
      }
    
      this.guideGood = this.stableFrames >= this.STABLE_THRESHOLD;
    
      // 4) Auto-capture kad smo “good” i trenutno ne hvatamo
      if (this.guideGood && !this.autoCapturing) {
        this.autoCapturing = true; // promeni stil (pulse)
        setTimeout(() => {
          // ako je još uvek stabilno – snimi
          if (this.guideGood) this.captureFrame(video);
          this.autoCapturing = false;
          // nakon snimka resetuj stabilnost da ne snima odmah drugi
          this.stableFrames = 0;
          this.guideGood = false;
        }, 350);
      }
    };
    
    this.rafId = requestAnimationFrame(tick);
  }

  // Verify (SDK multi-side ili backend mock)
  verDisabled() {
    return this.uploading() ||
      (this.useSdk() ? !(this.frontFile() && this.backFile()) : !this.frontFile());
  }

  async verify() {
    if (this.uploading()) return;

    if (this.useSdk()) {
      try {
        this.uploading.set(true);
        // late init ako treba
        // @ts-ignore
        if ((this.blink as any).isReady && !(this.blink as any).isReady()) {
          await this.blink.init(this.licenseKey());
        }
        const ff = this.frontFile(); const bf = this.backFile();
        if (!ff) throw new Error('Missing front image'); if (!bf) throw new Error('Missing back image');
        await this.blink.scanFront(ff);
        const res = await this.blink.scanBack(bf);
        this.result.set(res as any);
      } catch (e:any) {
        console.error(e); alert(e?.message ?? 'SDK verification failed');
      } finally {
        this.uploading.set(false);
      }
      return;
    }

    // Backend mock (samo front)
    const f = this.frontFile(); if (!f) return;
    const form = new FormData(); form.append('image', f);
    this.uploading.set(true); this.progress.set(0);
    this.http.post<VerifyResult>(`${this.apiBase()}/api/verify`, form, {
      reportProgress: true, observe: 'events'
    }).subscribe({
      next: (ev:any) => {
        if (ev.type === HttpEventType.UploadProgress && ev.total) {
          this.progress.set(Math.round(100 * ev.loaded / ev.total));
        } else if (ev.type === HttpEventType.Response) {
          this.result.set(ev.body as VerifyResult);
          this.uploading.set(false); this.step.set('done');
        }
      },
      error: err => { console.error(err); alert('Verification failed'); this.uploading.set(false); }
    });
  }

  async signedUpload() {
    const f = this.frontFile(); if (!f) return;
    try {
      const { url } = await this.http.get<{url:string}>(`${this.apiBase()}/api/upload-url`).toPromise() as any;
      const res = await fetch(url, { method: 'PUT', body: f });
      const json = await res.json();
      this.uploadInfo.set({ url, response: json });
    } catch (e) { console.error(e); alert('Signed upload failed'); }
  }

  ngOnDestroy(): void { this.stopCamera(); }
}
