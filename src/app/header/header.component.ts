import { Component, EventEmitter, Output } from '@angular/core';
import { AppChooserComponent } from "../buttons/app-chooser/app-chooser.component";
import { TranslateService,TranslateModule } from '@ngx-translate/core';
import { SettingsDialogComponent } from '../settings-dialog/settings-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';
import { ThisReceiver } from '@angular/compiler';
import { AppConfig } from '../app-config.model';



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
  @Output() newConfig = new EventEmitter<AppConfig>();

  currentConfig: AppConfig = {
    selectedLang: 'en',
    needSubtext: true,
    needAudio: false
  };

  selectedApp = "1";
  selectedSplash = "1en";
  

  constructor(private translate: TranslateService, private dialog: MatDialog) 
  {
    this.translate.setDefaultLang('en'); // sets fallback if no translation is found
    this.translate.use('en'); // sets the active language
    this.selectedSplash = this.selectedApp+'en';  
    this.currentConfig.selectedLang = 'en';   
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
       width: '300px',
       height: '400px',          // 🔹 fixed height
       minHeight: '200px',       // 🔹 optional: prevent shrinking
       maxHeight: '90vh',        // 🔹 optional: prevent overflow 
       data: {
        selectedLang: this.currentConfig.selectedLang,
        needSubtext: this.currentConfig.needSubtext,
        needAudio: this.currentConfig.needAudio
      }});
  
    dialogRef.afterClosed().subscribe((result: AppConfig | undefined) => {
      if (result) {
        // ✅ Add logic to update image or do anything else here
        this.currentConfig.selectedLang = result.selectedLang;
        this.updateSplashForLanguage();
        this.currentConfig = result;
        this.newConfig.emit(this.currentConfig);
      }
    });

  }


  updateSplashForLanguage()
  {
    this.selectedSplash = this.selectedApp + this.currentConfig.selectedLang;  
  }
  

} 