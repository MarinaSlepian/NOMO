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


  onSwitchVideo(videoElement: HTMLVideoElement)
  {
    if(this.videoPath.includes('A'))
      this.videoPath = this.videoPath.replace('A','B');
    else
      this.videoPath = this.videoPath.replace('B','A');
   

   // Trick: reload the <video> element manually
   setTimeout(() => {
     videoElement.load();
     videoElement.play();
   }, 0);
  }



  
}

