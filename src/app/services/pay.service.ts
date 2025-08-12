// src/app/services/pay.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface StartPaymentRequest {
  amount: number;               // major units (₪)
  orderId: string;              // your internal id
  description?: string;
  currency?: number;            // 1=ILS
  userId?: number;              // optional
}
export interface StartPaymentResponse {
  url: string;                  // Cardcom hosted payment URL
  lowProfileId: string;         // save this for status checks
}

@Injectable({ providedIn: 'root' })
export class PayService {
  private api = '/api/pay'; // via proxy, or set full backend URL in prod

  constructor(private http: HttpClient) {}

  startPayment(body: StartPaymentRequest) {
    return this.http.post<StartPaymentResponse>(`${this.api}/start`, body);
  }

  // Optional: verify by lowProfileId (manual check / polling)
  getStatus(lowProfileId: string) {
    return this.http.get<any>(`${this.api}/status/${encodeURIComponent(lowProfileId)}`);
  }
}
