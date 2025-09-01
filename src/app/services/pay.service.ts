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
  planDays?: number; 
  /** Optional overrides (normally auto-filled from window.location.origin) */
  successUrl?: string;
  failUrl?: string;
}

export interface StartPaymentResponse {
  url: string;                    // Cardcom hosted payment URL
  lowProfileId: string;           // save for status checks
}

export interface PlanInfo {
  days: number;      // number of days
  label: string;     // string to show the user
  amount: number;    // amount to charge
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
  
  makeOrderId(): string {
    // Example: ORD-<timestamp>-<4char random>
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `ORD-${Date.now()}-${rand}`;
  }

  getPlanName(numDays: number): string {
    switch (numDays) {
      case 1: return 'Daily';
      case 28: return 'Monthly';
      case 29: return 'Monthly';
      case 30: return 'Monthly';
      case 31: return 'Monthly';
      case 90: return 'Quarterly';
      case 365: return 'Yearly';
      default: return `${numDays} days`;
    }
  }

  getPlanInfo(plan: string): PlanInfo {
    console.log("payment chosen, plan selected is ", plan);

    //temporary 
        return {
          days: 1,
          label: 'NOMO monthly subscription',
          amount: 1,  
        };
    //temporary 
    switch (plan.toLowerCase()) {
      case 'yearly':
        return {
          days: 365,
          label: 'NOMO yearly subscription',
          amount: 20*12,  
        };
      case 'quarterly':
        return {
          days: 90,
          label: 'NOMO quarterly subscription',
          amount: 29*3,  
        };    
      case 'monthly':
        return {
          days: 31,
          label: 'NOMO monthly subscription',
          amount: 39,  
        };
      case 'daily':
        return {
          days: 1,
          label: 'Daily access',
          amount: 20,  
        };
      default:
        throw new Error(`Unknown plan: ${plan}`);
    }
  }

  confirmPayment(planSelected: string, userEmail: string): string {
    const planInfo  = this.getPlanInfo(planSelected);
    const amount = planInfo.amount;
    const orderId = this.makeOrderId();
    const description = planInfo.label;
    const currency = 1;     // 1 = ILS;
    const planDays = planInfo.days;
    let payError = '';

    this.startPayment({ amount, orderId, description, currency ,userEmail,planDays })
      .subscribe({
        next: ({ url, lowProfileId }) => {
          sessionStorage.setItem('lastLowProfileId', String(lowProfileId));
          sessionStorage.setItem('lastOrderId', orderId);
          window.location.href = url; // go to Cardcom hosted page
        },
        error: err => {
          console.error('Payment init failed', err);
          payError = err?.error?.error || 'Payment init failed';
        }
      });
    return payError;
  }  

}
