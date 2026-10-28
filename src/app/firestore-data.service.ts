import { Injectable } from '@angular/core';
import { arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, runTransaction, setDoc, writeBatch, type DocumentData } from 'firebase/firestore';
import { firestore } from './firebase-client';
import { AuthService } from './auth.service';
import { inject } from '@angular/core';

export interface Holding { id: string; symbol: string; name: string; quantity: number; buyPrice: number; boughtAt: string; source?: 'paper' | 'binance'; orderId?: string; }
export interface Wallet { balanceUsdt: number; }

@Injectable({ providedIn: 'root' })
export class FirestoreDataService {
  private readonly auth = inject(AuthService);
  private readonly syncedWatchlists = new Set<string>();
  private get db() { if (!firestore) throw new Error('Firebase is not configured.'); return firestore; }
  private get uid() { const uid = this.auth.user()?.uid; if (!uid) throw new Error('Sign in to access your data.'); return uid; }
  private userCollection(name: string) { return collection(this.db, 'users', this.uid, name); }

  async getFavorites(): Promise<string[]> {
    const userId = this.uid;
    const snap = await getDocs(collection(this.db, 'users', userId, 'favorites'));
    const symbols = snap.docs.map((item) => item.id);
    if (!this.syncedWatchlists.has(userId)) {
      await setDoc(doc(this.db, 'users', userId), { watchlist: symbols }, { merge: true });
      this.syncedWatchlists.add(userId);
    }
    return symbols;
  }
  async toggleFavorite(symbol: string, favorite: boolean, coinGeckoId?: string): Promise<void> {
    const userId = this.uid;
    const favoriteRef = doc(this.db, 'users', userId, 'favorites', symbol);
    const userRef = doc(this.db, 'users', userId);
    const batch = writeBatch(this.db);
    if (favorite) batch.delete(favoriteRef);
    else batch.set(favoriteRef, { symbol, ...(coinGeckoId ? { coinGeckoId } : {}), addedAt: new Date().toISOString() });
    batch.set(userRef, { watchlist: favorite ? arrayRemove(symbol) : arrayUnion(symbol) }, { merge: true });
    await batch.commit();
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
  async sellWithPlayFunds(id: string, quantity: number, sellPrice: number): Promise<Wallet> {
    if (!(Number.isFinite(quantity) && quantity > 0) || !(Number.isFinite(sellPrice) && sellPrice > 0)) {
      throw new Error('Enter a valid sell amount and price.');
    }
    const walletRef = doc(this.db, 'users', this.uid, 'wallet', 'main');
    const holdingRef = doc(this.db, 'users', this.uid, 'portfolio', id);
    await runTransaction(this.db, async transaction => {
      const [walletSnapshot, holdingSnapshot] = await Promise.all([
        transaction.get(walletRef),
        transaction.get(holdingRef),
      ]);
      if (!holdingSnapshot.exists()) throw new Error('This portfolio entry no longer exists. Refresh and try again.');
      const holding = holdingSnapshot.data();
      const available = Number(holding['quantity']);
      if (holding['source'] === 'binance') throw new Error('Binance holdings cannot be sold with play funds.');
      if (!(Number.isFinite(available) && available > 0) || quantity > available) {
        throw new Error('The sell amount exceeds the available holding quantity. Refresh and try again.');
      }
      const proceeds = quantity * sellPrice;
      if (!Number.isFinite(proceeds) || !(proceeds > 0)) throw new Error('The sale value is invalid.');
      const balance = Number(walletSnapshot.data()?.['balanceUsdt'] ?? 0);
      transaction.set(walletRef, { balanceUsdt: balance + proceeds, updatedAt: new Date().toISOString() });
      if (quantity === available) transaction.delete(holdingRef);
      else transaction.update(holdingRef, { quantity: available - quantity });
    });
    return this.getWallet();
  }
  async removeHolding(id: string): Promise<void> {
    await deleteDoc(doc(this.db, 'users', this.uid, 'portfolio', id));
  }
}
