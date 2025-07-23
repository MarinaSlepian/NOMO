import { Component, Output, EventEmitter } from '@angular/core';
import { SequenceThumbComponent} from '../sequence-thumb/sequence-thumb.component';
import { SequenceComponent } from '../sequence/sequence.component';

const STATES = {
  CHOOSER: 'chooser',
  THUMBNAILS: 'thumbnails',
  SEQUENCE: 'sequence',
  VIDEO: 'video',
} as const;

type State = typeof STATES[keyof typeof STATES];

@Component({
  selector: 'app-sequence-chooser',
  standalone: true,
  imports: [SequenceThumbComponent, SequenceComponent],
  templateUrl: './sequence-chooser.component.html',
  styleUrls: ['./sequence-chooser.component.css'] // ✅ fixed here
})
export class SequenceChooserComponent  {
  
  @Output() isShowDashboard = new EventEmitter<boolean>();


  readonly STATES = STATES;
  currentSeqState: State = this.STATES.CHOOSER;
  numSegments: number = 2; // Default value, can be changed as needed
  pathsArray: string[] = [];
  chosenThumbPath: string = '';
  videoPath: string = '';
  


  checkImageExists(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = path;
    });
  }

  async BuildThumbPathsArray()
  {
    for (let i = 1; i <= 25; i++) {
     
      const thumbPath = `assets/sequence-stuff/seq${this.numSegments}/seq${this.numSegments}_${i}/seq${this.numSegments}_${i}_pict.png`;
      console.log(thumbPath);

      const exists = await this.checkImageExists(thumbPath);
      if (exists) 
        this.pathsArray.push(thumbPath);
    }
  }


  onThumbSelected(path: string): void {
    console.log('Parent received click on:', path);
    this.chosenThumbPath = path;
    this.currentSeqState = this.STATES.SEQUENCE;
    this.isShowDashboard.emit(false); // Emit false to hide the dashboard
  }

  onCellClick(cellNumber: number): void {
    console.log(`Cell ${cellNumber} clicked`);
    this.numSegments = cellNumber; // Update numThumbs based on the clicked cell
    this.BuildThumbPathsArray();
    this.currentSeqState = this.STATES.THUMBNAILS;
    this.isShowDashboard.emit(true); // Emit false to hide the dashboard

  }
  onShowVideoClicked(videoPath: string) {
    console.log('onShowVideoClicked video path', videoPath);
    this.videoPath = videoPath;
    this.currentSeqState = this.STATES.VIDEO;
    this.isShowDashboard.emit(true); // Emit false to hide the dashboard

  }

  onGoBackClicked(){
    console.log('Go back clicked, returning to chooser state');
    this.currentSeqState = this.STATES.THUMBNAILS;
    this.isShowDashboard.emit(true); // Emit false to hide the dashboard
  }
}
