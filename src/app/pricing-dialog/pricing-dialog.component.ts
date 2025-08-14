import { Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';


export type PlanKey = 'monthly' | 'quarterly' | 'yearly' | 'free';

export interface PricingConfig {
  currency: string;               // 'руб', '₪', '$' ...
  monthly: number;                // 300
  quarterly: number;              // 250 (в месяц при оплате раз в 3 мес)
  yearly: number;                 // 200 (в месяц при годовой оплате)
  labels?: Partial<Record<PlanKey, string>>;
}

@Component({
  selector: 'app-pricing-dialog',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './pricing-dialog.component.html',
  styleUrls: ['./pricing-dialog.component.css']
})
export class PricingDialogComponent implements OnInit {
  @Input() open = false;
  @Input() config: PricingConfig = {
    currency: '₪',
    monthly: 39,
    quarterly: 30,
    yearly: 25,
    labels: {
      monthly: 'помесячная оплата',
      quarterly: 'оплата раз в 3 месяца',
      yearly: 'годовая оплата',
      free: 'Ограниченная версия'
    }
  };

  @Output() closed = new EventEmitter<void>();
  @Output() planSelected = new EventEmitter<PlanKey>();

  @ViewChild('dialogEl') dialogEl!: ElementRef<HTMLDialogElement>;
  @ViewChild('firstFocus') firstFocus!: ElementRef<HTMLButtonElement>;

  ngOnInit(): void {}

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

  select(plan: PlanKey) {
    if(plan == 'free'){
      this.close();
      return;
    }
    this.planSelected.emit(plan);
  }

  // Закрытие по Esc
  @HostListener('document:keydown.escape', ['$event'])
  onEsc(ev: KeyboardEvent) {
    if (this.open) {
      ev.preventDefault();
      this.close();
    }
  }

  // Закрытие по клику по подложке
  onBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).tagName.toLowerCase() === 'dialog') {
      this.close();
    }
  }

  // Хелперы для шаблона
  l(key: PlanKey, fallback: string) {
    return this.config.labels?.[key] ?? fallback;
  }
}
