import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';

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
    this.translate.use(lang);
    this.dialogRef.close(lang); // ✅ pass the selected language back
  }

  close(): void {
    this.dialogRef.close();
  }
}
