import { Component ,Input} from '@angular/core';
import { VideoComponent } from '../../video/video.component';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule } from '@ngx-translate/core';
import { PayService } from '../../services/pay.service'; 
import { PayDialogComponent } from '../../pay-dialog/pay-dialog.component';
import { PricingConfig } from '../../pricing-dialog/pricing-dialog.component';
import { PricingDialogComponent } from '../../pricing-dialog/pricing-dialog.component';




interface User {
  id: string;
  avatar: string;
  name: string;
  numVideos: string;
  subtextKey: string;
  isLocked: boolean;
}

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [VideoComponent, TranslateModule, PayDialogComponent,PricingDialogComponent],
  templateUrl: './button.component.html',
  styleUrls: ['./button.component.css']
})

export class ButtonComponent {
  @Input({required:true}) user!: User;
  @Input({required:true}) videoPath!: string;
  @Input({required:true}) currentApp!: string;
  @Input({required:true}) isSubtextNeeded!: boolean;
  @Input({required:true}) isAudioNeeded!: boolean;

  readonly PRICE_ILS = 1;   // one price for everything temp 1 was 39
  readonly CURRENCY = 1;     // 1 = ILS
  isPayDialogOpen = false;
  isPaying = false;
  payError = '';

  fullVideoPath = '';
  isShowVideo = false;
  
  constructor(public translate: TranslateService, private pay: PayService) {}

  get imagePath() {
    if(this.currentApp === '1')
      return 'assets/button-icons/right-wrong/' + this.user.avatar;
    if(this.currentApp === '2')
      return 'assets/button-icons/good-bad/' + this.user.avatar;
    if(this.currentApp === '3')
      return 'assets/button-icons/actions/' + this.user.avatar;
    if(this.currentApp === '4')
      return 'assets/button-icons/emotions/' + this.user.avatar;
    return 'assets/button-icons/good-bad/' + this.user.avatar;
  }

  buildVideoPath()
  {
    this.fullVideoPath = this.videoPath + this.user.id + 'A.mp4';
  }

  async onSelectButton()//buttonClick
  { 
    // 🔒 If locked → trigger payment and exit
    if (this.user.isLocked) {
      // 🔒 instead of redirecting immediately — open dialog
      this.openPayDialog();
      return;
    }  
    let numClicks = Number(this.user.name);
    numClicks++;
    this.user.name = numClicks.toString();
    if(this.user.subtextKey.includes('RANDOM'))
      return this.onRandomButton();

    this.buildVideoPath();
    if (this.isAudioNeeded) {
      await this.playLocalizedAudio(this.user.subtextKey); // 👈 wait for audio
    }
    this.isShowVideo = true;

  }

  onRandomButton()
  {
    //relevant ovly for actions function, assumes that maximal number of actions = 42
    const randomIdNum = Math.floor(Math.random() * 42) + 1;
    const randomIdStr = String(randomIdNum);
    this.fullVideoPath = this.videoPath + randomIdStr + 'A.mp4';
    this.isShowVideo = true;

  }

  onCancelVideo()
  {
    this.isShowVideo = false; 
  }  

  async playLocalizedAudio(key: string) 
  {
    const lang = this.translate.currentLang || this.translate.getDefaultLang();
    key = key.replace("subtext.", "");
    const audioPath = `assets/audio/${lang}/${key.toLowerCase()}.mp3`;
    try {
      await this.playAudioAndWait(audioPath);
      console.log('Audio finished playing');
    } 
    catch (err) {
      console.error(err);
    }
  
    //const audio = new Audio(audioPath);
    //audio.play().catch((error) => console.error('Audio playback failed', error));
  }

  playAudioAndWait(audioPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(audioPath);
  
      audio.onended = () => resolve(); // resolves when playback finishes
      audio.onerror = (e) => reject('Audio playback error: ' + e);
  
      audio.play().catch((err) => reject('Play failed: ' + err));
    });
  }

  private makeOrderId(): string {
    // Example: ORD-<timestamp>-<4char random>
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `ORD-${Date.now()}-${rand}`;
  }

  openPayDialog() {
    this.payError = '';
    this.isPayDialogOpen = true;
  }

  cancelPayment() {
    if (this.isPaying) return;
    this.isPayDialogOpen = false;
  }

  confirmPayment(planSelected: string) {
    if (this.isPaying) return;
    this.isPaying = true;
    this.payError = '';
    const orderId = this.makeOrderId();
    const amount = this.PRICE_ILS;
    const description = 'NOMO access';
    const currency = this.CURRENCY;
    let planDays = 31;//monthly
    if(planSelected == "quarterly")
      planDays = 92;
    else if(planSelected == "yearly")
      planDays = 365;

    console.log("payment chosen, plan selected is ", planSelected);
    this.pay.startPayment({ amount, orderId, description, currency ,planDays })
      .subscribe({
        next: ({ url, lowProfileId }) => {
          sessionStorage.setItem('lastLowProfileId', String(lowProfileId));
          sessionStorage.setItem('lastOrderId', orderId);
          window.location.href = url; // go to Cardcom hosted page
        },
        error: err => {
          console.error('Payment init failed', err);
          this.payError = err?.error?.error || 'Payment init failed';
          this.isPaying = false; // allow retry
        }
      });
  }  
}

