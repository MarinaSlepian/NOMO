import { Routes } from '@angular/router';
import { PaySuccessComponent } from './pay-success/pay-success.component';
import { PayFailedComponent } from './pay-failed/pay-failed.component'; // optional

export const routes: Routes = [
  { path: 'pay/success', component: PaySuccessComponent },
  { path: 'pay/failed',  component: PayFailedComponent },   // optional
  { path: '', pathMatch: 'full', redirectTo: 'pay/success' }, // <— no home: redirect somewhere that exists
  { path: '**', redirectTo: '' },
];