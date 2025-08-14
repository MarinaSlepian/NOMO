// src/app/services/pay.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface StartPaymentRequest {
  amount: number;                 // major units (₪)
  orderId: string;                // your internal id
  description?: string;
  currency?: number;              // 1 = ILS
  userEmail?: string;   
  /** Optional overrides (normally auto-filled from window.location.origin) */
  successUrl?: string;
  failUrl?: string;
}

export interface StartPaymentResponse {
  url: string;                    // Cardcom hosted payment URL
  lowProfileId: string;           // save for status checks
}

@Injectable({ providedIn: 'root' })
export class PayService {
  private http = inject(HttpClient);

  // Normalize base (remove trailing slash). If empty, you can still use a proxy.
  private readonly base = (environment.apiUrl || '').replace(/\/+$/, '');
  private readonly api  = `${this.base}/api/pay`;

  /**
   * Starts a payment. Automatically provides success/fail URLs based on the current origin,
   * so dev ports (4200, 4300, etc.) are always handled.
   */
  startPayment(body: StartPaymentRequest): Observable<StartPaymentResponse> {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const successUrl = body.successUrl ?? (origin ? `${origin}/pay/success` : undefined);
    const failUrl    = body.failUrl    ?? (origin ? `${origin}/pay/failed`  : undefined);

    const payload = {
      ...body,
      ...(successUrl ? { successUrl } : {}),
      ...(failUrl ? { failUrl } : {})
    };

    return this.http.post<StartPaymentResponse>(`${this.api}/start`, payload);
  }

  /** Optional: manual status check by LowProfileId */
  getStatus(lowProfileId: string): Observable<any> {
    return this.http.get<any>(`${this.api}/status/${encodeURIComponent(lowProfileId)}`);
  }
}
