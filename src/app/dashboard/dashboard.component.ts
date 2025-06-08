import { Component, OnInit,Output,EventEmitter } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AppChooserComponent } from "../buttons/app-chooser/app-chooser.component";
import { AppConfig } from '../app-config.model';
import { MatDialogModule } from '@angular/material/dialog';
import { SettingsDialogComponent } from '../settings-dialog/settings-dialog.component';
import { MatDialog } from '@angular/material/dialog';


@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [TranslateModule, AppChooserComponent, MatDialogModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit
{
    @Output() selectNewApp = new EventEmitter<string>();
    @Output() newConfig = new EventEmitter<AppConfig>();

    currentConfig: AppConfig = {
      selectedLang: 'en',
      needSubtext: true,
      needAudio: false
    };
    selectedApp = "1";
    isSettingsOpen = false;

    constructor(private translate: TranslateService, private dialog: MatDialog) 
    {
   
    }
    
    ngOnInit(): void 
    {
      const saved = localStorage.getItem('appConfig');
      if (saved) {
        this.currentConfig = JSON.parse(saved);
      }
      else{
        this.currentConfig = {
        selectedLang: 'en',
        needSubtext: true,
        needAudio: false
      };
    }
    
    this.translate.setDefaultLang(this.currentConfig.selectedLang); 
    this.translate.use(this.currentConfig.selectedLang); // sets the active language
    }

  selectApp(id: string)
  {
    this.selectedApp = id;
    
   // this.updateSplashForLanguage();
    
    this.selectNewApp.emit(id); 
  }

 // Settings button click handler
  onSettingsButton(): void 
  {
    if( this.isSettingsOpen) 
      return;
    this.isSettingsOpen = true; // 🔹 Set the flag to true when dialog opens
    const dialogRef = this.dialog.open(SettingsDialogComponent, {
       width: '780px',
       height: '150px',          // 🔹 fixed height
       minHeight: '150px',       // 🔹 optional: prevent shrinking
       maxHeight: '90vh',        // 🔹 optional: prevent overflow !!
       maxWidth: '90vw',        // 🔹 optional: prevent overflow !!
       panelClass: 'settings-strip-dialog',
       backdropClass: 'custom-backdrop'
      });
  
   
    dialogRef.afterClosed().subscribe((result: AppConfig | undefined) => {
      this.isSettingsOpen = false; // 🔹 Reset the flag when dialog closes
      if (result) {
        // ✅ Add logic to update image or do anything else here
        this.currentConfig.selectedLang = result.selectedLang;
        //this.updateSplashForLanguage();
        this.currentConfig = result;
        this.newConfig.emit(this.currentConfig);
      }
    });
  }

}
