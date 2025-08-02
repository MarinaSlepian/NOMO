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
import { DashboardComponent } from './dashboard/dashboard.component';
import { v4 as uuidv4 } from 'uuid';
import { SequenceChooserComponent } from './sequence-chooser/sequence-chooser.component';
import { AuthComponent } from './auth/auth.component';
import { jwtDecode } from 'jwt-decode'; 
import { SwUpdate } from '@angular/service-worker';

interface MyTokenPayload {
  email: string;
  exp: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [HeaderComponent, ButtonComponent, DashboardComponent,
            SequenceChooserComponent, AuthComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})



export class AppComponent implements OnInit{
  showAuthDialog = false;
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
  isShowDashboard = true;

  constructor(private translate: TranslateService, private swUpdate: SwUpdate)
  {
    console.log('🚀 NOMO App version 2 running');

    this.swUpdate.versionUpdates.subscribe(event => {
      if (event.type === 'VERSION_READY') {
        console.log('🔄 New version found, reloading...');
        this.swUpdate.activateUpdate().then(() => document.location.reload());
      }
    });
  }

  ngOnInit(): void {

    //check authentication
    const token = localStorage.getItem('token');
    this.showAuthDialog = !token; // show dialog only if token is missing

    this.deviceId = localStorage.getItem('deviceId');
    if (!this.deviceId) {
      this.deviceId = uuidv4();
      localStorage.setItem('deviceId', this.deviceId);
    }
    console.log('Device ID:', this.deviceId);
    //check config
    const saved = localStorage.getItem('appConfig');
    if (saved) {
      this.currentConfig = { ...this.currentConfig, ...JSON.parse(saved) };
    }   
    this.onUpdateNewConfig(this.currentConfig);
    this.onSelectAppButton(this.currentConfig.selectedApp);

    //check install prompt
    window.addEventListener('beforeinstallprompt', (e: Event) => {
        console.log('beforeinstallprompt fired'); 
        e.preventDefault();
        this.deferredPrompt = e;
      });
    //check orientation
    this.checkOrientation();
  }
  getLoggedInEmail(): string | undefined {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const decoded = jwtDecode<{ email: string }>(token);
        console.log("Logged-in email:", decoded.email);
        return decoded.email;
      } catch (e) {
        console.warn("❌ Failed to decode token:", e);
      }
    }
    return undefined;
  }
  installRequested() {
    this.showInstallButton = true; // Now you can show a button in the template

  }
  installApp() {
    if (this.deferredPrompt) {
      this.deferredPrompt.prompt();
      this.deferredPrompt.userChoice.then((choiceResult: any) => {
        console.log('Install outcome:', choiceResult.outcome);
        this.deferredPrompt = null;
      });
    } else {
      console.log('No install prompt available');
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

  hideShowDashboard(isShow: boolean) {
    this.isShowDashboard = isShow;
    console.log('isShowDashboard', this.isShowDashboard);
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

    this.httpClient.put('https://nomo-cj4l.onrender.com/app-usage',{
    appId: this.currentConfig.selectedApp,
    deviceId: this.deviceId,
    email: this.getLoggedInEmail()
    } ).subscribe({
    next: (resData) => console.log (resData),
    });

  } 
  //authentication dialog
  onAuthDialogClosed() {
    this.showAuthDialog = false;
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

