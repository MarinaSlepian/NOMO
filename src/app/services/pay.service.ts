// src/app/services/pay.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface StartPaymentRequest {
  amount: number;
  orderId: string;
  description?: string;
  currency?: number;          // 1 = ILS
  userEmail?: string;
  planDays?: number;
  successUrl?: string;         // sent only if public HTTPS
  failUrl?: string;            // sent only if public HTTPS
}

export interface StartPaymentResponse {
  url: string;
  lowProfileId: string;
}

export interface TokenChargeRequest {
  token?: string;              // prefer server-side lookup in prod
  amount: number;
  currency?: number;
  orderId?: string;
  description?: string;
  isRefund?: boolean;
  userEmail?: string;
  customerName?: string;
  issueInvoice?: boolean;      // default true
  invoice?: {
    custName?: string;
    sendByEmail?: boolean;
    email?: string;
    language?: 'he' | 'en';
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    phone?: string;
    mobile?: string;
    compId?: string;
    departmentId?: number;
    isVatFree?: boolean;
    lineDescription?: string;
    lineIsVatFree?: boolean;
    productId?: string;
  };
}

export interface TokenChargeResponse {
  ResponseCode: number | string;
  Description?: string;
  [k: string]: any;
}

export interface PlanInfo {
  days: number;
  label: string;
  amount: number;
}

@Injectable({ providedIn: 'root' })
export class PayService {
  private http = inject(HttpClient);

  private readonly base = (environment.apiUrl || '').replace(/\/+$/, '');
  private readonly api  = `${this.base}/api/pay`;

  /** Accept only public https URLs (backend rejects localhost/http). */
  private isPublicHttps(urlStr: string): boolean {
    try {
      const u = new URL(urlStr);
      return u.protocol === 'https:' && u.hostname !== 'localhost' && !u.hostname.endsWith('.local');
    } catch {
      return false;
    }
  }

  /** LowProfile v11: start hosted payment and return URL/LowProfileId. */
  startPayment(body: StartPaymentRequest): Observable<StartPaymentResponse> {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    const candidateSuccess = body.successUrl ?? (origin ? `${origin}/pay/success` : '');
    const candidateFail    = body.failUrl    ?? (origin ? `${origin}/pay/failed`  : '');

    const payload: StartPaymentRequest = {
      ...body,
      ...(this.isPublicHttps(candidateSuccess) ? { successUrl: candidateSuccess } : {}),
      ...(this.isPublicHttps(candidateFail)    ? { failUrl: candidateFail }       : {}),
    };

    return this.http.post<StartPaymentResponse>(`${this.api}/start`, payload);
  }

  /** Optional utility (only if you implement /api/pay/status/:lowProfileId). Otherwise poll /api/me in the success component. */
  getStatus(lowProfileId: string): Observable<any> {
    return this.http.get<any>(`${this.api}/status/${encodeURIComponent(lowProfileId)}`);
  }

  /** Step 3: charge/refund a token (admin tooling). Prefer server-side token lookup. */
  chargeToken(body: TokenChargeRequest): Observable<TokenChargeResponse> {
    const payload: TokenChargeRequest = {
      currency: 1,
      issueInvoice: body.issueInvoice ?? true,
      ...body
    };
    return this.http.post<TokenChargeResponse>(`${this.api}/token-charge`, payload);
  }

  refundToken(body: Omit<TokenChargeRequest, 'isRefund'>): Observable<TokenChargeResponse> {
    return this.chargeTokenWithFlag({ ...body, isRefund: true });
  }

  private chargeTokenWithFlag(body: TokenChargeRequest): Observable<TokenChargeResponse> {
    const payload: TokenChargeRequest = {
      currency: 1,
      issueInvoice: body.issueInvoice ?? true,
      ...body
    };
    return this.http.post<TokenChargeResponse>(`${this.api}/token-charge`, payload);
  }

  makeOrderId(): string {
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `ORD-${Date.now()}-${rand}`;
  }

  getPlanName(numDays: number): string {
    switch (numDays) {
      case 1: return 'Daily';
      case 28:
      case 29:
      case 30:
      case 31: return 'Monthly';
      case 90: return 'Quarterly';
      case 365: return 'Yearly';
      default: return `${numDays} days`;
    }
  }

  getPlanInfo(plan: string): PlanInfo {
    //temporary 
    return {
      days: 1,
      label: 'NOMO monthly subscription',
      amount: 1,
    };
    //temporary 
    switch (plan.toLowerCase()) {
      case 'yearly':
        return { days: 365, label: 'NOMO yearly subscription', amount: 20 * 12 };
      case 'quarterly':
        return { days: 90, label: 'NOMO quarterly subscription', amount: 29 * 3 };
      case 'monthly':
        return { days: 31, label: 'NOMO monthly subscription', amount: 39 };
      case 'daily':
        return { days: 1, label: 'Daily access', amount: 20 };
      default:
        throw new Error(`Unknown plan: ${plan}`);
    }
  }
  // src/app/services/pay.service.ts (inside PayService class)
  confirmPayment(planSelected: string, userEmail: string): string {
    // keeps old calling pattern; redirects on success
    let payError = '';
    this.beginHostedPayment(planSelected, userEmail).subscribe({
      next: () => {}, // we redirect in beginHostedPayment
      error: (e) => {
        console.error('Payment init failed', e);
        payError = e?.error?.error || 'Payment init failed';
        alert(payError);
      }
    });
    return payError;
  }
  /**
   * Begin the hosted payment flow. Returns an Observable that completes once we redirect to Cardcom.
   * Caller should subscribe (and likely disable the Buy button until subscription completes).
   */
  beginHostedPayment(planSelected: string, userEmail: string): Observable<void> {
    const { days, label, amount } = this.getPlanInfo(planSelected);
    const orderId = this.makeOrderId();

    const req: StartPaymentRequest = {
      amount,
      orderId,
      description: label,
      currency: 1,
      userEmail,
      planDays: days
    };

    return this.startPayment(req).pipe(
      tap(({ url, lowProfileId }) => {
        sessionStorage.setItem('pay.orderId', orderId);
        sessionStorage.setItem('pay.lowProfileId', String(lowProfileId));
        // redirect to Cardcom
        if (typeof window !== 'undefined' && url) {
          window.location.assign(url);
        }
      }),
      map(() => void 0)
    );
  }
}
