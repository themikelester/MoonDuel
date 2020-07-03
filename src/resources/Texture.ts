import { Resource, ResourceStatus, ResourceLoadingContext, ResourceRequest, ResourceLoader } from './Resource';
import * as Gfx from '../gfx/GfxTypes';
import { defined } from '../util';

export interface TextureResource extends Resource {
  name: string
  width: number;
  height: number;
  imageBuffer?: ArrayBuffer;
  imageBitmap?: ImageBitmap;
  imageElement?: HTMLImageElement;
  texture?: Gfx.Id;
  hasMips?: boolean;
}

export class TextureLoader implements ResourceLoader {  
  async loadAsync(resource: TextureResource): Promise<void> {
    const response = await fetch(resource.source.uri);
    if (response.status != 200) throw new Error('Failed to download image');

    const filenameMatch = resource.source.uri.match(/.*\/(.+?)\./);
    resource.name = filenameMatch && filenameMatch.length > 1 ? filenameMatch[1] : 'Unknown';

    // Fall back to decoding the JPEG on the main thread if createImageBitmap is unavailable (Safari)
    if (!self.createImageBitmap) { 
      resource.imageBuffer = await response.arrayBuffer();
      resource.transferList.push(resource.imageBuffer);
      resource.status = ResourceStatus.LoadingSync; 
    } else {
      resource.imageBitmap = await createImageBitmap(await response.blob());
      resource.transferList.push(resource.imageBitmap);
      resource.status = ResourceStatus.LoadingSync
    }
  }

  loadSync(context: ResourceLoadingContext, resource: TextureResource): void {    
    if (resource.imageBitmap) {
      resource.texture = !context.renderer ? -1 : context.renderer.createTexture(resource.name, {
        usage: Gfx.Usage.Static,
        type: Gfx.TextureType.Texture2D,
        format: Gfx.TexelFormat.U8x4,
        maxAnistropy: 16,
        defaultWrapS: Gfx.TextureWrap.Clamp,
        defaultWrapT: Gfx.TextureWrap.Clamp,
      }, resource.imageBitmap);

      resource.width = resource.imageBitmap.width;
      resource.height = resource.imageBitmap.height;

      resource.imageBitmap.close();
      delete resource.imageBitmap;

      resource.status = ResourceStatus.Loaded;
    } else {
      // This browser (Safari) doesn't support createImageBitmap(), which means we have to do JPEG decompression
      // here on the main thread. Use an HtmlImageElement to do this before submitting to WebGL.
      if (resource.imageBuffer) {
        // @TODO: Support other file type (PNG) by using the mimetype from the response
        var blob = new Blob([resource.imageBuffer], { type: "image/jpeg" });
        let imageUrl = window.URL.createObjectURL( blob );
        delete resource.imageBuffer;

        // Create an image element to do async JPEG/PNG decoding
        resource.imageElement = new Image();
        resource.imageElement.src = imageUrl;
        
        // Continue calling loadSync until the image is loaded and decoded
        resource.status = ResourceStatus.LoadingSync;
      }
      
      if (defined(resource.imageElement) && resource.imageElement.complete) {
        resource.texture = !context.renderer ? -1 : context.renderer.createTexture(resource.name, {
          usage: Gfx.Usage.Static,
          type: Gfx.TextureType.Texture2D,
          format: Gfx.TexelFormat.U8x4,
          maxAnistropy: 16,
        }, resource.imageElement);

      resource.width = resource.imageElement.width;
      resource.height = resource.imageElement.height;
  
        delete resource.imageElement;
  
        resource.status = ResourceStatus.Loaded;
      }
    }
  }

  unloadSync(context: ResourceLoadingContext, resource: TextureResource) {
    if (defined(resource.texture) && context.renderer) { context.renderer.removeTexture(resource.texture); }
    if (defined(resource.imageBitmap)) { resource.imageBitmap.close(); }
  }
}