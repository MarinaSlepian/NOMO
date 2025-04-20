import { Component, EventEmitter } from '@angular/core';
import { HeaderComponent } from "./header/header.component";
import { ButtonComponent } from "./buttons/button/button.component";
import { BUTTONS_GOOD_BAD_ICONS } from './buttons/buttons-good-bad-icons';
import { BUTTONS_RIGHT_WRONG_ICONS } from './buttons/buttons-write-wrong-icons';
import { BUTTONS_ACTIONS_ICONS } from './buttons/buttons-actions-icons';
import { BUTTONS_EMOTIONS_ICONS } from './buttons/buttons-emotions-icons';
import { AppConfig } from './app-config.model';





@Component({
  selector: 'app-root',
  standalone: true,
  imports: [HeaderComponent, ButtonComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  buttons = BUTTONS_RIGHT_WRONG_ICONS;
  currentApp = '1';  
  currentVideosPath = 'aassets/videos/right-wrong/video-';
  isSubTextNeeded = false;
  currentConfig: AppConfig = {
    selectedLang: 'en',
    needSubtext: true,
    needAudio: false
  };

  constructor(){
  this.onSelectAppButton('1');

  }

  onUpdateNewConfig(newAppConfig: AppConfig)
  {
    this.isSubTextNeeded = newAppConfig.needSubtext;
    this.currentConfig = newAppConfig;
    //subtext only relevant for emotions and actions
    if(this.currentApp === '1' || this.currentApp === '2')
      this.isSubTextNeeded = false;
    else 
      this.isSubTextNeeded = this.currentConfig.needSubtext;
  }

  onSelectAppButton(id: string)
  { 
    this.currentApp = id;
    console.log('Selected button id app component '+id);
    if(id === '1'){
      this.buttons = BUTTONS_RIGHT_WRONG_ICONS;
      this.currentVideosPath = 'assets/videos/right-wrong/video-';
      this.isSubTextNeeded = false;
    }
    else if(id === '2'){
      this.buttons = BUTTONS_GOOD_BAD_ICONS;
      this.currentVideosPath = 'assets/videos/good-bad/video-';
      this.isSubTextNeeded = false;
    } else if(id === '3')
    {
      this.buttons = BUTTONS_ACTIONS_ICONS;
      this.currentVideosPath = 'assets/videos/actions/video-';
      this.isSubTextNeeded = this.currentConfig.needSubtext;
    } else if(id==='4')
    {
      this.buttons = BUTTONS_EMOTIONS_ICONS;
      this.currentVideosPath = 'assets/videos/emotions/video-';
      this.isSubTextNeeded = this.currentConfig.needSubtext;
    }
    else {//temporary
     this.buttons = BUTTONS_RIGHT_WRONG_ICONS;
     this.currentVideosPath = 'assets/videos/right-wrong/video-';
     this.isSubTextNeeded = false;
    }
  }
}
