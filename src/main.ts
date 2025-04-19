import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideTranslate } from './app/translate.provider';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async'; // ✅ Import this

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    provideAnimations(),
    provideTranslate(), provideAnimationsAsync() // ✅ Add this line!
  ]
});
