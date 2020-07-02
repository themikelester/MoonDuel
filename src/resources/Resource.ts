import { Renderer } from "../gfx/GfxTypes";
import { AudioMixer } from "../Audio";

export interface ResourceRequest {
  uri: string;
  headers?: { [key: string]: string };
  type: string;
}

export enum ResourceStatus {
  LoadingAsync,
  LoadingSync,
  Loaded,
  Unloaded,
  Failed,
}

export interface ResourceLoadingContext {
  renderer?: Renderer;
  mixer?: AudioMixer;
}

export interface Resource {
  source: ResourceRequest;
  status: ResourceStatus;
  error?: string;
  transferList: Transferable[];
}

export interface ResourceLoader {
  loadAsync(resource: Resource): Promise<void>;
  loadSync(context: ResourceLoadingContext, resource: Resource): void;
  unloadSync(context: ResourceLoadingContext, resource: Resource): void;
}