import { Routes } from '@angular/router';

const dashboard = (page: string) => ({
  loadComponent: () => import('./dashboard-page.component').then(module => module.DashboardPage),
  data: { page },
});

export const routes: Routes = [
  { path: 'overview', ...dashboard('overview'), title: 'Home' },
  { path: 'top-10', ...dashboard('top-10'), title: 'Top 10' },
  { path: 'market-trends', ...dashboard('market-trends'), title: 'Market Trends' },
  { path: 'favorites', ...dashboard('favorites'), title: 'Favorites' },
  { path: 'portfolio', ...dashboard('portfolio'), title: 'Portfolio' },
  { path: 'signals', ...dashboard('signals'), title: 'Trading Signals' },
  { path: 'analytics', ...dashboard('analytics'), title: 'Analytics' },
  { path: 'settings', ...dashboard('settings'), title: 'Settings' },
  { path: 'coin/:symbol', ...dashboard('coin'), title: 'Coin Details' },
  { path: '', pathMatch: 'full', redirectTo: 'overview' },
  { path: '**', redirectTo: 'overview' },
];
