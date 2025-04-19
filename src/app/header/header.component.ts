import { Component, EventEmitter, Output } from '@angular/core';
import { AppChooserComponent } from "../buttons/app-chooser/app-chooser.component";
import { TranslateService,TranslateModule } from '@ngx-translate/core';
import { SettingsDialogComponent } from '../settings-dialog/settings-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';
import { ThisReceiver } from '@angular/compiler';

@Component({
    selector: 'app-header',
    standalone: true,
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.css'],
    imports: [AppChooserComponent, TranslateModule, MatDialogModule ]
  })



export class HeaderComponent
{
  @Output() selectNewApp = new EventEmitter<string>();

  selectedApp = "1";
  selectedSplash = "1ru";
  selectedLang = 'ru';

  constructor(private translate: TranslateService, private dialog: MatDialog) 
  {
    this.translate.setDefaultLang('ru'); // sets fallback if no translation is found
    this.translate.use('ru'); // sets the active language
    this.selectedSplash = this.selectedApp+'ru';  
    this.selectedLang = 'ru';   
  }
  

  selectApp(id: string)
  {
    this.selectedApp = id;
    
    this.updateSplashForLanguage();
    this.selectNewApp.emit(id); 
  }

  onSettingsButton(): void 
  {
    const dialogRef = this.dialog.open(SettingsDialogComponent, {
      width: '300px'});
  
    dialogRef.afterClosed().subscribe((selectedLang: string | undefined) => {
      if (selectedLang) {
        console.log('Language changed to:', selectedLang);
        // ✅ Add logic to update image or do anything else here
        this.selectedLang = selectedLang;
        this.updateSplashForLanguage();
      }
    });
  }

  updateSplashForLanguage()
  {
    this.selectedSplash = this.selectedApp + this.selectedLang;  
  }
  

} 