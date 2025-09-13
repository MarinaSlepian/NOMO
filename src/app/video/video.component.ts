import { Component, EventEmitter, Output, Input, HostListener, 
          ViewChild, ElementRef, AfterViewInit, OnInit  } from '@angular/core';

@Component({
  selector: 'app-video',
  standalone: true,
  imports: [],
  templateUrl: './video.component.html',
  styleUrls: ['./video.component.css']
})
export class VideoComponent implements AfterViewInit, OnInit {
  @Input({required:true}) videoPath!: string;
  @Output() cancel = new EventEmitter<void>();
  @Input({required:true}) numOfVideos!: string;
  @Input() isLoopNeeded = true;
  @Input() waitingGifPath = 'assets/spinner.gif';
  
  isPlaying = true;
  isLoading = true;
  isShowSwitch = true;

  ngOnInit(): void {
    if(this.numOfVideos == '1')
      this.isShowSwitch = false;
  }

  ngAfterViewInit() {
    // Mark the start of the first video load
    performance.mark('initial-video-load-start');
  }

  onVideoLoaded() {
    this.isLoading = false;

    //measure loading time
    const switchMarkExists = performance.getEntriesByName('video-load-start').length > 0;
    const initialMarkExists = performance.getEntriesByName('initial-video-load-start').length > 0;

    if (switchMarkExists) {
      performance.mark('video-load-end');
      performance.measure('Video Load Time', 'video-load-start', 'video-load-end');
      const duration = performance.getEntriesByName('Video Load Time')[0]?.duration ?? 0;
      console.log(`🔁 Switched video loaded in ${duration.toFixed(2)} ms`);
    } else if (initialMarkExists) {
      performance.mark('initial-video-load-end');
      performance.measure('Initial Video Load', 'initial-video-load-start', 'initial-video-load-end');
      const duration = performance.getEntriesByName('Initial Video Load')[0]?.duration ?? 0;
      console.log(`🚀 Initial video loaded in ${duration.toFixed(2)} ms`);
    } else {
      console.warn('⚠️ No performance mark found for video load timing.');
    }

    performance.clearMarks();
    performance.clearMeasures();
  }
  

  @HostListener('document:keydown.escape', ['$event'])
  handleEscape(event: KeyboardEvent) {
    this.onCancel();
  }
  
  @ViewChild('videoPlayer') videoPlayer!: ElementRef<HTMLVideoElement>;

  @HostListener('document:keydown.enter', ['$event'])
  handleEnter(event: KeyboardEvent) {
    if (this.videoPlayer) {
      this.onSwitchVideo();
    }
  }

  togglePlay() {
    const video = this.videoPlayer.nativeElement;
    if (video.paused) {
      video.play();
      this.isPlaying = true;
    } else {
      video.pause();
      this.isPlaying = false;
    }
  }
  onCancel()
  {
    this.cancel.emit();
    // Remove focus from the currently focused element
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
  }
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

  onSwitchVideo()
  {

    this.upadteVideoPath();
    this.isLoading = true; // Set loading state before changing the source

    const videoElement = this.videoPlayer.nativeElement;

    // Start performance timer
    performance.mark('video-load-start');

   // Trick: reload the <video> element manually
    setTimeout(() => {
     videoElement.load();
     videoElement.play();
   }, 0);
  }



  
}

