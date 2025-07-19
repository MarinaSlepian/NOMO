import { Component, Input, OnInit } from '@angular/core';
import { SequenceThumbComponent } from '../sequence-thumb/sequence-thumb.component';

@Component({
  selector: 'app-sequence-thumbnails',
  standalone: true,
  imports: [SequenceThumbComponent],
  templateUrl: './sequence-thumbnails.component.html',
  styleUrl: './sequence-thumbnails.component.css'
})
export class SequenceThumbnailsComponent implements OnInit {
  @Input({required:true}) numSegments!: number;
  pathsArray: string[] = [];


  ngOnInit(): void 
  {
    this.BuildThumbPathsArray();
  }

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
     
      const thumbPath = `assets/sequence-stuff/seq${this.numSegments}/seq${this.numSegments}_${i}/seq${this.numSegments}.${i}_pict.png`;
      console.log(thumbPath);

      const exists = await this.checkImageExists(thumbPath);
      if (exists) 
        this.pathsArray.push(thumbPath);
    }
  }

}
