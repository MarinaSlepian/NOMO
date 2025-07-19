import { Component, EventEmitter, OnInit, Input, OnChanges } from '@angular/core';
import { TranslateService,TranslateModule } from '@ngx-translate/core';
import { AppConfig } from '../app-config.model';
import { Subscription } from 'rxjs'; 


@Component({
    selector: 'app-header',
    standalone: true,
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.css'],
    imports: [TranslateModule],
  })



export class HeaderComponent implements OnInit, OnChanges
{
 
  @Input({required:true}) appName!: string;

  currentConfig: AppConfig = {
    selectedLang: 'en',
    needSubtext: true,
    needAudio: false,
    selectedApp: '1' // Default selected app
  };

  selectedSplash = "1en";
  translatedAppName = '';
  appNameBannerColor = 'rgb(229,16,22)';
  private langChangeSub?: Subscription;


  

  constructor(private translate: TranslateService) 
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
        needAudio: false,
        selectedApp: '1' // Default selected app
      };
    }
    this.translate.setDefaultLang(this.currentConfig.selectedLang); 
    this.langChangeSub = this.translate.onLangChange.subscribe(() => {
    this.updateSplashForLanguage();
    });

    this.translate.use(this.currentConfig.selectedLang); // sets the active language
    // Subscribe to language change

  }

    ngOnDestroy(): void {
    this.langChangeSub?.unsubscribe();
  }

  ngOnChanges(): void 
  {
    this.updateSplashForLanguage();
    if(this.appName == '1')
      this.appNameBannerColor = 'rgb(229,16,22)'; // red
    else if(this.appName == '2')
      this.appNameBannerColor = 'rgb(252,180,62)'; // blue 
    else if(this.appName == '3')
      this.appNameBannerColor = 'rgb(161,198,30)'; // green    
    else if(this.appName == '4')
      this.appNameBannerColor = 'rgb(6,133,248)'; // orange
  }

  updateSplashForLanguage()
  {

    this.selectedSplash = this.appName + 'en'; 
    const keyMap: Record<string, string> = {
      '1': 'APP_NAMES.WHAT_WRONG',
      '2': 'APP_NAMES.GOOD_BAD',
      '3': 'APP_NAMES.ACTIONS',
      '4': 'APP_NAMES.EMOTIONS',
      '5': 'APP_NAMES.SEQUENCES'
    };

    const translationKey = keyMap[this.appName];

    this.translate.get(translationKey).subscribe((translated: string) => {
      this.translatedAppName = translated;
    });
    

   /* if(this.currentConfig.selectedLang != 'he' && this.currentConfig.selectedLang != 'ru' )
     this.selectedSplash = this.selectedApp + 'en';  
    else
     this.selectedSplash = this.selectedApp + this.currentConfig.selectedLang;  */
  }
  
  
} 