import { environment } from '../environments/environment';
import { Component, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { BlinkIdSdkService, AllowedDoc } from './blinkid-sdk.service';
import * as QRCode from 'qrcode';

type VerifyResultView = {
  raw: any;
  documentType: string;
  country: string;
  fields: {
    firstName: string; lastName: string; dateOfBirth: string; expires: string; documentNumber: string;
  };
  liveness: { glareDetected: boolean; isScreenshotSuspected: boolean; frameQuality: string; };
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
      <p class="subtitle">BlinkID (WASM, multi-side) + Guidance & Policy + Backend mock + QR handoff</p>
    </header>

    <div class="flagbar">
      <label class="toggle">
        <input type="checkbox" [checked]="useSdk()" (change)="toggleMode($event)" />
        <span>Use BlinkID SDK (in-browser)</span>
      </label>

      <label class="toggle">
        <span>Allowed:</span>
        <select [value]="allowed()" (change)="allowed.set(($event.target).value)">
          <option value="both">ID + PASSPORT</option>
          <option value="id">ID only</option>
          <option value="passport">PASSPORT only</option>
        </select>
      </label>

      <button class="btn small" (click)="openSettings = !openSettings">Settings</button>
      <button class="btn small" (click)="toggleQr()">QR to mobile</button>
    </div>

    <section class="card settings" *ngIf="openSettings">
      <label>License key
        <input [value]="licenseKey()" (input)="licenseKey.set(($event.target).value)" placeholder="BlinkID License key" />
      </label>
      <label>API Base
        <input [value]="apiBase()" (input)="apiBase.set(($event.target).value)" placeholder="http://localhost:5000" />
      </label>
      <div class="row">
        <button class="btn" (click)="saveSettings()">Save</button>
        <small *ngIf="settingsSaved">Saved ✔</small>
      </div>
    </section>

    <section class="card" *ngIf="qrOpen">
      <h2>Open on your phone</h2>
      <canvas #qr></canvas>
      <p class="muted">Scan to open this page on your mobile. Use the rear camera for best results.</p>
    </section>

    <main class="content">
      <section class="card">
        <h2>1) Capture</h2>

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

            <div class="overlay">
              <div class="mask"></div>
              <div class="guide" [class.good]="guideGood" [class.capturing]="autoCapturing">
                <div class="corners"><span></span><span></span><span></span><span></span></div>
                <div class="hint">
                  <ng-container [ngSwitch]="captureHint">
                    <span *ngSwitchCase="'far'">Move closer</span>
                    <span *ngSwitchCase="'close'">Move farther</span>
                    <span *ngSwitchCase="'hold'">Hold steady…</span>
                    <span *ngSwitchCase="'capturing'">Capturing…</span>
                    <span *ngSwitchDefault>
                      {{ step()==='front' ? 'Align FRONT side inside the frame' : 'Align BACK side inside the frame' }}
                    </span>
                  </ng-container>
                </div>
              </div>
            </div>
          </div>

          <div class="camera-actions">
            <button class="btn" (click)="manualCapture(video)" [disabled]="!manualCaptureEnabled()">Manual Capture ({{ step() | uppercase }})</button>
            <label class="toggle"><input type="checkbox" [checked]="autoMode" (change)="toggleAuto(video, $event)"><span>Auto-capture</span></label>
          </div>

          <canvas id="cap" class="hidden"></canvas>
        </div>

        <div class="preview-wrap">
          <div class="preview" *ngIf="frontPreview()">
            <h4>Front</h4><img [src]="frontPreview()!" alt="front"/>
          </div>
          <div class="preview" *ngIf="backPreview()">
            <h4>Back</h4><img [src]="backPreview()!" alt="back"/>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>2) Verify</h2>
        <button class="btn" [disabled]="verDisabled()" (click)="verify()">Run Verification</button>
        <div *ngIf="uploading()">Working... {{progress()}}%</div>
        <p class="warn" *ngIf="flowWarning">{{ flowWarning }}</p>
      </section>

      <section class="card">
        <h2>2b) Upload via Signed URL</h2>
        <button class="btn" [disabled]="!frontFile()" (click)="signedUpload()">Upload Front Image</button>
        <div *ngIf="uploadInfo()">{{ uploadInfo() | json }}</div>
      </section>

      <section class="card" *ngIf="result()">
        <h2>Result</h2>
        <div class="grid">
          <div class="kv"><span>Type</span><strong>{{ result()!.documentType }}</strong></div>
          <div class="kv"><span>Country</span><strong>{{ result()!.country }}</strong></div>
          <div class="kv"><span>First name</span><strong>{{ result()!.fields.firstName }}</strong></div>
          <div class="kv"><span>Last name</span><strong>{{ result()!.fields.lastName }}</strong></div>
          <div class="kv"><span>DoB</span><strong>{{ result()!.fields.dateOfBirth }}</strong></div>
          <div class="kv"><span>Expires</span><strong>{{ result()!.fields.expires }}</strong></div>
          <div class="kv"><span>Doc #</span><strong>{{ result()!.fields.documentNumber }}</strong></div>
          <div class="kv"><span>Confidence</span><strong>{{ (result()!.confidence*100).toFixed(1) }}%</strong></div>
          <div class="kv"><span>Screenshot?</span><strong>{{ result()!.liveness.isScreenshotSuspected ? 'YES' : 'NO' }}</strong></div>
        </div>
        <pre class="json">{{ result()!.raw | json }}</pre>
      </section>
    </main>

    <footer class="footer"><small>Responsive · mobile & tablet ready</small></footer>
  </div>
  `,
  styles: [`
  :root { --bg:#0b0c10; --card:#16181d; --text:#e8e8ea; --muted:#a9acb2; --accent:#7ab4ff; }
  *{box-sizing:border-box}
  body, html, .page { margin:0; padding:0; background:var(--bg); color:var(--text); font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
  .header{padding:20px;text-align:center}.header h1{margin:0 0 6px;font-size:clamp(22px,2.6vw,34px)}.subtitle{color:var(--muted);margin:0}
  .flagbar{position:sticky;top:0;z-index:5;background:rgba(20,22,28,0.85);backdrop-filter:blur(6px);padding:8px 16px;display:flex;gap:12px;justify-content:center;align-items:center}
  .toggle{display:flex;gap:10px;align-items:center;font-size:14px}.toggle input,select{height:28px}
  .btn{background:#2a2f3a;border:none;border-radius:12px;padding:10px 14px;color:var(--text);cursor:pointer}.btn.small{padding:6px 10px;font-size:12px}.btn.primary{background:var(--accent);color:#0a0a0a;font-weight:600}
  .content{display:grid;gap:16px;padding:16px;grid-template-columns:1fr;max-width:1100px;margin:0 auto}@media (min-width:900px){.content{grid-template-columns:1fr 1fr}}
  .card{background:var(--card);border-radius:16px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
  .uploader{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.preview-wrap{display:flex;gap:12px;margin-top:10px}.preview img{max-width:100%;height:auto;border-radius:12px;border:1px solid #2a2f3a;width:100%}
  .stepper{display:flex;align-items:center;gap:10px;margin:10px 0 16px}.step{padding:6px 10px;border-radius:999px;background:#232733;color:#cdd0d6;font-size:12px}.step.active{background:var(--accent);color:#0a0a0a;font-weight:600}.sep{width:20px;height:2px;background:#2a2f3a;border-radius:2px}
  .camera-wrap{position:relative}.camera-wrap video{width:100%;max-height:420px;border-radius:12px;display:block}
  .overlay{position:absolute;inset:0;pointer-events:none}.overlay .mask{position:absolute;inset:0;background:radial-gradient(transparent 60%, rgba(0,0,0,.45));border-radius:12px}
  .overlay .guide{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(85%,520px);aspect-ratio:1.586;border:2px dashed rgba(255,255,255,.45);border-radius:12px;box-shadow:0 0 0 9999px rgba(0,0,0,.35)}
  .overlay .guide.good{border-color:#22c55e;box-shadow:0 0 0 9999px rgba(0,0,0,.35),0 0 12px 2px rgba(34,197,94,.6)}
  @keyframes guidePulse{0%{box-shadow:0 0 0 9999px rgba(0,0,0,.35),0 0 10px 2px rgba(34,197,94,.6)}50%{box-shadow:0 0 0 9999px rgba(0,0,0,.35),0 0 20px 6px rgba(34,197,94,.8)}100%{box-shadow:0 0 0 9999px rgba(0,0,0,.35),0 0 10px 2px rgba(34,197,94,.6)}}
  .overlay .guide.capturing{border-style:solid;animation:guidePulse .6s ease-in-out 2}
  .overlay .corners span{position:absolute;width:28px;height:28px;border:3px solid rgba(255,255,255,.75)}
  .overlay .corners span:nth-child(1){left:-3px;top:-3px;border-right:0;border-bottom:0;border-radius:12px 0 0 0}
  .overlay .corners span:nth-child(2){right:-3px;top:-3px;border-left:0;border-bottom:0;border-radius:0 12px 0 0}
  .overlay .corners span:nth-child(3){left:-3px;bottom:-3px;border-right:0;border-top:0;border-radius:0 0 0 12px}
  .overlay .corners span:nth-child(4){right:-3px;bottom:-3px;border-left:0;border-top:0;border-radius:0 0 12px 0}
  .overlay .hint{position:absolute;left:50%;bottom:-34px;transform:translateX(-50%);font-size:12px;color:#a9acb2;background:rgba(0,0,0,.4);padding:4px 8px;border-radius:8px}
  .camera-actions{display:flex;gap:8px;align-items:center;margin-top:8px}
  .warn{color:#ff9}.muted{color:var(--muted)}
  .json{background:#0d0f14;padding:12px;border-radius:12px;overflow:auto;margin-top:10px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:12px}
  .kv{background:#0d0f14;padding:10px;border-radius:8px}.kv span{color:var(--muted);display:block;font-size:12px}
  .footer{text-align:center;padding:16px;color:var(--muted)}.hidden{display:none}
  `]
})
export class AppComponent implements OnDestroy {
  private http = inject(HttpClient);
  private blink = inject(BlinkIdSdkService);

  // settings
  apiBase = signal<string>((environment as any).apiBase || 'http://localhost:5000');
  licenseKey = signal<string>((environment as any).licenseKey ?? '');
  openSettings = false; settingsSaved = false;

  // QR
  qrOpen = false;

  // policy
  allowed = signal<'both' | AllowedDoc>('both');

  // sdk/mode
  useSdk = signal<boolean>(false);

  // capture state
  step = signal<'front' | 'back' | 'done'>('front');
  frontFile = signal<File | null>(null);
  backFile  = signal<File | null>(null);
  frontPreview = signal<string | null>(null);
  backPreview  = signal<string | null>(null);

  // verify
  result = signal<VerifyResultView | null>(null);
  uploading = signal<boolean>(false);
  progress = signal<number>(0);
  flowWarning = '';
  uploadInfo = signal<any | null>(null);

  // camera & auto-capture
  cameraActive = false;
  private mediaStream: MediaStream | null = null;
  guideGood = false; autoMode = true; autoCapturing = false;
  private rafId: number | null = null;
  captureHint: 'far' | 'close' | 'hold' | 'capturing' | 'plain' = 'plain';
  private stableFrames = 0;
  private readonly STABLE_THRESHOLD = 12; // 18; // ~0.6–0.8s stabilnog kadra
  private readonly MIN_BACK_DELAY_MS = 1200; // vreme da okreneš dokument
  private lastCaptureAt = 0;

  // heuristike (podesivi pragovi)
  private readonly SHARPNESS_VAR_MIN = 1800; // 2200;    // strože (bilo 1800)
  private readonly EDGE_DENSITY_MIN  = 0.045; // 0.065;   // % edge piksela u vodiču
  private readonly FILL_MIN = 0.62;             // vodič popunjenost
  private readonly FILL_MAX = 0.9;

  ngAfterViewInit(): void {
    // ako je QR panel otvoren, iscrtati
    if (this.qrOpen) this.drawQr();
  }

  saveSettings() {
    localStorage.setItem('blinkid_key', this.licenseKey());
    localStorage.setItem('api_base', this.apiBase());
    this.settingsSaved = true; setTimeout(()=> this.settingsSaved = false, 1500);
  }

  toggleQr() {
    this.qrOpen = !this.qrOpen;
    if (this.qrOpen) setTimeout(()=> this.drawQr(), 0);
  }

  private async drawQr() {
    const canvas = document.querySelector('canvas#qr') as HTMLCanvasElement
      || document.querySelector('section.card canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const url = `${location.origin}${location.pathname}`;
    await QRCode.toCanvas(canvas, url, { margin: 1, width: 220 });
  }

  async toggleMode(ev: Event) {
    const on = (ev.target as HTMLInputElement).checked;
    if (on) {
      try { await this.blink.init(this.licenseKey()); this.useSdk.set(true); }
      catch (e:any) { console.error(e); this.useSdk.set(false); alert(e?.message ?? 'BlinkID init failed'); }
    } else {
      this.useSdk.set(false); await this.blink.dispose();
    }
  }

  // ——— datoteke (ručni upload) ———
  onFrontFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (input.files?.length) {
      const f = input.files[0];
      this.frontFile.set(f); this.frontPreview.set(URL.createObjectURL(f));
      this.step.set('back'); this.flowWarning = '';
    }
  }
  onBackFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (input.files?.length) {
      const f = input.files[0];
      this.backFile.set(f); this.backPreview.set(URL.createObjectURL(f));
      this.step.set('done'); this.flowWarning = '';
    }
  }

  // ——— kamera ———
  async startCamera() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      this.cameraActive = true;
      setTimeout(() => {
        const video = document.querySelector('video') as HTMLVideoElement;
        if (video && this.mediaStream) {
          video.srcObject = this.mediaStream;
          // rezolucija sanity-check
          setTimeout(() => {
            if (video.videoWidth < 720 || video.videoHeight < 480) {
              this.flowWarning = 'Camera resolution is low. Try mobile (QR) or better lighting.';
            }
          }, 500);
          if (this.autoMode) this.startAutoCaptureLoop(video);
        }
      }, 0);
    } catch { alert('Camera permission denied'); }
  }
  stopCamera() {
    this.stopAutoCaptureLoop();
    this.mediaStream?.getTracks().forEach(t => t.stop());
    this.mediaStream = null; this.cameraActive = false;
  }

  // ručni capture (ostavljen, ali blokiran ako heuristike nisu ok)
  manualCaptureEnabled() { return  !this.autoCapturing; } // this.guideGood &&
  manualCapture(video: HTMLVideoElement) {
    if (!this.manualCaptureEnabled()) return;
    this.captureFrame(video);
  }

  private stopAutoCaptureLoop() {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null; this.guideGood = false; this.autoCapturing = false;
    this.captureHint = 'plain'; this.stableFrames = 0;
  }

  private startAutoCaptureLoop(video: HTMLVideoElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      if (!video.videoWidth || !video.videoHeight) return;

      const W = 640, H = Math.round((video.videoHeight / video.videoWidth) * W);
      canvas.width = W; canvas.height = H;
      ctx.drawImage(video, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H).data;

      // procena distance (popunjenost vodiča u odnosu na video dim.)
      const guideFrac = Math.min(video.clientWidth * 0.85, 520) / video.clientWidth;
      if (guideFrac < 0.55) this.captureHint = 'far';
      else if (guideFrac > 0.92) this.captureHint = 'close';
      else this.captureHint = 'hold';

      // oštrina (varijansa luminanse)
      let sum=0, sumSq=0;
      for (let i=0;i<data.length;i+=4) {
        const y = 0.2126*data[i] + 0.7152*data[i+1] + 0.0722*data[i+2];
        sum += y; sumSq += y*y;
      }
      const n = data.length/4;
      const mean = sum/n;
      const variance = (sumSq/n) - (mean*mean);
      const sharpOk = variance > this.SHARPNESS_VAR_MIN;

      // edge density (Sobel aproks.) — samo sićušna detekcija
      let edges = 0;
      const step = 4, stride = W*4;
      for (let y=1;y<H-1;y+=2) {
        for (let x=1;x<W-1;x+=2) {
          const i = y*stride + x*4;
          const yl = 0.2126*data[i-4] + 0.7152*data[i-3] + 0.0722*data[i-2];
          const yr = 0.2126*data[i+4] + 0.7152*data[i+5] + 0.0722*data[i+6];
          const yu = 0.2126*data[i-stride] + 0.7152*data[i-stride+1] + 0.0722*data[i-stride+2];
          const yd = 0.2126*data[i+stride] + 0.7152*data[i+stride+1] + 0.0722*data[i+stride+2];
          const gx = Math.abs(yr-yl), gy = Math.abs(yd-yu);
          if (gx+gy > 60) edges++;
        }
      }
      const edgeDensity = edges / ((W/2)*(H/2));
      const edgesOk = edgeDensity > this.EDGE_DENSITY_MIN;

      const fillOk = guideFrac >= this.FILL_MIN && guideFrac <= this.FILL_MAX;

      // stabilizacija
      if (sharpOk && edgesOk && fillOk) this.stableFrames = Math.min(this.stableFrames + 1, this.STABLE_THRESHOLD + 8);
      else this.stableFrames = Math.max(this.stableFrames - 1, 0);

      this.guideGood = this.stableFrames >= this.STABLE_THRESHOLD;

      // front/back throttle: daj vremena da okrene dokument
      const now = Date.now();
      const throttleOk = this.step() === 'front' || (now - this.lastCaptureAt) > this.MIN_BACK_DELAY_MS;

      if (this.guideGood && !this.autoCapturing && throttleOk) {
        this.autoCapturing = true; this.captureHint = 'capturing';
        setTimeout(() => {
          if (this.guideGood) this.captureFrame(video);
          this.autoCapturing = false;
          this.stableFrames = 0;
          this.guideGood = false;
          this.captureHint = 'plain';
        }, 380);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  // izreži (crop) samo vodič iz videa, generiši File
  private cropFromGuide(videoEl: HTMLVideoElement): File | null {
    // izračun vodiča iz realnih dimenzija video elementa
    const rect = videoEl.getBoundingClientRect();
    const guideWpx = Math.min(rect.width * 0.85, 520);
    const guideHpx = guideWpx / 1.586;
    const guideLeft = (rect.width - guideWpx) / 2;
    const guideTop  = (rect.height - guideHpx) / 2;
  
    // mapiranje na nativnu rezoluciju videa
    const sx = guideLeft / rect.width * videoEl.videoWidth;
    const sy = guideTop  / rect.height * videoEl.videoHeight;
    const sw = guideWpx  / rect.width * videoEl.videoWidth;
    const sh = guideHpx  / rect.height * videoEl.videoHeight;
    if (!isFinite(sx) || !isFinite(sy) || !isFinite(sw) || !isFinite(sh) || sw <= 2 || sh <= 2) {
      // fallback: uzmi ceo frame
      return this.fullFrameCapture(videoEl);
    }
  
    // koristimo offscreen, pa na kraju u "cap" canvas (da izbegnemo QR canvas zabunu)
    const off = document.createElement('canvas');
    off.width = Math.round(sw);
    off.height = Math.round(sh);
    const octx = off.getContext('2d');
    if (!octx) return null;
    octx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, off.width, off.height);
  
    // blagi upscale za OCR
    const up = document.createElement('canvas');
    up.width = Math.round(off.width * 1.2);
    up.height = Math.round(off.height * 1.2);
    const uctx = up.getContext('2d')!;
    uctx.imageSmoothingEnabled = true;
    uctx.drawImage(off, 0, 0, up.width, up.height);
  
    // samo za debug (nije obavezno): preslikaj u cap canvas
    const cap = this.getCapCanvas();
    cap.width = up.width; cap.height = up.height;
    const cctx = cap.getContext('2d')!;
    cctx.drawImage(up, 0, 0);
  
    const blob = this.canvasToJpeg(up, 0.95);
    if (!blob) return null;
    return new File([blob], (this.step()==='front'?'front':'back') + '.jpg', { type: 'image/jpeg' });
  }
  
  private fullFrameCapture(videoEl: HTMLVideoElement): File | null {
    const cap = this.getCapCanvas();
    cap.width = videoEl.videoWidth;
    cap.height = videoEl.videoHeight;
    const ctx = cap.getContext('2d'); if (!ctx) return null;
    ctx.drawImage(videoEl, 0, 0);
    const blob = this.canvasToJpeg(cap, 0.95);
    if (!blob) return null;
    return new File([blob], (this.step()==='front'?'front':'back') + '.jpg', { type: 'image/jpeg' });
  }
  

  private canvasToJpeg(canvas: HTMLCanvasElement, quality=0.95): Blob | null {
    try {
      return this.dataURLToBlob(canvas.toDataURL('image/jpeg', quality));
    } catch { return null; }
  }
  private dataURLToBlob(dataURL: string): Blob {
    const arr = dataURL.split(','), mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]); let n = bstr.length; const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], { type: mime });
  }

  private captureFrame(videoEl: HTMLVideoElement) {
    // const file = this.cropFromGuide(videoEl);
    const file = this.fullFrameCapture(videoEl);
    if (!file) return;

    const url = URL.createObjectURL(file);
    this.lastCaptureAt = Date.now();

    if (this.step()==='front') {
      this.frontFile.set(file); this.frontPreview.set(url); this.step.set('back'); this.flowWarning = 'Please scan the BACK side now.';
    } else {
      // quick side check – blokiraj ako je opet front
      if (this.useSdk()) {
        this.blink.quickCheckSide(file, 'back').then(ok => {
          if (!ok) { this.flowWarning = 'It looks like FRONT again. Please scan BACK side.'; return; }
          this.backFile.set(file); this.backPreview.set(url); this.step.set('done'); this.flowWarning = '';
        });
      } else {
        this.backFile.set(file); this.backPreview.set(url); this.step.set('done'); this.flowWarning = '';
      }
    }
  }

  toggleAuto(video: HTMLVideoElement, ev: Event) {
    this.autoMode = (ev.target as HTMLInputElement).checked;
    if (this.autoMode) this.startAutoCaptureLoop(video);
    else this.stopAutoCaptureLoop();
  }

  // ——— verify ———
  verDisabled() {
    return this.uploading() || (this.useSdk() ? !(this.frontFile() && this.backFile()) : !this.frontFile());
  }
  private allowedList(): AllowedDoc[] {
    const sel = this.allowed();
    if (sel === 'id') return ['id']; if (sel === 'passport') return ['passport']; return ['id','passport'];
  }

  async verify() {
    if (this.uploading()) return;
    this.flowWarning = '';

    if (this.useSdk()) {
      try {
        this.uploading.set(true);
        // @ts-ignore
        if ((this.blink as any).isReady && !(this.blink as any).isReady()) await this.blink.init(this.licenseKey());
        const ff = this.frontFile(); const bf = this.backFile();
        if (!ff) throw new Error('Missing front image'); if (!bf) throw new Error('Missing back image');

        await this.blink.scanFront(ff);
        const core = await this.blink.scanBack(bf, this.allowedList());

        const docType = (core.classInfo?.type || '').toUpperCase() || 'UNKNOWN';
        const country = core.classInfo?.country || 'Unknown';

        this.result.set({
          raw: core.raw, documentType: docType, country,
          fields: core.fields,
          liveness: { glareDetected: !!core.liveness.glareDetected, isScreenshotSuspected: core.liveness.isScreenshotSuspected, frameQuality: core.liveness.frameQuality },
          confidence: core.confidence, processedAt: new Date().toISOString()
        });
        this.step.set('done');
      } catch (e:any) {
        console.error(e); this.flowWarning = e?.message ?? 'SDK verification failed';
      } finally { this.uploading.set(false); }
      return;
    }

    // Backend mock (samo front je obavezan; back je opciono)
    const f = this.frontFile(); 

    if (!f) 
      return;

    const form = new FormData(); form.append('image', f);
    const bf = this.backFile(); 

    if (bf) 
      form.append('imageBack', bf);
    
    this.uploading.set(true); 
    this.progress.set(0);

    this.http.post<VerifyResultView>(`${this.apiBase()}/api/verify`, form, { reportProgress: true, observe: 'events' })
      .subscribe({
        next: ev => {
          if (ev.type === HttpEventType.UploadProgress && ev.total) this.progress.set(Math.round(100 * ev.loaded / ev.total));
          else if (ev.type === HttpEventType.Response) { this.result.set(ev.body as VerifyResultView); this.uploading.set(false); this.step.set('done'); }
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

  private getCapCanvas(): HTMLCanvasElement {
    const el = document.getElementById('cap') as HTMLCanvasElement | null;
    if (!el) throw new Error('Capture canvas not found');
    return el;
  }
  

  ngOnDestroy(): void { this.stopCamera(); }
}
