import { Component, OnInit,ViewEncapsulation } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AppConfig } from '../app-config.model';

import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatOptionModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TranslateModule } from '@ngx-translate/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { PricingDialogComponent } from '../pricing-dialog/pricing-dialog.component';
import { PayService } from '../services/pay.service';
import { AuthService } from '../auth/auth.service';



@Component({
  selector: 'app-settings-dialog',
  standalone: true,
  templateUrl: './settings-dialog.component.html',
  styleUrls: ['./settings-dialog.component.css'],
  encapsulation: ViewEncapsulation.None,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatOptionModule,
    MatButtonModule,
    MatCheckboxModule,
    TranslateModule,
    MatSlideToggleModule,
    PricingDialogComponent
  ]
})


export class SettingsDialogComponent implements OnInit{
  readonly CURRENCY = 1;     // 1 = ILS
  isPayDialogOpen = false;
  isPaying = false;
  payError = '';

  cancelLabel = 'Cancel';
  saveLabel = 'Save';
  langLabel = 'Language';
  audioLabel = 'Enable audio';
  subtextLabel = "Show subtext";
  titleLabel = "Application settings";

  selectedLang = 'en';
  needSubtext = true;
  needAudio = false;
  currentConfig: AppConfig = {
                selectedLang: this.selectedLang,
                needSubtext: this.needSubtext,
                needAudio: this.needAudio,
                selectedApp: '1' 
               };

  languages = [
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Русский' },
    { code: 'he', label: 'עברית' },
    { code: 'ukr', label: 'Українська'},
    { code: 'cz', label: 'Čeština'},
  ]; 

  constructor(
    public dialogRef: MatDialogRef<SettingsDialogComponent>,
    private translate: TranslateService,
    private pay: PayService, private auth: AuthService
  ) {}

  ngOnInit() 
  {
    
  const saved = localStorage.getItem('appConfig');
  if (saved) {
    this.currentConfig = JSON.parse(saved);
  }
  else {
    this.currentConfig = {
      selectedLang: 'en',
      needSubtext: true,
      needAudio: false,
      selectedApp: '1'
    };
  }
  this.selectedLang = this.currentConfig.selectedLang;
  this.needSubtext = this.currentConfig.needSubtext;
  this.needAudio = this.currentConfig.needAudio;

  this.onLanguageChange(this.currentConfig.selectedLang);
  } 
    
  
  
  save(): void {

    this.currentConfig.needAudio = this.needAudio;
    this.currentConfig.needSubtext = this.needSubtext;
    this.currentConfig.selectedLang = this.selectedLang;
    
    this.translate.use(this.selectedLang);
    
  // ✅ Save to localStorage
    localStorage.setItem('appConfig', JSON.stringify(this.currentConfig));
    this.dialogRef.close(this.currentConfig);
  }
  close(): void {
    this.dialogRef.close();
  }

  onLanguageChange(lang: string) {
    const currentLang = this.translate.currentLang;
  
    this.translate.use(lang).subscribe(() => {
      this.translate.get(['SETTINGSDLOG.CANCEL', 'SETTINGSDLOG.SAVE', 
                          'SETTINGSDLOG.LANG','SETTINGSDLOG.SHOWSUBTEXT',
                          'SETTINGSDLOG.ENABLEAUDIO','SETTINGSDLOG.TITLE']).subscribe(translations => {
        this.cancelLabel = translations['SETTINGSDLOG.CANCEL'];
        this.saveLabel = translations['SETTINGSDLOG.SAVE'];
        this.langLabel = translations['SETTINGSDLOG.LANG'];
        this.audioLabel = translations['SETTINGSDLOG.ENABLEAUDIO'];
        this.subtextLabel = translations['SETTINGSDLOG.SHOWSUBTEXT'];
        this.titleLabel = translations['SETTINGSDLOG.TITLE'];
      
  
        // Reset to previous language
        this.translate.use(currentLang);
      });
    });
  }

  openUserDialog(): void {
    // Logic to open user dialog
    console.log('User icon clicked - open user dialog');
  } 
    openPayDialog() {
    this.payError = '';
    this.isPayDialogOpen = true;
  }

  cancelPayment() {
    if (this.isPaying) return;
    this.isPayDialogOpen = false;
  }

  confirmPayment(planSelected: string) {
    if (this.isPaying) return;
    this.isPaying = true;
    this.payError = '';
    const orderId = this.pay.makeOrderId();
    let description = 'NOMO monthly subscription';
    const currency = this.CURRENCY;
    let amount = 30;
    let planDays = 31;//monthly
    if(planSelected == "quarterly"){
      planDays = 90;
      amount = 29*3;
      description = "NOMO quarterly subscription"
    }
    else if(planSelected == "yearly"){
      planDays = 365;
      amount = 20*12;
      description = "NOMO yearly subscription"
    }
    const userEmail = this.auth.getLoggedInEmail();
    //temporary 
    amount = 1;
    planDays = 1;
    //temporary 
    console.log("payment chosen, plan selected is ", planSelected);
    this.pay.startPayment({ amount, orderId, description, currency ,userEmail,planDays })
      .subscribe({
        next: ({ url, lowProfileId }) => {
          sessionStorage.setItem('lastLowProfileId', String(lowProfileId));
          sessionStorage.setItem('lastOrderId', orderId);
          window.location.href = url; // go to Cardcom hosted page
        },
        error: err => {
          console.error('Payment init failed', err);
          this.payError = err?.error?.error || 'Payment init failed';
          this.isPaying = false; // allow retry
        }
      });
  }  
}  
