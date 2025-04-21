import { Component ,Input} from '@angular/core';
import { VideoComponent } from '../../video/video.component';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule } from '@ngx-translate/core';

//type User =  {
//  id: string;
//  avatar: string;
//  name: string;
//}
interface User {
  id: string;
  avatar: string;
  name: string;
  numVideos: string;
  subtextKey: string;
}

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [VideoComponent, TranslateModule],
  templateUrl: './button.component.html',
  styleUrls: ['./button.component.css']
})

export class ButtonComponent {
  @Input({required:true}) user!: User;
  @Input({required:true}) videoPath!: string;
  @Input({required:true}) currentApp!: string;
  @Input({required:true}) isSubtextNeeded!: boolean;
  @Input({required:true}) isAudioNeeded!: boolean;

  fullVideoPath = '';
  isShowVideo = false;
  
  constructor(public translate: TranslateService) {}

  get imagePath() {
    if(this.currentApp === '1')
      return 'assets/button-icons/right-wrong/' + this.user.avatar;
    if(this.currentApp === '2')
      return 'assets/button-icons/good-bad/' + this.user.avatar;
    if(this.currentApp === '3')
      return 'assets/button-icons/actions/' + this.user.avatar;
    if(this.currentApp === '4')
      return 'assets/button-icons/emotions/' + this.user.avatar;
    return 'assets/button-icons/good-bad/' + this.user.avatar;
  }

  buildVideoPath()
  {
    this.fullVideoPath = this.videoPath + this.user.id + 'A.mp4';
  }

  async onSelectButton()//buttonClick
  { 
 
    let numClicks = Number(this.user.name);
    numClicks++;
    this.user.name = numClicks.toString();
    this.buildVideoPath();
    if (this.isAudioNeeded) {
      await this.playLocalizedAudio(this.user.subtextKey); // 👈 wait for audio
    }
    this.isShowVideo = true;

  }
  onCancelVideo()
  {
    this.isShowVideo = false; 
  }  

  async playLocalizedAudio(key: string) 
  {
    const lang = this.translate.currentLang || this.translate.getDefaultLang();
    key = key.replace("subtext.", "");
    const audioPath = `assets/audio/${lang}/${key.toLowerCase()}.mp3`;
    try {
      await this.playAudioAndWait(audioPath);
      console.log('Audio finished playing');
    } 
    catch (err) {
      console.error(err);
    }
  
    //const audio = new Audio(audioPath);
    //audio.play().catch((error) => console.error('Audio playback failed', error));
  }

  playAudioAndWait(audioPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(audioPath);
  
      audio.onended = () => resolve(); // resolves when playback finishes
      audio.onerror = (e) => reject('Audio playback error: ' + e);
  
      audio.play().catch((err) => reject('Play failed: ' + err));
    });
  }
}

