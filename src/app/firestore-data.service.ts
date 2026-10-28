import { Injectable } from '@angular/core';
import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, runTransaction, setDoc, type DocumentData } from 'firebase/firestore';
import { firestore } from './firebase-client';
import { AuthService } from './auth.service';
import { inject } from '@angular/core';

export interface Holding { id: string; symbol: string; name: string; quantity: number; buyPrice: number; boughtAt: string; source?: 'paper' | 'binance'; orderId?: string; }
export interface Wallet { balanceUsdt: number; }

@Injectable({ providedIn: 'root' })
export class FirestoreDataService {
  private readonly auth = inject(AuthService);
  private get db() { if (!firestore) throw new Error('Firebase is not configured.'); return firestore; }
  private get uid() { const uid = this.auth.user()?.uid; if (!uid) throw new Error('Sign in to access your data.'); return uid; }
  private userCollection(name: string) { return collection(this.db, 'users', this.uid, name); }

  async getFavorites(): Promise<string[]> {
    const snap = await getDocs(this.userCollection('favorites'));
    return snap.docs.map((item) => item.id);
  }
  async toggleFavorite(symbol: string, favorite: boolean): Promise<void> {
    const ref = doc(this.db, 'users', this.uid, 'favorites', symbol);
    if (favorite) await deleteDoc(ref); else await setDoc(ref, { symbol, addedAt: new Date().toISOString() });
  }
  async getHoldings(): Promise<Holding[]> {
    const snap = await getDocs(query(this.userCollection('portfolio'), orderBy('boughtAt', 'desc')));
    return snap.docs.map((item) => ({ id: item.id, ...item.data() } as Holding));
  }
  async getWallet(): Promise<Wallet> {
    const reference = doc(this.db, 'users', this.uid, 'wallet', 'main');
    const snapshot = await getDoc(reference);
    if (!snapshot.exists()) { await setDoc(reference, { balanceUsdt: 0, updatedAt: new Date().toISOString() }); return { balanceUsdt: 0 }; }
    return { balanceUsdt: Number(snapshot.data()['balanceUsdt'] ?? 0) };
  }
  async addPlayFunds(amount: number): Promise<Wallet> {
    if (!(amount > 0) || amount > 1_000_000) throw new Error('Enter simulated funds between 0 and 1,000,000 USDT.');
    const walletRef = doc(this.db, 'users', this.uid, 'wallet', 'main');
    await runTransaction(this.db, async transaction => {
      const snapshot = await transaction.get(walletRef);
      const current = Number(snapshot.data()?.['balanceUsdt'] ?? 0);
      transaction.set(walletRef, { balanceUsdt: current + amount, updatedAt: new Date().toISOString() });
    });
    return this.getWallet();
  }
  async buyWithPlayFunds(input: Omit<Holding, 'id'>): Promise<Wallet> {
    const spend = input.quantity * input.buyPrice;
    const walletRef = doc(this.db, 'users', this.uid, 'wallet', 'main');
    const holdingRef = doc(this.db, 'users', this.uid, 'portfolio', `${input.symbol}_${Date.now()}`);
    await runTransaction(this.db, async transaction => {
      const snapshot = await transaction.get(walletRef);
      const balance = Number(snapshot.data()?.['balanceUsdt'] ?? 0);
      if (spend > balance) throw new Error('Not enough play-money USDT in your wallet. Add simulated funds first.');
      transaction.set(walletRef, { balanceUsdt: balance - spend, updatedAt: new Date().toISOString() });
      transaction.set(holdingRef, { ...input, source: 'paper' });
    });
    return this.getWallet();
  }
  async removeHolding(id: string): Promise<void> {
    await deleteDoc(doc(this.db, 'users', this.uid, 'portfolio', id));
  }
}
