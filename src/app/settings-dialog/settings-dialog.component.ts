import { Component, OnInit,Inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AppConfig } from '../app-config.model';

import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatOptionModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';




@Component({
  selector: 'app-settings-dialog',
  standalone: true,
  templateUrl: './settings-dialog.component.html',
  styleUrls: ['./settings-dialog.component.css'],
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatOptionModule,
    MatButtonModule,
    MatCheckboxModule
  ]
})


export class SettingsDialogComponent implements OnInit{
  selectedLang = 'en';
  needSubtext = true;
  needAudio = false;
  currentConfig: AppConfig = {
                selectedLang: this.selectedLang,
                needSubtext: this.needSubtext,
                needAudio: this.needAudio
               };

  languages = [
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Русский' },
    { code: 'he', label: 'עברית' }
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
      needAudio: false
    };
  }
  this.selectedLang = this.currentConfig.selectedLang;
  this.needSubtext = this.currentConfig.needSubtext;
  this.needAudio = this.currentConfig.needAudio;
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
}
