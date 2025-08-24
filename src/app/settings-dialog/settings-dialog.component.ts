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
    MatSlideToggleModule
  ]
})


export class SettingsDialogComponent implements OnInit{
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
    private translate: TranslateService
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
  
}  
