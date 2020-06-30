import { Resource, ResourceStatus, ResourceLoadingContext, ResourceRequest, ResourceLoader } from './Resource';

export interface SoundResource extends Resource {
  buffer: AudioBuffer;
  audioData?: ArrayBuffer;
}

export class SoundLoader implements ResourceLoader {
  async loadAsync(resource: SoundResource): Promise<void> {
    const response = await fetch(resource.source.uri);
    if (response.status != 200) throw new Error('Failed to download sound clip');

    resource.audioData = await response.arrayBuffer();
    resource.transferList.push(resource.audioData);
    resource.status = ResourceStatus.LoadingSync;
  }

  loadSync(context: ResourceLoadingContext, resource: SoundResource): void {    
    // Skip decoding if we do not have an AudioMixer (e.g. the server)
    if (!context.mixer) {
      resource.status = ResourceStatus.Loaded;
      return
    }

    // On first entry start async decoding audio data
    // @NOTE: This has to begin on the main thread because WebAudio is not supported in workers
    if (resource.audioData) {
      context.mixer.context.decodeAudioData(resource.audioData, 
        buffer => { resource.buffer = buffer; },
        error => { resource.error = error.message; }
      );
      resource.audioData = undefined;
    }

    // The async callback will update the resource, each tick we check for completion
    if (resource.error) resource.status = ResourceStatus.Failed;
    else if (resource.buffer)  resource.status = ResourceStatus.Loaded;
    else resource.status = ResourceStatus.LoadingSync;
  }

  unloadSync(context: ResourceLoadingContext, resource: SoundResource) {
    
  }
}