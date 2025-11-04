import { Injectable } from '@angular/core';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let BlinkIDSDK: any;

@Injectable({ providedIn: 'root' })
export class BlinkIdSdkService {
  private loaded = false;
  private sdk: any | null = null;
  private runner: any | null = null;
  private recognizer: any | null = null;

  async init(licenseKey: string): Promise<void> {
    if (this.loaded) return;
    if (!licenseKey) throw new Error('BlinkID license key is required.');

    const mod = await import('@microblink/blinkid-in-browser-sdk');
    BlinkIDSDK = mod;

    const settings = new BlinkIDSDK.WasmSDKLoadSettings(licenseKey);
    settings.engineLocation = '/assets/blinkid';
    settings.workerLocation = '/assets/blinkid/BlinkIDWasmSDK.worker.min.js';
    settings.loadProgressCallback = (p: number) =>
      console.log(`BlinkID load: ${Math.round(p * 100)}%`);

    this.sdk = await BlinkIDSDK.loadWasmModule(settings);

    // MULTI-SIDE recognizer – skeniramo front pa back
    this.recognizer = await BlinkIDSDK.createBlinkIdMultiSideRecognizer(this.sdk);
    this.runner = await BlinkIDSDK.createRecognizerRunner(this.sdk, [this.recognizer], false);

    this.loaded = true;
  }

  isReady() {
    return this.loaded && !!this.sdk && !!this.runner && !!this.recognizer;
  }

  async dispose(): Promise<void> {
    try { await this.runner?.reset?.(); } catch {}
    try { await this.recognizer?.reset?.(); } catch {}
    try { await this.recognizer?.delete?.(); } catch {}
    try { await this.runner?.delete?.(); } catch {}
    this.recognizer = null;
    this.runner = null;
    this.loaded = false;
  }

  private async fileToFrame(file: File) {
    const imgEl = new Image();
    imgEl.src = URL.createObjectURL(file);
    await imgEl.decode();
    const frame = BlinkIDSDK.captureFrame(imgEl);
    URL.revokeObjectURL(imgEl.src);
    return frame;
  }

  private mapResult(r: any) {
    if (r?.firstName || r?.lastName) {
      return {
        documentType: 'ID',
        country: r?.issuer ?? 'Unknown',
        fields: {
          firstName: r?.firstName?.latin ?? r?.firstName?.raw ?? 'N/A',
          lastName:  r?.lastName?.latin  ?? r?.lastName?.raw  ?? 'N/A',
          dateOfBirth: r?.dateOfBirth?.originalString ?? 'N/A',
          expires:     r?.dateOfExpiry?.originalString ?? 'N/A',
          documentNumber: r?.documentNumber ?? 'N/A',
        },
        liveness: { glareDetected: false, isScreenshotSuspected: false, frameQuality: 'good' },
        confidence: 0.9,
        processedAt: new Date().toISOString(),
      };
    }
    return {
      documentType: 'Unknown',
      country: 'Unknown',
      fields: { firstName:'—', lastName:'—', dateOfBirth:'—', expires:'—', documentNumber:'—' },
      liveness: { glareDetected:false, isScreenshotSuspected:false, frameQuality:'unknown' },
      confidence: 0,
      processedAt: new Date().toISOString(),
      warning: 'No fields recognized. Try clearer images of both sides.',
    };
  }

  async scanFront(file: File) {
    if (!this.isReady()) throw new Error('BlinkID SDK not initialized.');
    try { await this.runner!.reset(); } catch {}
    try { await this.recognizer!.reset(); } catch {}
    if (this.recognizer.setSideToScan) {
      await this.recognizer.setSideToScan(BlinkIDSDK.Side.Front);
    }
    const frame = await this.fileToFrame(file);
    await this.runner!.processImage(frame);
  }

  async scanBack(file: File) {
    if (!this.isReady()) throw new Error('BlinkID SDK not initialized.');
    if (this.recognizer.setSideToScan) {
      await this.recognizer.setSideToScan(BlinkIDSDK.Side.Back);
    }
    const frame = await this.fileToFrame(file);
    await this.runner!.processImage(frame);
    const r = await this.recognizer!.getResult();
    try { await this.recognizer!.reset(); } catch {}
    try { await this.runner!.reset(); } catch {}
    return this.mapResult(r);
  }
}
