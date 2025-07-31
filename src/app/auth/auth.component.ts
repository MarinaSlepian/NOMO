import { Component, EventEmitter, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from './auth.service'; // adjust path if needed


@Component({
  standalone: true,
  selector: 'app-auth',
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.css'],
  imports: [ReactiveFormsModule], // ✅ This enables formGroup & formControlName
})
export class AuthComponent {
  @Output() close = new EventEmitter<void>();
  authForm: FormGroup;
  isLoginMode = true;
  showPassword = false;

  constructor(private fb: FormBuilder,private authService: AuthService) {
    this.authForm = this.fb.group({
      uname: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
    });
  }
  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }
  switchMode() {
    this.isLoginMode = !this.isLoginMode;
  }

  submit() {
    if (this.authForm.invalid) return;

    const { email, password } = this.authForm.value;
    console.log(this.isLoginMode ? 'Login' : 'Signup', email, password);
    const auth$ = this.isLoginMode
      ? this.authService.login(email, password)
      : this.authService.signup(email, password);

    auth$.subscribe({
      next: () => {
        console.log('✅ Auth successful');
        this.close.emit(); // close the dialog
      },
      error: err => {
        console.error('❌ Auth error:', err);
        alert('Authentication failed');
      }
    });
  }
}
