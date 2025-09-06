import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-pay-success',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './pay-success.component.html',
  styleUrls: ['./pay-success.component.css'],
})
export class PaySuccessComponent implements OnInit, OnDestroy {
  state: 'checking'|'ok'|'failed'|'timeout' = 'checking';
  message = 'Confirming your payment...';
  private ctrl = new AbortController();

  async ngOnInit() {
    const lp = sessionStorage.getItem('pay.lowProfileId')
      || sessionStorage.getItem('lastLowProfileId') || '';
    if (!lp) { this.state = 'failed'; this.message = 'Missing LowProfileId'; return; }

    try {
      // simple polling (you can swap in the robust helper we discussed)
      let delay = 1500;
      for (let i = 0; i < 40; i++) {
        const r1 = await fetch(`/api/pay/status/${encodeURIComponent(lp)}`, { credentials: 'include', signal: this.ctrl.signal }).catch(()=>null);
        if (r1?.ok) {
          const data = await r1.json();
          if (Number(data?.ResponseCode) === 0 || ['paid','subscribed'].includes((data?.status||'').toLowerCase())) {
            this.markOk(); return;
          }
        }
        const r2 = await fetch('/api/me', { credentials: 'include', signal: this.ctrl.signal }).catch(()=>null);
        if (r2?.ok) {
          const me = await r2.json();
          const until = me?.access_until || me?.until || me?.until_ts;
          if (until && new Date(until).getTime() > Date.now()) { this.markOk(); return; }
        }
        await new Promise(res => setTimeout(res, delay));
        delay = Math.min(Math.round(delay * 1.3), 5000);
      }
      this.state = 'timeout';
      this.message = 'We could not confirm payment yet. Please refresh or try again.';
    } catch (e:any) {
      if (e?.name === 'AbortError') return;
      this.state = 'timeout';
      this.message = 'We could not confirm payment yet. Please refresh or try again.';
    }
  }

  private markOk() {
    this.state = 'ok';
    this.message = 'Payment confirmed. Access unlocked.';
    sessionStorage.removeItem('pay.lowProfileId');
    sessionStorage.removeItem('lastLowProfileId');
    sessionStorage.removeItem('pay.orderId');
    sessionStorage.removeItem('lastOrderId');
  }

  /** Call this from the template instead of `location?.reload()` */
  reload(): void {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  ngOnDestroy() { this.ctrl.abort(); }
}
