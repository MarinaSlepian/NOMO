import { TitleCasePipe, DatePipe } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, ViewChild, ElementRef, OnInit} from '@angular/core';
import { MeResponse } from '../services/entitlement.service';
import { PlanInfo, PayService } from '../services/pay.service';

type PlanId = 'monthly' | 'quarterly' | 'annual' | 'free';



interface Invoice {
  id: string;
  date: string;     // ISO
  amountNis: number;
  status: 'paid' | 'refunded' | 'open' | 'void';
  url?: string;
}
interface SubscriptionSummary {
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'paused';
  createdAt?: string;      // ISO
  invoices?: Invoice[];
}

@Component({
  selector: 'app-billing-dialog',
  templateUrl: './billing-dialog.component.html',
  styleUrls: ['./billing-dialog.component.css'],
  standalone: true,
  imports: [TitleCasePipe, DatePipe]
})

export class BillingDialogComponent implements OnInit{
  @Input() open = false;
  @Input({required:true}) meResponse!: MeResponse;
  @Output() closed = new EventEmitter<void>();
  @Output() changePlan = new EventEmitter<void>();           // open your pricing dialog
  @Output() updateCard = new EventEmitter<void>();           // open Cardcom update flow
  @Output() cancelSubscription = new EventEmitter<void>();   // show confirm + call backend
  @Output() downloadInvoice = new EventEmitter<string>();    // invoice.id

  planName = '';
  pricePerMonth = 0;

  subscription?: SubscriptionSummary;

    // Fallback planData data so the dialog renders before data arrives:
    planData = signal<SubscriptionSummary>({
    status: 'active',
    createdAt: new Date(Date.now() - 1000*60*60*24*30).toISOString(),
    invoices: [
      { id: 'inv_001', date: new Date().toISOString(), amountNis: 240, status: 'paid' },
      { id: 'inv_000', date: new Date(Date.now()-1000*60*60*24*30).toISOString(), amountNis: 240, status: 'paid' },
    ]
  });

  @ViewChild('dialogEl') dialogEl!: ElementRef<HTMLDialogElement>;
  @ViewChild('firstFocus') firstFocus!: ElementRef<HTMLButtonElement>;

  constructor(private payService: PayService) {}

  ngOnInit(): void {
    this.planName = this.payService.getPlanName(this.meResponse.plan?.plan_days || 0); 
    const planDays = this.meResponse.plan?.plan_days || 0;
    this.pricePerMonth = this.meResponse.billing?.last_payment_sum? this.meResponse.billing?.last_payment_sum : 0;
    this.pricePerMonth = Math.round((this.pricePerMonth / (planDays / 30)) * 100) / 100;
  }

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

  view = () => this.subscription ?? this.planData();
  onChangePlan() { this.changePlan.emit(); }
  onUpdateCard() { this.updateCard.emit(); }
  onCancel() { this.cancelSubscription.emit(); }
  onInvoice(id: string) { this.downloadInvoice.emit(id); }
}
