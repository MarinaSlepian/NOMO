import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { TranslateService } from '@ngx-translate/core';
import { PayService } from '../services/pay.service';

@Component({
  selector: 'app-pay-dialog',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './pay-dialog.component.html',
  styleUrls: ['./pay-dialog.component.css']
})
export class PayDialogComponent {

  /** Controls visibility from parent */
  @Input() open = false;

  /** One price for all modules (major units, e.g., ₪) */
  @Input() priceILS = 1;//marina temp, was 39

  /** Cardcom currency code, 1 = ILS */
  @Input() currency = 1;

  /** Shown in Cardcom & saved on your side */
  @Input() description = 'NOMO access';

  /** Optional if you have auth */
  @Input() userId?: number;

  /** Notifies parent that the dialog has closed (cancel or after redirect) */
  @Output() closed = new EventEmitter<void>();

  isPaying = false;
  payError = '';

  constructor(
    private pay: PayService,
    public translate: TranslateService // 👈 add this
    ) {}

  private makeOrderId(): string {
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `ORD-${Date.now()}-${rand}`;
  }

  cancel(): void {
    if (this.isPaying) return;
    this.open = false;
    this.closed.emit();
  }

  confirm(): void {
    if (this.isPaying) return;
    this.isPaying = true;
    this.payError = '';

    const orderId = this.makeOrderId();

    this.pay.startPayment({
      amount: this.priceILS,
      orderId,
      description: this.description,
      currency: this.currency,
      userId: this.userId
    }).subscribe({
      next: ({ url, lowProfileId }) => {
        sessionStorage.setItem('lastLowProfileId', String(lowProfileId));
        sessionStorage.setItem('lastOrderId', orderId);
        // We can emit closed before redirect to let parent clean up UI
        this.closed.emit();
        window.location.href = url; // redirect to Cardcom hosted page
      },
      error: err => {
        this.payError = err?.error?.error || 'Payment init failed';
        this.isPaying = false; // allow retry
      }
    });
  }
}
