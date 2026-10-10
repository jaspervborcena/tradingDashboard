import { Injectable, signal } from '@angular/core';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { firebaseAuth } from './firebase-client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<User | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    if (!firebaseAuth) {
      this.loading.set(false);
      return;
    }

    onAuthStateChanged(firebaseAuth, (user) => {
      this.user.set(user);
      this.loading.set(false);
    });
  }

  async signIn(email: string, password: string): Promise<void> {
    if (!firebaseAuth) {
      throw new Error('Firebase is not configured. Add the web app settings first.');
    }
    this.error.set(null);
    await signInWithEmailAndPassword(firebaseAuth, email, password);
  }

  async createAccount(email: string, password: string): Promise<void> {
    if (!firebaseAuth) {
      throw new Error('Firebase is not configured. Add the web app settings first.');
    }
    this.error.set(null);
    await createUserWithEmailAndPassword(firebaseAuth, email, password);
  }

  async signOut(): Promise<void> {
    if (firebaseAuth) {
      await signOut(firebaseAuth);
    }
  }
}