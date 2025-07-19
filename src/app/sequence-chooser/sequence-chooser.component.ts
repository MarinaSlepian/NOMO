import { Component, OnInit } from '@angular/core';
import { SequenceThumbnailsComponent } from '../sequence-thumbnails/sequence-thumbnails.component';

const STATES = {
  CHOOSER: 'chooser',
  THUMBNAILS: 'thumbnails',
  SEQUENCE: 'sequence',
} as const;

type State = typeof STATES[keyof typeof STATES];

@Component({
  selector: 'app-sequence-chooser',
  standalone: true,
  imports: [SequenceThumbnailsComponent],
  templateUrl: './sequence-chooser.component.html',
  styleUrls: ['./sequence-chooser.component.css'] // ✅ fixed here
})
export class SequenceChooserComponent implements OnInit {

  readonly STATES = STATES;
  currentSeqState: State = this.STATES.CHOOSER;
  numSegments: number = 2; // Default value, can be changed as needed

  ngOnInit(): void {}

  onCellClick(cellNumber: number): void {
    console.log(`Cell ${cellNumber} clicked`);
    this.numSegments = cellNumber; // Update numThumbs based on the clicked cell
    this.currentSeqState = this.STATES.THUMBNAILS;
  }
}
