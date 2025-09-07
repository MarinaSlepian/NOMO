// entitlement.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, shareReplay } from 'rxjs/operators';
import { Observable, of } from 'rxjs';

export type PlanStatus = 'none' | 'trialing' | 'active' | 'grace' | 'past_due' | 'canceled';


export interface PlanInfo {
  status: PlanStatus;
  current_period_end: string | null;
  next_charge_date: string | null;
  plan_days: number | null; // e.g., 30, 90, 365
}

export interface PaymentMethod {
  brand: string;// e.g., 'visa'
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
}

export interface BillingSummary {
  last_payment_sum: number | null;
  last_charge_date: string | null;
  next_charge_date: string | null;
  currency?: string;
  payment_method: PaymentMethod | null;
}

export interface MeResponse {
  email: string;
  plan: PlanInfo | null;
  billing: BillingSummary | null;
  server_time: string;
}

@Injectable({ providedIn: 'root' })
export class EntitlementService {
  private http = inject(HttpClient);

  private me$?: Observable<MeResponse>;  // cached

  getMe(): Observable<MeResponse> {
    const token = localStorage.getItem('tokenV1');
    if (!token) return of(this.guest());

    if (!this.me$) {
      this.me$ = this.http.get<MeResponse>(
        'https://nomo-cj4l.onrender.com/api/access/me',
        { headers: { Authorization: `Bearer ${token}` } }
      ).pipe(shareReplay(1));
    }
    return this.me$;
  }

  /** Force re-fetch (e.g., after returning from payment) */
  refresh(): void { this.me$ = undefined; }

  private guest(): MeResponse {
    return {
      email: '',
      plan: { status: 'none', current_period_end: null, next_charge_date: null, plan_days: null },
      billing: {
        last_payment_sum: null,
        last_charge_date: null,
        next_charge_date: null,
        payment_method: null
      },
      server_time: new Date().toISOString(),
    };
  }
}
// Note: The above code defines an Angular service that manages user entitlements and subscription status.