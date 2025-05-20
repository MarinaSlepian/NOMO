import { Component, OnInit,Output,EventEmitter } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AppChooserComponent } from "../buttons/app-chooser/app-chooser.component";
import { AppConfig } from '../app-config.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [TranslateModule, AppChooserComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit{
    @Output() selectNewApp = new EventEmitter<string>();

    currentConfig: AppConfig = {
      selectedLang: 'en',
      needSubtext: true,
      needAudio: false
    };
    selectedApp = "1";

    constructor(private translate: TranslateService) 
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

 
}
