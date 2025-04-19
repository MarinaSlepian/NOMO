import { Component, EventEmitter, Output } from '@angular/core';
import { AppChooserComponent } from "../buttons/app-chooser/app-chooser.component";


@Component({
    selector: 'app-header',
    standalone: true,
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.css'],
    imports: [AppChooserComponent]
  })



export class HeaderComponent
{
  @Output() selectNewApp = new EventEmitter<string>();

  selectedApp = "1";

  selectApp(id: string)
  {
    console.log('HeaderComponent - selectApp - id '+ id);
    this.selectedApp = id;
    this.selectNewApp.emit(id); 
  }
  onSettingsButton()
  {
    
  }

} 