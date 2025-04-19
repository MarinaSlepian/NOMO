import { Component,EventEmitter,Output, Input, OnInit } from '@angular/core';

@Component({
  selector: 'app-video',
  standalone: true,
  imports: [],
  templateUrl: './video.component.html',
  styleUrls: ['./video.component.css']
})
export class VideoComponent {
  @Input({required:true}) videoPath!: string;
  @Output() cancel = new EventEmitter<void>();
  @Input({required:true}) numOfVideos!: string;
  


  onCancel()
  {
    this.cancel.emit();
  
  }

  upadteVideoPath()
  {
    const alfaBeit = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T'];
    for (let i = 0; i < Number(this.numOfVideos)-1; i++) 
      {
        if(this.videoPath.includes(alfaBeit[i])){
          console.log("numOfVideos = "+this.numOfVideos);
          console.log("this.videoPath = "+this.videoPath);
          this.videoPath = this.videoPath.replace(alfaBeit[i],alfaBeit[i+1]);
          console.log("this.videoPath after replace = "+this.videoPath);
          return;
          }
          this.videoPath = this.videoPath.replace(alfaBeit[ Number(this.numOfVideos)-1],alfaBeit[0]);
          console.log("this.videoPath out after replace = "+this.videoPath);
      }

    /*if(this.videoPath.includes('A'))
      this.videoPath = this.videoPath.replace('A','B');
    else
      this.videoPath = this.videoPath.replace('B','A');*/
    
  }

  onSwitchVideo(videoElement: HTMLVideoElement)
  {

    this.upadteVideoPath();

   // Trick: reload the <video> element manually
   setTimeout(() => {
     videoElement.load();
     videoElement.play();
   }, 0);
  }



  
}

