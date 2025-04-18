import { Component ,EventEmitter,Input, Output} from '@angular/core';
import { VideoComponent } from '../../video/video.component';


//type User =  {
//  id: string;
//  avatar: string;
//  name: string;
//}
interface User {
  id: string;
  avatar: string;
  name: string;
}

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [VideoComponent],
  templateUrl: './button.component.html',
  styleUrls: ['./button.component.css']
})

export class ButtonComponent {
  @Input({required:true}) user!: User;
  @Input({required:true}) videoPath!: string;
  @Input({required:true}) currentApp!: string;

  fullVideoPath = '';
  
  isShowVideo = false;
  
  get imagePath() {
    if(this.currentApp === '1')
      return 'assets/button-icons/right-wrong/' + this.user.avatar;
    if(this.currentApp === '2')
      return 'assets/button-icons/good-bad/' + this.user.avatar;
    return 'assets/button-icons/good-bad/' + this.user.avatar;
  }

  buildVideoPath()
  {
    this.fullVideoPath = this.videoPath + this.user.id + 'A.mp4';
  }

  onSelectButton()//buttonClick
  { 
 
    let numClicks = Number(this.user.name);
    numClicks++;
    this.user.name = numClicks.toString();
    this.buildVideoPath();
    
    this.isShowVideo = true;
  }
  onCancelVideo()
  {
    this.isShowVideo = false;
  }

}

