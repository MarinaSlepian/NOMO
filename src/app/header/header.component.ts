import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { AppChooserComponent } from "../buttons/app-chooser/app-chooser.component";
import { TranslateService,TranslateModule } from '@ngx-translate/core';
import { SettingsDialogComponent } from '../settings-dialog/settings-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';
import { AppConfig } from '../app-config.model';



@Component({
    selector: 'app-header',
    standalone: true,
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.css'],
    imports: [AppChooserComponent, TranslateModule, MatDialogModule ]
  })



export class HeaderComponent implements OnInit
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
 
  }
  
  ngOnInit(): void {
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
    this.updateSplashForLanguage();
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
       height: '350px',          // 🔹 fixed height
       minHeight: '200px',       // 🔹 optional: prevent shrinking
       maxHeight: '90vh',        // 🔹 optional: prevent overflow !!
       panelClass: 'settings-dialog-purple',
      });
  
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
    if(this.currentConfig.selectedLang != 'he' && this.currentConfig.selectedLang != 'ru' )
     this.selectedSplash = this.selectedApp + 'en';  
    else
     this.selectedSplash = this.selectedApp + this.currentConfig.selectedLang;  
  }
  
  
} 