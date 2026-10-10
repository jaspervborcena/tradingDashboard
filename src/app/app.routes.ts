import { Routes } from '@angular/router';

export const routes: Routes = [
	{
		path: 'overview',
		loadComponent: () => import('./overview-page.component').then((module) => module.OverviewPage),
		title: 'Overview',
	},
	{
		path: 'markets',
		loadComponent: () => import('./events-page.component').then((module) => module.EventsPage),
		data: { kind: 'markets' },
		title: 'Markets',
	},
	{
		path: 'signals',
		loadComponent: () => import('./events-page.component').then((module) => module.EventsPage),
		data: { kind: 'signals' },
		title: 'Signals',
	},
	{
		path: 'system',
		loadComponent: () => import('./system-page.component').then((module) => module.SystemPage),
		title: 'System',
	},
	{
		path: 'trades',
		loadComponent: () => import('./trades-page.component').then((module) => module.TradesPage),
		title: 'Trades',
	},
	{ path: '', pathMatch: 'full', redirectTo: 'overview' },
	{ path: '**', redirectTo: 'overview' },
];
