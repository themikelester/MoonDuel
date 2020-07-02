import { platform } from "./Platform";
import { clamp } from "./MathHelpers";
import { SoundResource } from "./resources/Sound";
import { assert, assertDefined, defaultValue, defined } from "./util";
import { DebugMenu } from "./DebugMenu";
import { Camera } from "./Camera";
import { vec3 } from "gl-matrix";

// @HACK: Still necessary to support Safari and iOS
// @ts-ignore
window.AudioContext = window.AudioContext || window.webkitAudioContext;

interface AudioOptions {
  loop?: boolean;
  volume?: number;
  pitch?: number;
};

interface AudioOptions3d extends AudioOptions {
  size?: number;
  rolloffFactor?: number;
};

/**
 * High-level game module which updates the listener position each frame. This would also be the place to manage
 * separate sound categories such as music and environment.
 */
export class SoundManager {
  mixer: AudioMixer = new AudioMixer();
  
  private listenerPos = vec3.create();

  initialize({ debugMenu }: { debugMenu: DebugMenu }) {
    this.mixer.initialize();

    const debug = debugMenu.addFolder('Audio');
    debug.add(this.mixer, 'volume', 0.0, 1.0);
  }

  terminate({}) {
    this.mixer.terminate();
  }

  update({ camera }: { camera: Camera }) {
    this.mixer.setListenerPosition(camera.getPos(this.listenerPos));
    this.mixer.setListenerOrientation(camera.forward);
  }
}

/**
 * The AudioMixer is used to play and mix multiple sounds, as well as manage the listener position for 3D effects. 
 * Based on PlayCanvas' SoundManager. See https://github.com/playcanvas/engine/blob/master/src/sound/manager.js
 */
export class AudioMixer {
  private context: AudioContext;
  private gain: GainNode;
  
  private _volume: number = 1.0;
  private resumeContext: () => void;
  private iosAutoplay: () => void;

  initialize() {
    this.context = new AudioContext();

    // Global volume gain node. This will be added to the graph for all playing sounds.
    this.gain = this.context.createGain();
    this.gain.connect(this.context.destination);

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

  terminate() {
    window.removeEventListener('mousedown', this.resumeContext);
    window.removeEventListener('touchend', this.resumeContext);
    if (platform.ios) window.removeEventListener('touchend', this.iosAutoplay);

    if (this.context) { this.context.close(); }
  }

  playSound(sound: SoundResource, options: AudioOptions = {}) {
    const channel = new AudioChannel(this.context, this.gain, sound, options);
    channel.play();
    return channel;
  }

  playSound3d(sound: SoundResource, options: AudioOptions3d = {}) {
    const channel = new AudioChannel3d(this.context, this.gain, sound, options);
    channel.play();
    return channel;
  }

  setListenerPosition(pos: vec3) {
    this.context.listener.setPosition(pos[0], pos[1], pos[2]);
  }

  setListenerOrientation(ori: vec3) {
    this.context.listener.setOrientation(ori[0], ori[1], ori[2], 0, 1, 0);
  }

  getContext() { return this.context; }

  /**
   * Global volume for all playing sounds, clamped to [0..1]
   */
  get volume() { return this._volume; }
  set volume(volume: number) { 
    this._volume = clamp(volume, 0.0, 1.0); 
    this.gain.gain.value = this._volume;
  }
}

/**
 * A channel is created when the AudioMixer begins playback of a sound.
 * See AudioMixer.playSound()
 */
export class AudioChannel {
  protected context: AudioContext;
  protected sound: SoundResource;
  protected gain: GainNode;
  
  protected volume: number;
  protected pitch: number;
  protected loop: boolean;

  protected source?: AudioBufferSourceNode;

  protected startTime: number;
  protected startOffset: number;
  
  constructor(context: AudioContext, destNode: AudioNode, sound: SoundResource, options: AudioOptions) {
    this.context = context;
    this.sound = sound;

    this.loop = defaultValue(options.loop, false);
    this.volume = defaultValue(options.volume, 1.0);
    this.pitch = defaultValue(options.pitch, 1.0);

    // Create a new gain node that outputs to the mixer
    this.gain = this.context.createGain();
    this.gain.connect(destNode);
  }

  protected createSource() {
    const context = this.context;
    assertDefined(this.sound.buffer);
    
    this.source = context.createBufferSource();
    this.source.buffer = this.sound.buffer;
    this.source.connect(this.gain);

    this.setLoop(this.loop);
    this.setPitch(this.pitch);
    this.setVolume(this.volume);
  }
  
  play() {
    assert(!defined(this.source), 'Call stop()/pause() before play()');

    this.createSource();
    this.source!.start(0, this.startOffset);

    this.startTime = this.context.currentTime;
  }

  pause() {
    this.stop();
    this.startOffset = this.context.currentTime - this.startTime;
  }

  stop() {
    if (this.source) {
      this.source.stop();
      this.source = undefined;
    }

    this.startOffset = 0.0;
  }

  getLoop() { return this.loop; }
  setLoop(loop: boolean) { 
    this.loop = loop;
    if (this.source) {
      this.source.loop = loop;
    }
  }

  getPitch() { return this.pitch; }
  setPitch(pitch: number) {
    this.pitch = pitch;
    if (this.source) {
      this.source.playbackRate.value = pitch;
    }
  }

  getVolume() { return this.volume; }
  setVolume(volume: number) {
    volume = clamp(volume, 0.0, 1.0);
    this.volume = volume;
    this.gain.gain.value = volume;
  }

  getDuration() { return assertDefined(this.sound.buffer).duration; }
  isPlaying() { return defined(this.source); }
}

export class AudioChannel3d extends AudioChannel {
  panner: PannerNode;

  constructor(context: AudioContext, destNode: AudioNode, sound: SoundResource, options: AudioOptions3d) {
    // Our 3D panner becomes the destination of the base AudioChannel...
    const panner = context.createPanner();
    super(context, panner, sound, options);

    // ... And the panner outputs to the Mixer
    this.panner = panner;
    panner.connect(destNode);

    panner.refDistance = defaultValue(options.size, 100);
    panner.rolloffFactor = defaultValue(options.rolloffFactor, 1);
  }

  setPosition(pos: vec3) { this.panner.setPosition(pos[0], pos[1], pos[2]); }
}