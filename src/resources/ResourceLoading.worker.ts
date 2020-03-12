import { ResourceLoader, Resource, ResourceStatus } from './Resource';
import { TextureLoader } from './Texture';

// Trick typescript into assuming that we're using the Worker global interface, not Window
// See https://github.com/Microsoft/TypeScript/issues/20595
const ctx = self as any as Worker;

const loaders: { [type: string]: ResourceLoader } = {
  texture: new TextureLoader(),
};

// --------------------------------------------------------------------------------
// Main thread interface
// --------------------------------------------------------------------------------
onmessage = async (msg) => { manager.onMessage(msg) }

class AsyncResourceManager {
  processed: Resource[] = [];

  static kTickIntervalMs: number = 33; // Send messages at most every 33ms

  constructor() {
    setInterval(() => this.update(), AsyncResourceManager.kTickIntervalMs);
  }

  async onMessage(msg: MessageEvent) {
    const resources = msg.data as Resource[];
    for (let resource of resources) {
      const loader = loaders[resource.source.type];
      if (!loader) { resource.status = ResourceStatus.Failed; }

      // If we have some asynchronous work to do, wait for the result
      if (resource.status === ResourceStatus.LoadingAsync) {
        try { await loader.loadAsync(resource); }
        catch(error) { 
          resource.status = ResourceStatus.Failed; 
          resource.error = error.message;
        }
      }

      this.processed.push(resource);
    }
  }

  update() {
    if (this.processed.length > 0) {
      const transferList: Transferable[] = [];
      for (let resource of this.processed) { Array.prototype.push.apply(transferList, resource.transferList); }
      ctx.postMessage(this.processed, transferList);
  
      this.processed.length = 0;
    }
  }
}

const manager = new AsyncResourceManager();

// Trickery to fix TypeScript since this will be done by "worker-loader"
export default {} as typeof Worker & (new () => Worker);