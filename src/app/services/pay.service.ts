// src/app/services/pay.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap, catchError, throwError } from 'rxjs';
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

  
  
  private normalizePlan(plan: string): 'daily'|'monthly'|'quarterly'|'yearly' {
    const p = (plan || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!p) throw new Error('Empty plan key');

    // yearly
    if (/(year|annual|12m|yr|y$)/.test(p)) return 'yearly';

    // quarterly
    if (/(quarter|3m|qtr|q$)/.test(p)) return 'quarterly';

    // monthly (default when it clearly mentions month/30/31)
    if (/(month|mnth|mo|30d|31d|mon|mth)/.test(p)) return 'monthly';

    // daily
    if (/(day|1d|daily|24h|d$)/.test(p)) return 'daily';

    // common aliases
    switch (p) {
      case 'monthly': case 'month': case 'm': return 'monthly';
      case 'quarterly': case 'quarter': case 'q': case '3months': return 'quarterly';
      case 'yearly': case 'annual': case 'year': case 'y': return 'yearly';
      case 'daily': case 'day': case 'd': return 'daily';
    }
    // If it's a custom marketing name, map here if needed
    throw new Error(`Unknown plan: ${plan}`);
  }
getPlanInfo(plan: string): PlanInfo {
  //temporary
  return { days: 1, label: 'NOMO daily subscription', amount: 1 }
    //temporary
    const key = this.normalizePlan(plan);
    switch (key) {
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


  confirmPayment(planSelected: string, userEmail: string): Observable<void> {
    return this.beginHostedPayment(planSelected, userEmail);
  }

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
    tap((resp: any) => {
      console.log('[start] response:', resp); // <- see the actual shape
      const { url, lowProfileId } = resp || {};
      if (!url || typeof url !== 'string') {
        throw new Error('Cardcom did not return a payment URL');
      }
      sessionStorage.setItem('pay.orderId', orderId);
      sessionStorage.setItem('pay.lowProfileId', String(lowProfileId ?? ''));
      this.safeNavigate(url); // robust redirect
    }),
    map(() => void 0),
    catchError((e) => {
      const msg = e?.error?.error || e?.message || 'Payment init failed';
      console.error('start failed:', e);
      return throwError(() => new Error(msg));
    })
  );
}
private safeNavigate(url: string) {
  // 1) normal way
  try { if (typeof window !== 'undefined') window.location.assign(url); } catch {}

  // 2) anchor fallback
  try {
    if (typeof document !== 'undefined') {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_self';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
    }
  } catch {}

  // 3) hard replace
  try { if (typeof window !== 'undefined') window.location.href = url; } catch {}
}
  // Extract Cardcom hosted URL from various possible response shapes
  private extractUrl(resp: any): string | undefined {
    if (!resp) return undefined;
    const candidates = [
      resp?.url,
      resp?.URL,
      resp?.paymentUrl,
      resp?.PaymentUrl,
      resp?.redirectUrl,
      resp?.RedirectUrl,
      resp?.hostedUrl,
      resp?.HostedUrl,
      resp?.HostedPaymentPageUrl,
      resp?.data?.url,
      resp?.Data?.Url,
      resp?.result?.url,
      resp?.Result?.Url,
    ];
    for (const v of candidates) {
      if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
    }
    return undefined;
  }

  // Extract LowProfileId from various possible response shapes
  private extractLowProfileId(resp: any): string | undefined {
    if (!resp) return undefined;
    const candidates = [
      resp?.lowProfileId,
      resp?.LowProfileId,
      resp?.LowProfileID,
      resp?.data?.lowProfileId,
      resp?.Data?.LowProfileId,
      resp?.result?.lowProfileId,
      resp?.Result?.LowProfileId,
    ];
    for (const v of candidates) {
      if (typeof v === 'string' && v.length) return v;
    }
    return undefined;
  }
}
