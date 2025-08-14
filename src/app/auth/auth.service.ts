import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, map } from 'rxjs';
import { jwtDecode } from 'jwt-decode'; 

@Injectable({ providedIn: 'root' })
export class AuthService {
  private token: string | null = null;
  isLoggedIn$ = new BehaviorSubject<boolean>(false);

  // ✅ Your actual Render backend URL
  private apiUrl = 'https://nomo-cj4l.onrender.com';

  constructor(private http: HttpClient) {}

  login(email: string, password: string) {
    return this.http.post<{ token: string }>(`${this.apiUrl}/login`, { email, password }).pipe(
      map(res => {
        this.setToken(res.token);
        return res; // return the token to the subscriber
      })
    );
  }

  signup(username: string, email: string, password: string) {
    return this.http.post<{ token: string }>(`${this.apiUrl}/signup`, {
      username,
      email,
      password
    }).pipe(
      map(res => {
        this.setToken(res.token);
        return res; // return the token or user info to the subscriber
      })
    );
  }
  
  logout() {
    this.token = null;
    localStorage.removeItem('token');
    this.isLoggedIn$.next(false);
  }

  autoLogin() {
    console.log("autoLogin");
    const storedToken = localStorage.getItem('token');
    const storedEmail = localStorage.getItem('email');
    if (storedToken) {
      this.token = storedToken;
      this.isLoggedIn$.next(true);

      // Optional: Log or use the email
      console.log("autoLogged in as:", storedEmail);
    }
  }

  getEmail(): string | null {
    return localStorage.getItem('email');
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

  getLoggedInEmail(): string | undefined {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const decoded = jwtDecode<{ email: string }>(token);
        console.log("Logged-in email:", decoded.email);
        return decoded.email;
      } catch (e) {
        console.warn("❌ Failed to decode token:", e);
      }
    }
    return undefined;
  }
}
