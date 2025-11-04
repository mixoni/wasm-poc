import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ToastService {
  toasts = signal<{text:string}[]>([]);
  show(text: string) {
    this.toasts.update(arr => [...arr, { text }]);
    setTimeout(() => this.toasts.update(arr => arr.slice(1)), 2500);
  }
}
