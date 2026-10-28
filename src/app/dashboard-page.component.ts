import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { BinanceApiService, type BinanceApiAccount, type BinanceApiStatus, type SharedBinanceOrder, type SharedBinanceOrderRequest, type WatchlistAnalysis } from './binance-api.service';
import { firebaseApp } from './firebase-client';
import { FirestoreDataService, type Holding } from './firestore-data.service';
import { MarketDataService, ema, rsi, type Candle, type Coin, type OrderBook, type TrendMetric } from './market-data.service';

@Component({
  selector: 'app-dashboard-page',
  imports: [CommonModule, FormsModule, RouterLink, CurrencyPipe],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.css',
})
export class DashboardPage {
  private readonly route = inject(ActivatedRoute);
  private readonly market = inject(MarketDataService);
  private readonly data = inject(FirestoreDataService);
  private readonly binanceApi = inject(BinanceApiService);
  readonly page = signal('overview');
  readonly coins = signal<Coin[]>([]);
  readonly favorites = signal<string[]>([]);
  readonly holdings = signal<Holding[]>([]);
  readonly candles = signal<Candle[]>([]);
  readonly orderBook = signal<OrderBook | null>(null);
  readonly trendMetrics = signal<TrendMetric[]>([]);
  readonly portfolioSignals = signal<Record<string, Record<string, {signal:'BUY'|'SELL'|'HOLD'|'UNAVAILABLE'; reason:string}>>>({});
  readonly portfolioSignalsLoading = signal(false);
  readonly watchSignals = signal<Record<string,{signal:string;reason:string;ema20:number;rsi14:number}>>({});
  readonly trendFilter = signal('all');
  readonly walletBalance = signal(0);
  readonly binanceConnected = signal(false);
  readonly binanceBalances = signal<Array<{asset:string;free:number;locked:number}>>([]);
  readonly serverBinanceStatus = signal<BinanceApiStatus | null>(null);
  readonly serverBinanceAccount = signal<BinanceApiAccount | null>(null);
  readonly serverBinanceStatusError = signal('');
  readonly serverBinanceAccountError = signal('');
  readonly serverEgressIp = signal('');
  readonly serverEgressIpError = signal('');
  readonly serverBinanceLoading = signal(false);
  readonly serverBinanceLoaded = signal(false);
  readonly error = signal('');
  readonly integrationError = signal('');
  readonly loading = signal(true);
  readonly analysisLoading = signal(false);
  readonly analysis = signal('');
  readonly analysisResult = signal<WatchlistAnalysis | null>(null);
  readonly coinSymbol = signal('BTCUSDT');
  readonly query = signal('');
  readonly interval = signal('1d');
  readonly orderBusy = signal(false);
  readonly orderReviewed = signal(false);
  readonly connectionBusy = signal(false);
  readonly connectionMessage = signal('');
  readonly sellBusy = signal(false);
  readonly sharedOrderBusy = signal(false);
  readonly sharedOrderReviewed = signal<SharedBinanceOrderRequest | null>(null);
  readonly sharedOrderError = signal('');
  readonly sharedOrderMessage = signal('');
  showHoldingForm = false;
  showSellPicker = false;
  showSellForm = false;
  sellHolding: Holding | null = null;
  sellQuantity = '';
  sellPrice = 0;
  selectedSymbol = 'BTCUSDT';
  quantity = '';
  buyPrice = '';
  boughtAt = new Date().toISOString().slice(0, 10);
  playFundsAmount = '';
  orderSpend = '25';
  binanceApiKey = '';
  binanceApiSecret = '';
  sharedOrderSide: 'BUY' | 'SELL' = 'BUY';
  sharedOrderSymbol = 'BTCUSDT';
  sharedOrderAmount = '';

  constructor() {
    this.route.data.subscribe(data => this.page.set(String(data['page'] ?? 'overview')));
    this.route.paramMap.subscribe(params => {
      const symbol = params.get('symbol');
      if (symbol) this.coinSymbol.set(symbol.toUpperCase());
      void this.refresh();
    });
  }

