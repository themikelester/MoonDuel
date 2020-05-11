// --------------------------------------------------------------------------------
// Manages loading of Resources, which are the base level files required by the game.
// It is designed to do as much work as possible asynchronously, on a worker thread.
// Each type of Resource has a dedicated ResourceLoader which contains all the logic
// for downloading and processing the resource. Typically, ResourceLoader.loadAsync()
// will run on the worker (unless a synchronous load is requested) and fetch the 
// necessary file before doing as much processing as possible. It will then set the 
// Resource's state to LoadSync. The ResourceManager on the main thread then calls
// ResourceLoader.loadSync() so that any processing that must happen on the main thread
// can be performed. E.g. uploading data to the GPU. 
// --------------------------------------------------------------------------------

import Worker from './ResourceLoading.worker';
import { Resource, ResourceLoader, ResourceStatus, ResourceLoadingContext } from './Resource';
import { TextureLoader } from './Texture';
import { Renderer } from "../gfx/GfxTypes";
import { defined, assert, assertDefined } from '../util';
import { GltfLoader } from './Gltf';

export interface UriWithHeaders {
    uri: string,
    headers?: { [key: string]: string },
}

type ResourceLoadedCallback<T extends Resource> = (error: string | undefined, resource: T | undefined) => void;

const loaders: { [type: string]: ResourceLoader } = {
    texture: new TextureLoader(),
    gltf: new GltfLoader(),
};

export class ResourceManager {
    worker: Worker;
    context: ResourceLoadingContext;
    messages: MessageEvent[] = [];
    pending: Resource[] = [];

    finished: Resource[] = [];
    unloaded: Resource[] = [];
    loadingAsync: Resource[] = [];
    loadingSync: Resource[] = [];

    cache: { [key: string]: Resource } = {};
    requests: { [key: string]: ResourceLoadedCallback<Resource>[] } = {};

    initialize(renderer?: Renderer) {
        this.worker = new Worker();
        this.worker.onmessage = (e: MessageEvent) => this.onMessage(e);
        this.context = {
            renderer,
        }
    }

    onMessage(msg: MessageEvent) {
        this.messages.push(msg);
    }

    get(uri: string, type: string): Resource | undefined {
        const key = uri + type;
        return this.cache[key];
    }

    load<T extends Resource>(uriObj: string | UriWithHeaders, type: string, callback: ResourceLoadedCallback<T>): void {
        if (!defined(loaders[type])) {
            callback('Invalid resource type', undefined);
            return;
        }

        const uri = typeof uriObj === 'string' ? uriObj : uriObj.uri;
        const headers = typeof uriObj === 'string' ? undefined : uriObj.headers;

        const key = uri + type;

        if (defined(this.cache[key])) {
            // In cache
            callback(undefined, this.cache[key] as T);
        } else if (this.requests[key]) {
            // Existing request
            this.requests[key].push(callback as ResourceLoadedCallback<Resource>);
        } else {
            // New request
            this.requests[key] = [callback as ResourceLoadedCallback<Resource>];

            const resource: Resource = {
                source: { uri, headers, type },
                status: ResourceStatus.LoadingAsync,
                transferList: [],
            }
            this.worker.postMessage([resource]);
        }
    }

    unload(uriObj: string | UriWithHeaders, type: string) {
        const uri = typeof uriObj === 'string' ? uriObj : uriObj.uri;
        const key = uri + type;
        
        if (defined(this.cache[key])) {
            // In cache
            const resource = this.cache[key];
            const loader = loaders[resource.source.type];
            loader.unloadSync(this.context, resource);
            delete this.cache[key];
        } else if (this.requests[key]) {
            // Existing request
            delete this.requests[key];
        } else {
            throw new Error(`Attempted to unload a resource that was never loaded: ${key}`);
        }
    }

    update() {
        // Add resources that have been updated on the Async thread to the pending list
        // @NOTE: This is not done in the message handler to keep it as simple as possible
        //        Accessing msg.data triggers a copy (at least on V8) which can be expensive
        for (let msg of this.messages) {
            Array.prototype.push.apply(this.pending, msg.data as Resource[]);
        }

        // Process all pending resources
        for (let resource of this.pending) { 
            const key = resource.source.uri + resource.source.type;

            // If this resource has already been unloaded, skip any remaining work
            if (!defined(this.requests[key])) {
                resource.status = ResourceStatus.Unloaded;
            }
            
            // If we have some synchronous work to do, wait for the result
            if (resource.status === ResourceStatus.LoadingSync) {
                const loader = loaders[resource.source.type];
                loader.loadSync(this.context, resource);
            }

            switch (resource.status) {
                case ResourceStatus.Loaded:
                case ResourceStatus.Failed: this.finished.push(resource); break;
                case ResourceStatus.Unloaded: this.unloaded.push(resource); break;
                case ResourceStatus.LoadingAsync: this.loadingAsync.push(resource); break;
                case ResourceStatus.LoadingSync: this.loadingSync.push(resource); break;
            }
        }
        this.pending.length = 0;

        // When loaded, call all callbacks with the loaded resource
        for (let resource of this.finished) {
            const key = resource.source.uri + resource.source.type;
            const requestCount = assertDefined(this.requests[key]).length;
            assert(requestCount >= 1);

            this.cache[key] = resource;
            for (let i = 0; i < requestCount; i++) {
                if (resource.status === ResourceStatus.Failed) this.requests[key][i](resource.error, undefined);
                else this.requests[key][i](undefined, resource);
            }

            delete this.requests[key];
        }

        // Send all resources that still need to load back to the async resource loading thread
        const transferList: Transferable[] = [];
        for (let resource of this.loadingAsync) { Array.prototype.push.apply(transferList, resource.transferList); }
        this.worker.postMessage(this.loadingAsync, transferList);

        // Call unload on any partially loaded resources that have been removed
        for (let resource of this.unloaded) {
            const loader = loaders[resource.source.type];
            loader.unloadSync(this.context, resource);
        }

        // Add all resources that need another LoadSync round to the pending list for next frame
        Array.prototype.push.apply(this.pending, this.loadingSync);

        this.finished.length = 0;
        this.unloaded.length = 0;
        this.loadingAsync.length = 0;
        this.loadingSync.length = 0;
        this.messages.length = 0;
    }
}