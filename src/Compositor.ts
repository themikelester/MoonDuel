import * as Gfx from './gfx/GfxTypes';
import { renderLists, RenderList } from './RenderList';
import { assert, defined, defaultValue } from './util';

export class Compositor {
    constructor(public canvas: HTMLCanvasElement, public gfxDevice: Gfx.Renderer) {}

    public initialize(): void {
    }

    public render(): void {
       const depthTestAndWrite = this.gfxDevice.createDepthStencilState(true, true);

        this.gfxDevice.beginFrame();
            // All the drawing work goes here
            this.gfxDevice.bindRenderPass(Gfx.kDefaultRenderPass); 
            {
                this.gfxDevice.setCullMode(Gfx.CullMode.Back);
                this.gfxDevice.setDepthStencilState(depthTestAndWrite);
                
                executeRenderList(this.gfxDevice, renderLists.opaque);
            }
        this.gfxDevice.endFrame();

        // Clear render lists
        for (let listName in renderLists) {
            renderLists[listName].length = 0;
        }
    }

    public resize(width: number, height: number, devicePixelRatio: number) {
        this.canvas.setAttribute('style', `width: ${width}px; height: ${height}px;`);
        this.canvas.width = width * devicePixelRatio;
        this.canvas.height = height * devicePixelRatio;
        if (this.gfxDevice) this.gfxDevice.resize(this.canvas.width, this.canvas.height);
    }
}

function executeRenderList(gfxDevice: Gfx.Renderer, list: RenderList) {
    const primCount = list.length; 
    for (let i = 0; i < primCount; i++) {
        const prim = list[i];

        assert(defined(prim.indexBuffer), 'Only indexed draws are currently supported');
        
        gfxDevice.bindPipeline(prim.renderPipeline);
        gfxDevice.bindResources(prim.resourceTable);

        const indexSize = prim.indexType === Gfx.Type.Ushort ? 2 : 4;
        const indexOffset = defaultValue(prim.indexBuffer!.byteOffset, 0) / indexSize;
        gfxDevice.draw(prim.type, prim.indexBuffer!.bufferId, prim.indexType, indexOffset, prim.elementCount);
    }
}