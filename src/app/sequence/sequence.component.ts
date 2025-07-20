import { Component, Input, OnInit } from '@angular/core';

@Component({
  selector: 'app-sequence',
  standalone: true,
  imports: [],
  templateUrl: './sequence.component.html',
  styleUrl: './sequence.component.css'
})


export class SequenceComponent implements OnInit {
  @Input({required:true}) numSegments: number = 2; 
  @Input({required:true}) thumbPath!: string;

  pathsArray: string[] = [];

  checkImageExists(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = path;
    });
  }

  shuffleArray(array: string[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  async BuildThumbPathsArray()
  {
    // Step 1: Remove '_pict.png'
    const base = this.thumbPath.replace('_pict.png', '');

    for (let i = 1; i <= this.numSegments; i++){
      const thumbPath = `${base}_${i}.png`;
      console.log('thumbs path is ',thumbPath);

      const exists = await this.checkImageExists(thumbPath);
      if (exists) 
        this.pathsArray.push(thumbPath);
    }
    this.shuffleArray(this.pathsArray);

  }

  ngOnInit(): void {
    this.BuildThumbPathsArray();    
  }
}
