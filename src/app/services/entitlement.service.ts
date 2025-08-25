import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs'; // make sure this is imported

@Injectable({ providedIn: 'root' })
export class EntitlementService {
    
  constructor(private http: HttpClient) {}

getMine() {
  const token = localStorage.getItem('tokenV1');

  if (!token) {
    console.warn('⛔️ No token found, skipping /api/access/me request');
    return of({ active: false, until: null }); // Возвращаем "пустой" Observable
  }

  return this.http.get<{ active: boolean; until: string | null }>(
    'https://nomo-backend.onrender.com/api/access/me',
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
}

}