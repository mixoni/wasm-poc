  import { Injectable } from '@angular/core';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let BlinkIDSDK: any;

  export type AllowedDoc = 'id' | 'passport';

  export type VerificationCore = {
    raw: any;
    classInfo?: { country?: string; type?: string };
    fields: {
      firstName: string; lastName: string; dateOfBirth: string; expires: string; documentNumber: string;
    };
    liveness: { isScreenshotSuspected: boolean; glareDetected?: boolean; frameQuality: 'good'|'ok'|'unknown' };
    confidence: number;
  };

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
      settings.loadProgressCallback = (p: number) => console.log(`BlinkID load: ${Math.round(p * 100)}%`);

      this.sdk = await BlinkIDSDK.loadWasmModule(settings);

      this.recognizer = await BlinkIDSDK.createBlinkIdMultiSideRecognizer(this.sdk);

      this.recognizer?.setReturnFullDocumentImage?.(true);
      this.recognizer?.setAllowUncertainFrontSideScan?.(true);
      this.recognizer?.setEncodeFaceImage?.(false);
      this.recognizer?.setAnonymizationMode?.(BlinkIDSDK.AnonymizationMode?.FullResult ?? 0);

      this.runner = await BlinkIDSDK.createRecognizerRunner(this.sdk, [this.recognizer], false);

      this.loaded = true;
    }

    isReady() { return this.loaded && !!this.sdk && !!this.runner && !!this.recognizer; }

    async dispose(): Promise<void> {
      try { await this.runner?.reset?.(); } catch {}
      try { await this.recognizer?.reset?.(); } catch {}
      try { await this.recognizer?.delete?.(); } catch {}
      try { await this.runner?.delete?.(); } catch {}
      this.recognizer = null; this.runner = null; this.loaded = false;
    }

    private async fileToFrame(file: File) {
      const imgEl = new Image();
      imgEl.src = URL.createObjectURL(file);
      await imgEl.decode();
      const frame = BlinkIDSDK.captureFrame(imgEl);
      URL.revokeObjectURL(imgEl.src);
      return frame;
    }

    private val(...candidates: any[]): string {
      for (const c of candidates) {
        if (c == null) continue;
        if (typeof c === 'string') return c.trim();
        if (typeof c === 'number') return String(c);
        if (typeof c === 'object') {
          if (typeof (c.value) === 'string') return c.value.trim();
          if (typeof (c.latin) === 'string') return c.latin.trim();
          if (typeof (c.raw) === 'string') return c.raw.trim();
          if (typeof (c.originalString) === 'string') return c.originalString.trim();
          if ('year' in c && 'month' in c && 'day' in c) {
            const y = c.year, m = String(c.month).padStart(2,'0'), d = String(c.day).padStart(2,'0');
            return `${y}-${m}-${d}`;
          }
        }
      }
      return '';
    }
    
    private docKind(r: any): 'id'|'passport'|'other' {
      const enumVal = r?.classInfo?.documentType ?? r?.documentType;
      // 1) Enumi iz SDK-a
      if (typeof enumVal === 'number' && (globalThis as any).BlinkIDSDK) {
        const DT = (BlinkIDSDK as any).DocumentType;
        if (DT) {
          if (enumVal === DT.IdentityCard) return 'id';
          if (enumVal === DT.Passport || enumVal === DT.TravelDocument) return 'passport';
        }
      }
      // 2) Tekstualni oblici
      const rawTxt = this.val(r?.classInfo?.documentType, r?.documentType, r?.documentTypeText).toLowerCase();
      if (rawTxt) {
        if (/(identity\s*card|id\s*card|personal\s*id|lična\s*karta|licna\s*karta)/i.test(rawTxt)) return 'id';
        if (/(passport)/i.test(rawTxt)) return 'passport';
      }
      // 3) MRZ heuristika – 'P' označava pasoš
      const mrzCode = this.val(r?.mrz?.documentCode);
      if (mrzCode?.startsWith('P')) return 'passport';
    
      return 'other';
    }
    

    private mapResult(r: any): VerificationCore {
      const country = this.val(r?.classInfo?.issuer, r?.issuer, r?.nationality);
      const docType = this.val(r?.classInfo?.documentType, r?.documentType, r?.documentTypeText);
    
      const core: VerificationCore = {
        raw: r,
        classInfo: {
          country: country || undefined,
          type:    docType   || undefined
        },
        fields: {
          firstName:     this.val(r?.firstName?.latin, r?.firstName?.value, r?.firstName?.raw, r?.firstName),
          lastName:      this.val(r?.lastName?.latin,  r?.lastName?.value,  r?.lastName?.raw,  r?.lastName),
          dateOfBirth:   this.val(r?.dateOfBirth?.originalString, r?.dateOfBirth, r?.dob),
          expires:       this.val(r?.dateOfExpiry?.originalString, r?.dateOfExpiry, r?.expiryDate),
          documentNumber:this.val(r?.documentNumber, r?.mrz?.documentNumber, r?.mrz?.primaryIdNumber, r?.idNumber),
        },
        liveness: {
          isScreenshotSuspected: !!r?.isScreenshotSuspected,
          glareDetected: !!r?.isGlareDetected,
          frameQuality: 'good'
        },
        confidence: typeof r?.recognitionConfidence === 'number' ? r.recognitionConfidence : 0.9
      };
    
      // Ako MRZ postoji, pretpostavi pasoš dok “classInfo” ne bude eksplicitan
      const mrz = r?.mrz || r?.mrzResult;
      if ((mrz?.mrzText || mrz?.documentCode) && !core.classInfo?.type) {
        core.classInfo = core.classInfo ?? {};
        core.classInfo.type = 'Passport';
      }
      return core;
    }
    

    async scanFront(file: File) {
      if (!this.isReady()) throw new Error('BlinkID SDK not initialized.');
      try { await this.runner!.reset(); } catch {}
      try { await this.recognizer!.reset(); } catch {}

      if (this.recognizer.setSideToScan) await this.recognizer.setSideToScan(BlinkIDSDK.Side.Front);
      const frame = await this.fileToFrame(file);
      await this.runner!.processImage(frame);
    }

    async scanBack(file: File, allowed: AllowedDoc[] = ['id','passport']) {
      if (!this.isReady()) throw new Error('BlinkID SDK not initialized.');
      if (this.recognizer.setSideToScan) await this.recognizer.setSideToScan(BlinkIDSDK.Side.Back);
      const frame = await this.fileToFrame(file);
      await this.runner!.processImage(frame);

      const r = await this.recognizer!.getResult();
      let core = this.mapResult(r);

      const kind = this.docKind(r); // 'id' | 'passport' | 'other'
      core.classInfo = core.classInfo ?? {};
      if (!core.classInfo.type) {
        core.classInfo.type = kind === 'id' ? 'Identity Card' : kind === 'passport' ? 'Passport' : 'Unknown';
      }

      const okType =
        (kind === 'id' && allowed.includes('id')) ||
        (kind === 'passport' && allowed.includes('passport')) ||
        (kind === 'other' && allowed.length > 0); // dozvoli "other" ako ne želimo striktno odbijanje

      if (!okType) {
        throw new Error(`Unsupported document type (${core.classInfo.type}). Allowed: ${allowed.map(a => a.toUpperCase()).join(' or ')}`);
      }


      if (core.liveness.isScreenshotSuspected) throw new Error('Detected screen image. Please scan a physical document.');

      try { await this.recognizer!.reset(); } catch {}
      try { await this.runner!.reset(); } catch {}
      return core;
    }

    async quickCheckSide(file: File, expect: 'front' | 'back'): Promise<boolean> {
      if (!this.isReady()) return true;
      try {
        await this.recognizer!.reset();
        if (this.recognizer.setSideToScan) await this.recognizer.setSideToScan(expect === 'front' ? BlinkIDSDK.Side.Front : BlinkIDSDK.Side.Back);
        const frame = await this.fileToFrame(file);
        const res = await this.runner!.processImage(frame);
        return !!res;
      } catch { return false; }
      finally { try { await this.runner!.reset(); } catch {} }
    }
  }
