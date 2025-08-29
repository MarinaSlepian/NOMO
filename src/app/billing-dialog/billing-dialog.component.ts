import { TitleCasePipe, NgIf, DatePipe } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, ViewChild, ElementRef} from '@angular/core';

type PlanId = 'monthly' | 'quarterly' | 'annual' | 'free';
interface Plan {
  id: PlanId;
  name: string;
  priceNisPerMonth: number;   // free = 0
  accent: 'red' | 'green' | 'blue' | 'gray';
  billingLabel: string;       // "per month", etc.
}
interface PaymentMethod {
  brand: 'visa' | 'mastercard' | 'amex' | 'unknown';
  last4: string;
  exp: string; // "07/28"
}
interface Invoice {
  id: string;
  date: string;     // ISO
  amountNis: number;
  status: 'paid' | 'refunded' | 'open' | 'void';
  url?: string;
}
interface SubscriptionSummary {
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'paused';
  nextChargeDate?: string; // ISO
  createdAt?: string;      // ISO
  plan: Plan;
  paymentMethod?: PaymentMethod;
  invoices?: Invoice[];
}

@Component({
  selector: 'app-billing-dialog',
  templateUrl: './billing-dialog.component.html',
  styleUrls: ['./billing-dialog.component.css'],
  standalone: true,
  imports: [TitleCasePipe, NgIf, DatePipe]
})
export class BillingDialogComponent {
  @Input() open = false;
  @Output() closed = new EventEmitter<void>();
  @Output() changePlan = new EventEmitter<void>();           // open your pricing dialog
  @Output() updateCard = new EventEmitter<void>();           // open Cardcom update flow
  @Output() cancelSubscription = new EventEmitter<void>();   // show confirm + call backend
  @Output() downgradeToFree = new EventEmitter<void>();      // optional
  @Output() downloadInvoice = new EventEmitter<string>();    // invoice.id

  subscription?: SubscriptionSummary;

    // Fallback demo data so the dialog renders before data arrives:
  demo = signal<SubscriptionSummary>({
    status: 'active',
    nextChargeDate: new Date(Date.now() + 1000*60*60*24*27).toISOString(),
    createdAt: new Date(Date.now() - 1000*60*60*24*30).toISOString(),
    plan: { id: 'annual', name: 'annual payment', priceNisPerMonth: 20, accent: 'blue', billingLabel: 'per month' },
    paymentMethod: { brand: 'visa', last4: '1234', exp: '07/28' },
    invoices: [
      { id: 'inv_001', date: new Date().toISOString(), amountNis: 240, status: 'paid' },
      { id: 'inv_000', date: new Date(Date.now()-1000*60*60*24*30).toISOString(), amountNis: 240, status: 'paid' },
    ]
  });

  @ViewChild('dialogEl') dialogEl!: ElementRef<HTMLDialogElement>;
  @ViewChild('firstFocus') firstFocus!: ElementRef<HTMLButtonElement>;
  ngOnChanges() {
    // синхронизируем состояние <dialog>
    if (this.dialogEl?.nativeElement) {
      const d = this.dialogEl.nativeElement;
      if (this.open && !d.open) d.showModal();
      if (!this.open && d.open) d.close();
    }
  }

  ngAfterViewInit() {
    if (this.open) {
      this.dialogEl.nativeElement.showModal();
      setTimeout(() => this.firstFocus?.nativeElement.focus(), 0);
    }
  }

  close() {
    this.open = false;
    this.dialogEl?.nativeElement.close();
    this.closed.emit();
  }

  view = () => this.subscription ?? this.demo();
  onChangePlan() { this.changePlan.emit(); }
  onUpdateCard() { this.updateCard.emit(); }
  onCancel() { this.cancelSubscription.emit(); }
  onDowngrade() { this.downgradeToFree.emit(); }
  onInvoice(id: string) { this.downloadInvoice.emit(id); }
}
