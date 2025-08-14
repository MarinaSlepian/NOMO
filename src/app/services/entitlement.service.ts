import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class EntitlementService {
    
  constructor(private http: HttpClient) {}

  getMine() {
    return this.http.get<{active: boolean; until: string | null}>('/api/access/me');
  }
}