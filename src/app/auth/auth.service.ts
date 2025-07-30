import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private token: string | null = null;
  isLoggedIn$ = new BehaviorSubject<boolean>(false);

  // ✅ Your actual Render backend URL
  private apiUrl = 'https://nomo-api.onrender.com';

  constructor(private http: HttpClient) {}

  login(email: string, password: string) {
    return this.http.post<{ token: string }>(`${this.apiUrl}/login`, { email, password }).pipe(
      tap(res => this.setToken(res.token))
    );
  }

  signup(email: string, password: string) {
    return this.http.post<{ token: string }>(`${this.apiUrl}/signup`, { email, password }).pipe(
      tap(res => this.setToken(res.token))
    );
  }

  logout() {
    this.token = null;
    localStorage.removeItem('token');
    this.isLoggedIn$.next(false);
  }

  autoLogin() {
    const stored = localStorage.getItem('token');
    if (stored) {
      this.token = stored;
      this.isLoggedIn$.next(true);
    }
  }

  private setToken(token: string) {
    this.token = token;
    localStorage.setItem('token', token);
    this.isLoggedIn$.next(true);
  }

  getToken() {
    return this.token;
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('token');
  }
}
