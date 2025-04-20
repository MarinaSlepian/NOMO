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
import { MAT_DIALOG_DATA } from '@angular/material/dialog';



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

  languages = [
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Русский' },
    { code: 'he', label: 'עברית' }
  ];

  constructor(
    public dialogRef: MatDialogRef<SettingsDialogComponent>,
    private translate: TranslateService,
    @Inject(MAT_DIALOG_DATA) public data: AppConfig
  ) {}

  ngOnInit() {
    if (this.data) {
      this.selectedLang = this.data.selectedLang;
      this.needSubtext = this.data.needSubtext;
      this.needAudio = this.data.needAudio;
    }
    //const saved = localStorage.getItem('appConfig');
    console.log('Languages:', this.languages);
  }
  
  save(): void {
    const config: AppConfig = {
      selectedLang: this.selectedLang,
      needSubtext: this.needSubtext,
      needAudio: this.needAudio
    };
    console.log('needSubtext:', this.needSubtext);
    this.translate.use(this.selectedLang);
    
  // ✅ Save to localStorage
    //localStorage.setItem('appConfig', JSON.stringify(config));
    this.dialogRef.close(config);
  }
  close(): void {
    this.dialogRef.close();
  }
}
