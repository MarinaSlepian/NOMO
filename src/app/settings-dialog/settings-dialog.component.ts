import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AppConfig } from '../app-config.model';

@Component({
  selector: 'app-settings-dialog',
  templateUrl: './settings-dialog.component.html',
  styleUrls: ['./settings-dialog.component.css'] // you can skip this if you're not using it
})
export class SettingsDialogComponent {


  constructor(
    public dialogRef: MatDialogRef<SettingsDialogComponent>,
    private translate: TranslateService
  ) {}

  changeLanguage(lang: string): void {
    const config: AppConfig = {
      selectedLang: lang,
      needSubtext: true, // or get from form/input
      needAudio: false
    };
    this.translate.use(lang);
    this.dialogRef.close(config); // ✅ pass the selected language back
  }

  close(): void {
    this.dialogRef.close();
  }
}
