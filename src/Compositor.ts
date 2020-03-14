import * as Gfx from './gfx/GfxTypes';
import { renderLists, RenderList } from './RenderList';
import { assertDefined, defined, defaultValue } from './util';

export class Compositor {
    constructor(public canvas: HTMLCanvasElement, public gfxDevice: Gfx.Renderer) {}

    public initialize(): void {
        // Parse RenderLists and allocate any GFX resources they may need
        for (let list in renderLists) {
            renderLists[list].defaultDepthStateId = this.gfxDevice.createDepthStencilState(renderLists[list].defaultDepthState);
        }
    }

    public render(): void {

        this.gfxDevice.beginFrame();
            // All the drawing work goes here
            this.gfxDevice.bindRenderPass(Gfx.kDefaultRenderPass); 
            {                
                executeRenderList(this.gfxDevice, renderLists.opaque);
            }
        this.gfxDevice.endFrame();

        // Clear render lists
        for (let listName in renderLists) {
            renderLists[listName].primitives.length = 0;
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
    const primCount = list.primitives.length; 
    for (let i = 0; i < primCount; i++) {
        const prim = list.primitives[i];

        gfxDevice.bindPipeline(prim.renderPipeline);
        gfxDevice.bindResources(prim.resourceTable);

        gfxDevice.setCullMode(list.defaultCullMode);
        gfxDevice.setDepthStencilState(list.defaultDepthStateId!);

        if (defined(prim.indexBuffer)) {
            const indexSize = prim.indexType === Gfx.Type.Ushort ? 2 : 4;
            const indexOffset = defaultValue(prim.indexBuffer.byteOffset, 0) / indexSize;
            gfxDevice.draw(prim.type, prim.indexBuffer.buffer, assertDefined(prim.indexType), indexOffset, prim.elementCount);
        } else {
            gfxDevice.drawNonIndexed(prim.type, 0, prim.elementCount);
        }
    }
}