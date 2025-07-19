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
import { DashboardComponent } from './dashboard/dashboard.component';
import { v4 as uuidv4 } from 'uuid';
import { SequenceChooserComponent } from './sequence-chooser/sequence-chooser.component';


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [HeaderComponent, ButtonComponent, NgIf, DashboardComponent,SequenceChooserComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})


export class AppComponent implements OnInit{
  deviceId: string | null = null
  deferredPrompt: any;
  showInstallButton = false;
  private httpClient = inject(HttpClient);
  rotateInstruction = "";
  buttons = BUTTONS_RIGHT_WRONG_ICONS;
  currentVideosPath = 'aassets/videos/right-wrong/video-';
  isSubTextNeeded = false;
  isAudioNeeded = false;
  currentConfig: AppConfig = {
    selectedLang: 'en',
    needSubtext: true,
    needAudio: false,
    selectedApp: '1' // Default selected app
  };
//for mobile device
  isPortraitOnMobile = false;

  constructor(private translate: TranslateService)
  {
   const saved = localStorage.getItem('appConfig');
   if (saved) {
     //this.currentConfig = JSON.parse(saved);
     this.currentConfig = { ...this.currentConfig, ...JSON.parse(saved) };
   }
   this.onSelectAppButton(this.currentConfig.selectedApp);
   this.onUpdateNewConfig(this.currentConfig);
   
  }

  ngOnInit(): void {
    this.deviceId = localStorage.getItem('deviceId');
    if (!this.deviceId) {
      this.deviceId = uuidv4();
      localStorage.setItem('deviceId', this.deviceId);
    }
    console.log('Device ID:', this.deviceId);

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
    console.log('onUpdateNewConfig .currentApp '+ this.currentConfig.selectedApp);
    this.isSubTextNeeded = newAppConfig.needSubtext;

    this.currentConfig = newAppConfig;
    //subtext and audio only relevant for emotions and actions
    if(this.currentConfig.selectedApp === '1' || this.currentConfig.selectedApp === '2'){
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
    this.currentConfig.selectedApp = id;
    console.log('Selected button id app component '+id);
    if(id === '1'){
      this.buttons = BUTTONS_RIGHT_WRONG_ICONS;
      //this.currentVideosPath = 'assets/videos/right-wrong/video-';
      this.currentVideosPath = 'https://r2-video-proxy.slepianmarina.workers.dev/right-wrong/video-';
      this.isSubTextNeeded = false;
      this.isAudioNeeded = false;
    }
    else if(id === '2'){
      this.buttons = BUTTONS_GOOD_BAD_ICONS;
      //this.currentVideosPath = 'assets/videos/good-bad/video-';
      this.currentVideosPath = 'https://r2-video-proxy.slepianmarina.workers.dev/good-bad/video-';
      this.isSubTextNeeded = false;
      this.isAudioNeeded = false;
    } else if(id === '3')
    {
      this.buttons = BUTTONS_ACTIONS_ICONS;
      //this.currentVideosPath = 'assets/videos/actions/video-';
      this.currentVideosPath = 'https://r2-video-proxy.slepianmarina.workers.dev/actions/video-';
      this.isSubTextNeeded = this.currentConfig.needSubtext;
      this.isAudioNeeded = this.currentConfig.needAudio;
    } else if(id==='4')
    {
      this.buttons = BUTTONS_EMOTIONS_ICONS;
      //this.currentVideosPath = 'assets/videos/emotions/video-';
      this.currentVideosPath = 'https://r2-video-proxy.slepianmarina.workers.dev/emotions/video-';
      this.isSubTextNeeded = this.currentConfig.needSubtext;
      this.isAudioNeeded = this.currentConfig.needAudio;
    }
    else {//temporary
     this.buttons = BUTTONS_RIGHT_WRONG_ICONS;
     //this.currentVideosPath = 'https://pub-cd55d14ab122470ead2da86ec8b3e38e.r2.dev/right-wrong/video-';
     this.currentVideosPath = 'https://r2-video-proxy.slepianmarina.workers.dev/right-wrong/video-';
     this.isSubTextNeeded = false;
     this.isAudioNeeded = false;
    }
    
    
    //send usage info to server
    //this.httpClient.put('http://localhost:3000/app-usage',{

    this.httpClient.put('https://nomo-backend.onrender.com/app-usage',{
    appId: this.currentConfig.selectedApp,
    deviceId: this.deviceId
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

