import { Component, HostListener, OnInit, inject } from '@angular/core';
import { HeaderComponent } from "./header/header.component";
import { ButtonComponent } from "./buttons/button/button.component";
import { BUTTONS_GOOD_BAD_ICONS } from './buttons/buttons-good-bad-icons';
import { BUTTONS_RIGHT_WRONG_ICONS } from './buttons/buttons-write-wrong-icons';
import { BUTTONS_ACTIONS_ICONS } from './buttons/buttons-actions-icons';
import { BUTTONS_EMOTIONS_ICONS } from './buttons/buttons-emotions-icons';
import { AppConfig } from './app-config.model';
import { TranslateService } from '@ngx-translate/core';
import { HttpClient } from '@angular/common/http';
import { NgIf } from '@angular/common';


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [HeaderComponent, ButtonComponent, NgIf],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})


export class AppComponent implements OnInit{
  deferredPrompt: any;
  showInstallButton = false;
  private httpClient = inject(HttpClient);
  rotateInstruction = "";
  buttons = BUTTONS_RIGHT_WRONG_ICONS;
  currentApp = '1';  
  currentVideosPath = 'aassets/videos/right-wrong/video-';
  isSubTextNeeded = false;
  isAudioNeeded = false;
  currentConfig: AppConfig = {
    selectedLang: 'en',
    needSubtext: true,
    needAudio: false
  };
//for mobile device
  isPortraitOnMobile = false;

  constructor(private translate: TranslateService){
   this.onSelectAppButton('1');
   const saved = localStorage.getItem('appConfig');
   if (saved) 
     this.currentConfig = JSON.parse(saved);
   this.onUpdateNewConfig(this.currentConfig);
   
  }

  ngOnInit(): void {
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      console.log('beforeinstallprompt fired'); 
      e.preventDefault();
      this.deferredPrompt = e;
      this.showInstallButton = true; // Now you can show a button in the template
    });
    this.checkOrientation();
  }

  installApp() {
    console.log('Install clicked');
    if (this.deferredPrompt) {
      this.deferredPrompt.prompt();
      this.deferredPrompt.userChoice.then((choiceResult: any) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted the install prompt');
        } else {
          console.log('User dismissed the install prompt');
        }
        this.deferredPrompt = null;
        this.showInstallButton = false;
      });
    }
  }

  onUpdateNewConfig(newAppConfig: AppConfig)
  {
    console.log('onUpdateNewConfig .currentApp '+ this.currentApp);
    this.isSubTextNeeded = newAppConfig.needSubtext;

    this.currentConfig = newAppConfig;
    //subtext and audio only relevant for emotions and actions
    if(this.currentApp === '1' || this.currentApp === '2'){
      this.isSubTextNeeded = false;
      this.isAudioNeeded = false; 
    }
    else {
      this.isSubTextNeeded = this.currentConfig.needSubtext;
      this.isAudioNeeded = this.currentConfig.needAudio;
    }

    this.translate.use(newAppConfig.selectedLang).subscribe(() => {
      this.translate.get(['ROTATE_DEVICE.INSTRUCTION']).subscribe(translations => {
        this.rotateInstruction = translations['ROTATE_DEVICE.INSTRUCTION'];
      });
    });

    
  }

  onSelectAppButton(id: string)
  { 
    this.currentApp = id;
    console.log('Selected button id app component '+id);
    if(id === '1'){
      this.buttons = BUTTONS_RIGHT_WRONG_ICONS;
      this.currentVideosPath = 'assets/videos/right-wrong/video-';
      this.isSubTextNeeded = false;
      this.isAudioNeeded = false;
    }
    else if(id === '2'){
      this.buttons = BUTTONS_GOOD_BAD_ICONS;
      this.currentVideosPath = 'assets/videos/good-bad/video-';
      this.isSubTextNeeded = false;
      this.isAudioNeeded = false;
    } else if(id === '3')
    {
      this.buttons = BUTTONS_ACTIONS_ICONS;
      this.currentVideosPath = 'assets/videos/actions/video-';
      this.isSubTextNeeded = this.currentConfig.needSubtext;
      this.isAudioNeeded = this.currentConfig.needAudio;
    } else if(id==='4')
    {
      this.buttons = BUTTONS_EMOTIONS_ICONS;
      this.currentVideosPath = 'assets/videos/emotions/video-';
      this.isSubTextNeeded = this.currentConfig.needSubtext;
      this.isAudioNeeded = this.currentConfig.needAudio;
    }
    else {//temporary
     this.buttons = BUTTONS_RIGHT_WRONG_ICONS;
     this.currentVideosPath = 'assets/videos/right-wrong/video-';
     this.isSubTextNeeded = false;
     this.isAudioNeeded = false;
    }
      //send usage info to server
    //this.httpClient.put('http://localhost:3000/app-usage',{
    this.httpClient.put('https://nomo-backend.onrender.com/app-usage',{
    appId: this.currentApp
    } ).subscribe({
    next: (resData) => console.log (resData),
    });

  } 

  @HostListener('window:resize')
  @HostListener('window:orientationchange')
  onResizeOrOrientationChange() {
    this.checkOrientation();
  }

//  checkOrientation() {
//    const isMobile = window.innerWidth <= 768;
//    const isPortrait = window.innerHeight > window.innerWidth;
//    this.isPortraitOnMobile = isMobile && isPortrait;
//  }

checkOrientation() {
  const isMobile = window.innerWidth <= 768;
  let isPortrait = false;

  // Use screen.orientation API if available (more reliable in standalone)
  if (screen.orientation && screen.orientation.type) {
    isPortrait = screen.orientation.type.startsWith('portrait');
  } else {
    // Fallback logic
    isPortrait = window.innerHeight > window.innerWidth;
  }

  this.isPortraitOnMobile = isMobile && isPortrait;
}
}

