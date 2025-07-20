import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-sequence-thumb',
  standalone: true,
  imports: [],
  templateUrl: './sequence-thumb.component.html',
  styleUrl: './sequence-thumb.component.css'
})
export class SequenceThumbComponent {

  @Input({required:true}) thumbPath!: string;
  @Output() thumbClicked = new EventEmitter<string>();



  constructor() {
    // You can set the thumbPath dynamically if needed
    // this.thumbPath = 'path/to/your/thumbnail.png';
  }

  onThumbClick(): void {
    console.log('Thumbnail clicked:', this.thumbPath);
    this.thumbClicked.emit(this.thumbPath);
  }
}
