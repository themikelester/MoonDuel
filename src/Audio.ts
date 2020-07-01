import { platform } from "./Platform";
import { clamp } from "./MathHelpers";
import { SoundResource } from "./resources/Sound";
import { assert, assertDefined, defaultValue } from "./util";

// @HACK: Still necessary to support Safari and iOS
// @ts-ignore
window.AudioContext = window.AudioContext || window.webkitAudioContext;

interface AudioOptions {
  loop?: boolean;
  volume?: number;
  pitch?: number;
};

/**
 * The AudioMixer is used to play audio. As well as apply system-wide settings
 * like global volume, suspend and resume. Based on PlayCanvas' SoundManager.
 * See https://github.com/playcanvas/engine/blob/master/src/sound/manager.js
 */
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

  playSound(sound: SoundResource, options: AudioOptions = {}) {
    const channel = new AudioChannel(this, sound, options);
    channel.play();
    return channel;
  }

  /**
   * Global volume for all playing sounds, clamped to [0..1]
   */
  get volume() { return this._volume; }
  set volume(volume: number) { this._volume = clamp(volume, 0.0, 1.0); }
}

class AudioChannel {
  mixer: AudioMixer;
  sound: SoundResource;

  loop: boolean;
  volume: number;
  pitch: number;

  source: AudioBufferSourceNode;

  constructor(mixer: AudioMixer, sound: SoundResource, options: AudioOptions) {
    this.mixer = mixer;
    this.sound = sound;

    this.loop = defaultValue(options.loop, false);
    this.volume = defaultValue(options.volume, 1.0);
    this.pitch = defaultValue(options.pitch, 1.0);
  }

  play() {
    this.createSource();

    this.source.start(0);
  }

  private createSource() {
    const context = this.mixer.context;
    assertDefined(this.sound.buffer);

    this.source = context.createBufferSource();
    this.source.buffer = this.sound.buffer;
    this.source.connect(context.destination);
  }
}