  async refresh(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try {
      const [coins, favorites, holdings, wallet] = await Promise.all([this.market.getTickers(), this.data.getFavorites(), this.data.getHoldings(), this.data.getWallet()]);
      this.coins.set(coins); this.favorites.set(favorites); this.holdings.set(holdings); this.walletBalance.set(wallet.balanceUsdt);
      if (this.page() === 'overview') await this.loadPortfolioSignals();
      try { const status = await this.binanceApi.getStatus(); this.binanceConnected.set(status.connected); if (status.connected) await this.refreshBinanceAccount(); }
      catch (error) { this.integrationError.set(error instanceof Error ? error.message : 'Binance link status is unavailable.'); }
      if (this.page() === 'settings') await this.refreshServerBinanceAccount();
      if (this.page() === 'coin') await this.loadCandles();
      if (this.page() === 'market-trends') {
        this.trendFilter.set('all');
        const metrics = await this.market.getTrendMetrics(coins);
        this.trendMetrics.set(metrics);
      }
      if (this.page() === 'signals' || this.page() === 'favorites') await this.loadWatchlistSignals();
    } catch (error) { this.error.set(error instanceof Error ? error.message : 'Could not load the dashboard.'); }
    finally { this.loading.set(false); }
  }
  get visibleCoins(): Coin[] {
    const q = this.query().trim().toLowerCase();
    let rows = this.page() === 'favorites' ? this.coins().filter(c => this.favorites().includes(c.symbol)) : this.coins();
    if (this.page() === 'top-10') rows = rows.slice(0, 10);
    return q ? rows.filter(c => c.base.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) : rows;
  }
  get topCoins(): Coin[] { return this.coins().slice(0, 10); }
  get purchaseCoins(): Coin[] { return this.coins(); }
  get portfolioPositions(): Array<{symbol:string;name:string;quantity:number;averageCost:number;price:number;value:number;cost:number;pnl:number;pnlPercent:number;dayPnl:number;allocation:number}> {
    const grouped = new Map<string,{name:string;quantity:number;cost:number}>();
    for (const holding of this.holdings()) {
      const row = grouped.get(holding.symbol) ?? {name:holding.name,quantity:0,cost:0};
      row.quantity += holding.quantity; row.cost += holding.quantity * holding.buyPrice; grouped.set(holding.symbol,row);
    }
    const positions = [...grouped].map(([symbol,row]) => {
      const price = this.coin(symbol)?.price ?? row.cost / row.quantity;
      const value = price * row.quantity, pnl = value - row.cost;
      const change = this.coin(symbol)?.change ?? 0;
      const priorPrice = price / (1 + change / 100);
      return {symbol,name:row.name,quantity:row.quantity,averageCost:row.cost/row.quantity,price,value,cost:row.cost,pnl,pnlPercent:row.cost ? pnl / row.cost * 100 : 0,dayPnl:(price-priorPrice)*row.quantity,allocation:0};
    }).sort((a,b)=>b.value-a.value);
    const total = positions.reduce((sum,row)=>sum+row.value,0);
    return positions.map(row=>({...row,allocation:total ? row.value/total*100 : 0}));
  }
  get allocationGradient(): string {
    const colors=['#06d6a0','#4d8dff','#f6ae2d','#a779ff','#ff6878','#29c2d1','#e67843','#90a4b8'];
    let start=0;
    const stops=this.portfolioPositions.map((row,index)=>{const end=start+row.allocation;const part=`${colors[index%colors.length]} ${start.toFixed(2)}% ${end.toFixed(2)}%`;start=end;return part;});
    return stops.length ? `conic-gradient(${stops.join(',')})` : 'conic-gradient(#24344a 0% 100%)';
  }
  allocationColor(index:number): string { return ['#06d6a0','#4d8dff','#f6ae2d','#a779ff','#ff6878','#29c2d1','#e67843','#90a4b8'][index%8]; }
  portfolioSignal(symbol:string,period:string): {signal:'BUY'|'SELL'|'HOLD'|'UNAVAILABLE';reason:string}|undefined { return this.portfolioSignals()[symbol]?.[period]; }
  get trendRows(): Array<{coin:Coin;metric:TrendMetric|null;volumeRank:number}> {
    const filter = this.trendFilter();
    const ranked = [...this.coins()].sort((a, b) => b.quoteVolume - a.quoteVolume);
    const metrics = new Map(this.trendMetrics().map(metric => [metric.coin.symbol, metric]));
    const rows = (coins: Coin[]) => coins.map(coin => ({
      coin,
      metric: metrics.get(coin.symbol) ?? null,
      volumeRank: ranked.findIndex(item => item.symbol === coin.symbol) + 1,
    }));

    if (filter.startsWith('volume-')) {
      const quarter = Math.ceil(ranked.length / 4);
      const tier = filter.slice('volume-'.length);
      const range = tier === 'top' ? [0, quarter]
        : tier === 'high' ? [quarter, quarter * 2]
        : tier === 'mid' ? [quarter * 2, quarter * 3]
        : [quarter * 3, ranked.length];
      return rows(ranked.slice(range[0], range[1]));
    }
    if (filter === 'gainers') return rows([...ranked].sort((a, b) => b.change - a.change).slice(0, 30));
    if (filter === 'losers') return rows([...ranked].sort((a, b) => a.change - b.change).slice(0, 30));
    if (filter === 'volume') return rows(this.trendMetrics().filter(row => row.volumeRatio >= 1.5).sort((a, b) => b.volumeRatio - a.volumeRatio).map(row => row.coin));
    if (filter === 'breakout') return rows(this.trendMetrics().filter(row => row.breakout).map(row => row.coin));
    if (filter.startsWith('change-')) {
      const direction = filter.slice('change-'.length);
      return rows(ranked.filter(coin => direction === 'positive' ? coin.change > 0 : coin.change < 0));
    }
    return rows(ranked.filter(coin => coin.change > 0).sort((a, b) => b.change - a.change).slice(0, 30));
  }
  get totalValue(): number { return this.holdings().reduce((sum, h) => sum + h.quantity * (this.coin(h.symbol)?.price ?? h.buyPrice), 0); }
  get costBasis(): number { return this.holdings().reduce((sum, h) => sum + h.quantity * h.buyPrice, 0); }
  get totalPnl(): number { return this.totalValue - this.costBasis; }
  get todayPnl(): number { return this.holdings().reduce((sum, h) => sum + h.quantity * ((this.coin(h.symbol)?.price ?? h.buyPrice) - h.buyPrice), 0); }
  get coinDetail(): Coin | undefined { return this.coin(this.coinSymbol()); }
  get closes(): number[] { return this.candles().map(c => c.close); }
  get ema20(): number | null { return ema(this.closes, 20).at(-1) ?? null; }
  get ema50(): number | null { return ema(this.closes, 50).at(-1) ?? null; }
  get currentRsi(): number { return rsi(this.closes); }
  get chartPath(): string {
    const values = this.closes; if (values.length < 2) return '';
    const min = Math.min(...values), max = Math.max(...values), spread = max - min || 1;
    return values.map((v, i) => `${i ? 'L' : 'M'} ${(i / (values.length - 1) * 1000).toFixed(1)} ${(220 - (v - min) / spread * 190).toFixed(1)}`).join(' ');
  }
  coin(symbol: string): Coin | undefined { return this.coins().find(c => c.symbol === symbol); }
  async toggleFavorite(symbol: string): Promise<void> {
    const remove = this.favorites().includes(symbol);
    try { await this.data.toggleFavorite(symbol, remove); this.favorites.update(items => remove ? items.filter(item => item !== symbol) : [...items, symbol]); }
    catch (e) { this.error.set(e instanceof Error ? e.message : 'Could not update favorites.'); }
  }
  selectTrend(filter: string): void { this.trendFilter.set(filter); }
  openHolding(coin?: Coin): void { const available=this.purchaseCoins;const selected=coin??available[0]; this.selectedSymbol = selected?.symbol ?? 'BTCUSDT'; this.buyPrice = selected?.price.toString() ?? ''; this.quantity = ''; this.boughtAt = new Date().toISOString().slice(0, 10); this.orderReviewed.set(false); this.orderBook.set(null); this.showHoldingForm = true; void this.updateSelectedPrice(this.selectedSymbol); }
  async updateSelectedPrice(symbol: string): Promise<void> { this.buyPrice = this.coin(symbol)?.price.toString() ?? ''; this.orderReviewed.set(false); try { this.orderBook.set(await this.market.getOrderBook(symbol)); } catch (e) { this.error.set(e instanceof Error ? e.message : 'Order book is unavailable.'); } }
  async saveHolding(): Promise<void> {
    const coin = this.coin(this.selectedSymbol); const quantity = Number(this.quantity), price = Number(this.buyPrice);
    if (!coin || !(quantity > 0) || !(price > 0)) return;
    try { const wallet = await this.data.buyWithPlayFunds({ symbol: coin.symbol, name: coin.name, quantity, buyPrice: price, boughtAt: this.boughtAt }); this.walletBalance.set(wallet.balanceUsdt); this.holdings.set(await this.data.getHoldings()); this.showHoldingForm = false; }
    catch (e) { this.error.set(e instanceof Error ? e.message : 'Could not save the portfolio entry.'); }
  }
  openSell(holding: Holding): void {
    const price = this.coin(holding.symbol)?.price;
    if (!(price && Number.isFinite(price) && price > 0)) {
      this.error.set('A current market price is not available for this asset. Refresh and try again.');
      return;
    }
    this.error.set('');
    this.sellHolding = holding;
    this.sellQuantity = String(holding.quantity);
    this.sellPrice = price;
    this.showSellForm = true;
  }
  get sellableHoldings(): Holding[] { return this.holdings().filter(holding => holding.source !== 'binance'); }
  openSellPicker(): void {
    if (!this.sellableHoldings.length) {
      this.error.set('Buy with play funds first to add a holding you can sell.');
      return;
    }
    this.error.set('');
    this.showSellPicker = true;
  }
  chooseHoldingToSell(holding: Holding): void {
    this.showSellPicker = false;
    this.openSell(holding);
  }
  get estimatedSellProceeds(): number { return Number(this.sellQuantity) * this.sellPrice; }
  get sellQuantityValid(): boolean {
    const quantity = Number(this.sellQuantity);
    return Number.isFinite(quantity) && quantity > 0 && !!this.sellHolding && quantity <= this.sellHolding.quantity;
  }
  get estimatedRealizedPnl(): number {
    return this.sellHolding ? (this.sellPrice - this.sellHolding.buyPrice) * Number(this.sellQuantity) : 0;
  }
  async sellHoldingWithPlayFunds(): Promise<void> {
    if (!this.sellHolding) return;
    const quantity = Number(this.sellQuantity);
    if (!(Number.isFinite(quantity) && quantity > 0 && quantity <= this.sellHolding.quantity)) {
      this.error.set('Enter a sell amount greater than 0 and no more than your available quantity.');
      return;
    }
    this.sellBusy.set(true);
    this.error.set('');
    try {
      const wallet = await this.data.sellWithPlayFunds(this.sellHolding.id, quantity, this.sellPrice);
      this.walletBalance.set(wallet.balanceUsdt);
      this.holdings.set(await this.data.getHoldings());
      this.showSellForm = false;
      this.sellHolding = null;
      this.sellQuantity = '';
    } catch (e) { this.error.set(e instanceof Error ? e.message : 'Could not sell this holding.'); }
    finally { this.sellBusy.set(false); }
  }
  async addPlayFunds(): Promise<void> { try { const wallet = await this.data.addPlayFunds(Number(this.playFundsAmount)); this.walletBalance.set(wallet.balanceUsdt); this.playFundsAmount = ''; } catch (e) { this.error.set(e instanceof Error ? e.message : 'Could not add simulated funds.'); } }
  get estimatedQuantity(): number { const ask = this.orderBook()?.asks[0]?.price ?? this.coin(this.selectedSymbol)?.price ?? 0; return ask > 0 ? Number(this.orderSpend) / ask : 0; }
  get paperSpend(): number { return Number(this.quantity) * Number(this.buyPrice); }
  get binanceUsdt(): number { const row = this.binanceBalances().find(item => item.asset === 'USDT'); return row ? row.free : 0; }
  async refreshServerBinanceAccount(): Promise<void> {
    this.serverBinanceLoading.set(true);
    this.serverBinanceStatusError.set('');
    this.serverBinanceAccountError.set('');
    this.serverBinanceStatus.set(null);
    this.serverBinanceAccount.set(null);
    this.serverEgressIp.set('');
    this.serverEgressIpError.set('');
    this.serverBinanceLoaded.set(false);
    const [status, account, ip] = await Promise.allSettled([
      this.binanceApi.getHttpStatus(),
      this.binanceApi.getAccount(),
      this.binanceApi.getEgressIp(),
    ]);
    if (status.status === 'fulfilled') this.serverBinanceStatus.set(status.value);
    else this.serverBinanceStatusError.set(status.reason instanceof Error ? status.reason.message : 'Could not load the Binance integration status.');
    if (account.status === 'fulfilled') {
      this.serverBinanceAccount.set(account.value);
      this.serverBinanceLoaded.set(true);
    } else this.serverBinanceAccountError.set(account.reason instanceof Error ? account.reason.message : 'Could not load Binance account data.');
    if (ip.status === 'fulfilled') this.serverEgressIp.set(ip.value.ip);
    else this.serverEgressIpError.set(ip.reason instanceof Error ? ip.reason.message : 'Could not read the Functions egress IP.');
    this.serverBinanceLoading.set(false);
  }
  reviewSharedOrder(): void {
    this.sharedOrderError.set('');
    this.sharedOrderMessage.set('');
    const account = this.serverBinanceAccount();
    if (!account?.connected) {
      this.sharedOrderError.set('Load the shared Binance account successfully before reviewing a live order.');
      return;
    }
    const amount = this.sharedOrderAmount.trim();
    if (!/^[0-9]+(?:\.[0-9]+)?$/.test(amount) || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      this.sharedOrderError.set('Enter a positive amount using decimal digits only.');
      return;
    }
    if (!/^[A-Z0-9]{2,18}USDT$/.test(this.sharedOrderSymbol) || /(UP|DOWN|BULL|BEAR)USDT$/.test(this.sharedOrderSymbol)) {
      this.sharedOrderError.set('Choose a supported USDT-quoted Spot pair.');
      return;
    }
    const balanceAsset = this.sharedOrderSide === 'BUY' ? 'USDT' : this.sharedOrderSymbol.slice(0, -4);
    const available = account.balances.find(balance => balance.asset === balanceAsset)?.free ?? 0;
    if (Number(amount) > available) {
      this.sharedOrderError.set(`The shared account has only ${available} free ${balanceAsset}. Refresh balances or lower the amount.`);
      return;
    }
    this.sharedOrderReviewed.set({
      symbol: this.sharedOrderSymbol,
      side: this.sharedOrderSide,
      ...(this.sharedOrderSide === 'BUY' ? { quoteOrderQty: amount } : { quantity: amount }),
      clientOrderId: crypto.randomUUID(),
      confirm: true,
    });
  }
  cancelSharedOrderReview(): void {
    this.sharedOrderReviewed.set(null);
    this.sharedOrderError.set('');
  }
  async submitSharedOrder(): Promise<void> {
    const reviewed = this.sharedOrderReviewed();
    if (!reviewed) return;
    this.sharedOrderBusy.set(true);
    this.sharedOrderError.set('');
    try {
      const result = await this.binanceApi.placeSharedOrder(reviewed);
      this.sharedOrderReviewed.set(null);
      this.sharedOrderAmount = '';
      this.sharedOrderMessage.set(this.sharedOrderSuccessMessage(result));
      await this.refreshServerBinanceAccount();
    } catch (error) {
      this.sharedOrderError.set(`${error instanceof Error ? error.message : 'Shared account order failed.'} Keep this order ID for retries; do not create a new order after an uncertain result.`);
    } finally { this.sharedOrderBusy.set(false); }
  }
  private sharedOrderSuccessMessage(result: SharedBinanceOrder): string {
    return `${result.replayed ? 'Previously completed order confirmed' : 'Order accepted'}: ${result.side} ${result.symbol}, status ${result.status}, filled ${result.executedQty} for ${result.cummulativeQuoteQty} USDT.`;
  }
  async refreshBinanceAccount(): Promise<void> { const result = await this.call<{}, {connected:boolean;balances:Array<{asset:string;free:number;locked:number}>}>('getBinanceAccount', {}); this.binanceConnected.set(result.connected); this.binanceBalances.set(result.balances ?? []); }
  async connectBinance(): Promise<void> {
    this.connectionBusy.set(true); this.connectionMessage.set(''); this.integrationError.set('');
    try { await this.call<{apiKey:string;apiSecret:string},{connected:boolean}>('connectBinance', {apiKey:this.binanceApiKey.trim(),apiSecret:this.binanceApiSecret.trim()}); this.binanceApiKey=''; this.binanceApiSecret=''; this.binanceConnected.set(true); await this.refreshBinanceAccount(); this.connectionMessage.set('Binance is connected. Check balances and API permissions before trading.'); }
    catch (e) { this.integrationError.set(e instanceof Error ? e.message : 'Could not connect Binance.'); }
    finally { this.connectionBusy.set(false); }
  }
  async disconnectBinance(): Promise<void> { this.connectionBusy.set(true); try { await this.call<{}, {connected:boolean}>('disconnectBinance', {}); this.binanceConnected.set(false); this.binanceBalances.set([]); this.connectionMessage.set('Binance was disconnected.'); } catch (e) { this.integrationError.set(e instanceof Error ? e.message : 'Could not disconnect Binance.'); } finally { this.connectionBusy.set(false); } }
  reviewRealBuy(): void { const spend=Number(this.orderSpend); if (!(spend>0&&spend<=1000)) { this.error.set('Enter a buy amount from 0.01 to 1,000 USDT.'); return; } if (spend*1.01>this.binanceUsdt) { this.error.set('Your available Binance USDT does not cover this buy and the fee reserve.'); return; } if (!this.orderBook()?.asks[0]) { this.error.set('Load a current ask quote before reviewing the buy.'); return; } this.error.set(''); this.orderReviewed.set(true); }
  async submitRealBuy(): Promise<void> { this.orderBusy.set(true); this.error.set(''); try { const result=await this.call<{symbol:string;quoteOrderQty:number;expectedAsk:number;confirmRealOrder:boolean},{symbol:string;quantity:number;buyPrice:number;quoteSpent:number;orderId:number|string;status:string}>('buyBinanceMarket',{symbol:this.selectedSymbol,quoteOrderQty:Number(this.orderSpend),expectedAsk:this.orderBook()?.asks[0]?.price ?? 0,confirmRealOrder:true}); this.orderReviewed.set(false); this.showHoldingForm=false; await Promise.all([this.refresh(),this.refreshBinanceAccount()]); this.connectionMessage.set(`Binance buy filled: ${result.quantity} ${result.symbol.replace('USDT','')} at ${this.format(result.buyPrice)} USDT.`); } catch(e) { this.error.set(e instanceof Error ? e.message : 'Binance order failed. Check your Binance order history before retrying.'); } finally { this.orderBusy.set(false); } }
  async loadCandles(): Promise<void> { try { this.candles.set(await this.market.getCandles(this.coinSymbol(), this.interval())); } catch (e) { this.error.set(e instanceof Error ? e.message : 'Could not load price history.'); } }
  async loadWatchlistSignals(): Promise<void> {
    const next:Record<string,{signal:string;reason:string;ema20:number;rsi14:number}>={};
    await Promise.all(this.favorites().slice(0,20).map(async symbol=>{
      try { const history=await this.market.getCandles(symbol,'1d',60); const closes=history.map(item=>item.close); const fast=ema(closes,20).at(-1)??0,slow=ema(closes,50).at(-1)??0,momentum=rsi(closes),price=this.coin(symbol)?.price??closes.at(-1)??0;
        const signal=momentum>=70?'OVERBOUGHT':price>fast&&fast>slow&&momentum<65?'BULLISH SETUP':price<fast&&fast<slow?'BEARISH TREND':'NEUTRAL';
        const reason=signal==='OVERBOUGHT'?'RSI is elevated; momentum may be extended.':signal==='BULLISH SETUP'?'Price and moving averages show positive trend alignment.':signal==='BEARISH TREND'?'Price is below the short and long moving averages.':'Trend indicators do not agree strongly.';
        next[symbol]={signal,reason,ema20:fast,rsi14:momentum};
      } catch { next[symbol]={signal:'UNAVAILABLE',reason:'Candle history could not be loaded.',ema20:0,rsi14:0}; }
    }));
    this.watchSignals.set(next);
  }
  async loadPortfolioSignals(): Promise<void> {
    const symbols=[...new Set(this.holdings().map(row=>row.symbol))];
    this.portfolioSignalsLoading.set(true);
    const result:Record<string,Record<string,{signal:'BUY'|'SELL'|'HOLD'|'UNAVAILABLE';reason:string}>>={};
    const frames=[{key:'day',interval:'15m',limit:96},{key:'week',interval:'1h',limit:168},{key:'month',interval:'4h',limit:180},{key:'year',interval:'1d',limit:365}];
    await Promise.all(symbols.map(async symbol=>{
      result[symbol]={};
      await Promise.all(frames.map(async frame=>{
        try {
          const history=await this.market.getCandles(symbol,frame.interval,frame.limit), closes=history.map(row=>row.close);
          if(closes.length<50){result[symbol][frame.key]={signal:'UNAVAILABLE',reason:'Not enough candle history'};return;}
          const fast=ema(closes,20).at(-1)!,slow=ema(closes,50).at(-1)!,momentum=rsi(closes),price=this.coin(symbol)?.price??closes.at(-1)!;
          const signal: 'BUY'|'SELL'|'HOLD' = price>fast&&fast>slow&&momentum<70 ? 'BUY' : (price<fast&&fast<slow)||momentum>=75 ? 'SELL' : 'HOLD';
          const reason=signal==='BUY'?'Price and EMA trend align; RSI is below 70.':signal==='SELL'?'Downtrend alignment or elevated RSI.':'Trend conditions are mixed.';
          result[symbol][frame.key]={signal,reason};
        } catch { result[symbol][frame.key]={signal:'UNAVAILABLE',reason:'Candle data unavailable'}; }
      }));
    }));
    this.portfolioSignals.set(result); this.portfolioSignalsLoading.set(false);
  }
  async analyze(): Promise<void> {
    this.analysisLoading.set(true); this.analysis.set(''); this.analysisResult.set(null); this.error.set('');
    try {
      if (this.favorites().length > 20) {
        throw new Error('The analysis service supports up to 20 assets. Reduce your favorites and try again.');
      }
      const result = await this.binanceApi.analyzeWatchlist(this.favorites());
      this.analysisResult.set(result);
      this.analysis.set(result.overview);
    } catch (e) { this.error.set(e instanceof Error ? e.message : 'Analysis request failed.'); }
    finally { this.analysisLoading.set(false); }
  }
  format(value: number): string { return new Intl.NumberFormat('en-US', { maximumFractionDigits: value < 1 ? 6 : 2 }).format(value); }
  changeClass(value: number): string { return value >= 0 ? 'positive' : 'negative'; }
  magnitude(value: number): number { return Math.min(100, Math.abs(value) * 9); }
  private call<I,O>(name:string,data:I):Promise<O> { if(!firebaseApp) return Promise.reject(new Error('Firebase is not configured.')); return httpsCallable<I,O>(getFunctions(firebaseApp, 'asia-east1'),name)(data).then(result=>result.data); }
}
