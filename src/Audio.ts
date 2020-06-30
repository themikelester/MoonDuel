import { platform } from "./Platform";
import { clamp } from "./MathHelpers";

//@ts-ignore
window.AudioContext = window.AudioContext || window.webkitAudioContext;

export class AudioMixer {
  context: AudioContext;
  
  private _volume: number = 1.0;
  private resumeContext: () => void;
  private iosAutoplay: () => void;

  initialize({}) {
    this.context = new AudioContext();

    // Resume AudioContext on user interaction because of new Chrome autoplay policy
    this.resumeContext = () => {
      this.context.resume();
      window.removeEventListener('mousedown', this.resumeContext);
      window.removeEventListener('touchend', this.resumeContext);
    };
    window.addEventListener('mousedown', this.resumeContext);
    window.addEventListener('touchend', this.resumeContext);

    // iOS only starts sound as a response to user interaction
    if (platform.ios) {
      // Play an inaudible sound when the user touches the screen
      // This only happens once
      this.iosAutoplay = () => {
        var buffer = this.context.createBuffer(1, 1, 44100);
        var source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.context.destination);
        source.start(0);
        source.disconnect();

        window.removeEventListener('touchend', this.iosAutoplay);
      };
      window.addEventListener('touchend', this.iosAutoplay);
    }
  }

  terminate({}) {
    window.removeEventListener('mousedown', this.resumeContext);
    window.removeEventListener('touchend', this.resumeContext);
    if (platform.ios) window.removeEventListener('touchend', this.iosAutoplay);

    if (this.context) { this.context.close(); }
  }

  playSound(buffer: AudioBuffer) {
    const source = this.context.createBufferSource(); // creates a sound source
    source.buffer = buffer;                    // tell the source which sound to play
    source.connect(this.context.destination);       // connect the source to the context's destination (the speakers)
    source.start(0);      
  }

  /**
   * Global volume for all playing sounds, clamped to [0..1]
   */
  get volume() { return this._volume; }
  set volume(volume: number) { this._volume = clamp(volume, 0.0, 1.0); }
}