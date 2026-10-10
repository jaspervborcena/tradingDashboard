import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './auth.service';
import { firebaseConfigured } from './firebase-client';

@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  readonly auth = inject(AuthService);
  readonly firebaseConfigured = firebaseConfigured;
  readonly pageTitle = signal('Overview');
  readonly authMode = signal<'login' | 'create'>('login');

  email = '';
  password = '';
  confirmPassword = '';
  loginError = '';
  signingIn = false;

  constructor() {
    inject(Router).events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
      const path = (event as NavigationEnd).urlAfterRedirects.split('/').filter(Boolean)[0] ?? 'overview';
      this.pageTitle.set(path.charAt(0).toUpperCase() + path.slice(1));
    });
  }

  setAuthMode(mode: 'login' | 'create'): void {
    this.authMode.set(mode);
    this.loginError = '';
    this.password = '';
    this.confirmPassword = '';
  }

  async submitAuth(): Promise<void> {
    this.signingIn = true;
    this.loginError = '';
    try {
      if (this.authMode() === 'create') {
        if (this.password.length < 8) {
          this.loginError = 'Use a password with at least 8 characters.';
          return;
        }
        if (this.password !== this.confirmPassword) {
          this.loginError = 'The passwords do not match.';
          return;
        }
        await this.auth.createAccount(this.email.trim(), this.password);
      } else {
        await this.auth.signIn(this.email.trim(), this.password);
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      this.loginError = authErrorMessage(code, this.authMode());
    } finally {
      this.signingIn = false;
    }
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
  }
}

function authErrorMessage(code: string | undefined, mode: 'login' | 'create'): string {
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'That email and password combination was not recognized.';
  }
  if (code === 'auth/email-already-in-use') return 'An account already exists for this email. Sign in instead.';
  if (code === 'auth/weak-password') return 'Firebase rejected this password. Choose a stronger password and try again.';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (code === 'auth/operation-not-allowed') return 'Email/Password sign-in is disabled. Enable it in Firebase Authentication.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a moment and try again.';
  return mode === 'create'
    ? 'Account creation failed. Check Firebase Authentication settings and try again.'
    : 'Sign-in failed. Check the Firebase Authentication setup and try again.';
}
