import { Component,Input ,EventEmitter, Output, OnInit} from '@angular/core';

@Component({
  selector: 'app-app-chooser',
  standalone: true,
  imports: [],
  templateUrl: './app-chooser.component.html',
  styleUrl: './app-chooser.component.css'
})
export class AppChooserComponent implements OnInit {
    @Input({required:true}) appName!: string;
    @Input({required:true}) id!: string;
    @Output() select = new EventEmitter<string>();

    isDisabled = true;
  
    ngOnInit() {
      this.isDisabled = !(this.id === '1' || this.id === '2' || this.id === '3' || this.id === '4');
    }
    onSelectApp()//buttonClick
    { 
      this.select.emit(this.id); 
    }
}
