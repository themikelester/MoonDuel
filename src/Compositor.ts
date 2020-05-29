import * as Gfx from './gfx/GfxTypes';
import { renderLists, RenderList } from './RenderList';
import { assertDefined, defined, defaultValue } from './util';
import { DebugMenu } from './DebugMenu';

export class Compositor {
    private width: number;
    private height: number;

    public resolutionScale = 1.0;

    constructor(public canvas: HTMLCanvasElement, public gfxDevice: Gfx.Renderer) {}

    public initialize({ debugMenu }: { debugMenu: DebugMenu }): void {
        // Parse RenderLists and allocate any GFX resources they may need
        for (let list in renderLists) {
            renderLists[list].defaultDepthStateId = this.gfxDevice.createDepthStencilState(renderLists[list].defaultDepthState);
        }
        
        // Debug
        const folder = debugMenu.addFolder('Compositor');
        folder.add(this, 'resolutionScale', 1, 16, 1);
    }

    public render(): void {
        // Resize the back buffer if either the canvas size of resolution scale has changed
        this.width = this.canvas.clientWidth * devicePixelRatio / this.resolutionScale;
        this.height = this.canvas.clientHeight * devicePixelRatio / this.resolutionScale;
        if (this.width !== this.canvas.width || this.height !== this.canvas.height) {
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            if (this.gfxDevice) this.gfxDevice.resize(this.canvas.width, this.canvas.height);
        }

        this.gfxDevice.beginFrame();
            // All the drawing work goes here
            this.gfxDevice.bindRenderPass(Gfx.kDefaultRenderPass); 
            {                
                executeRenderList(this.gfxDevice, renderLists.opaque);
                executeRenderList(this.gfxDevice, renderLists.skybox);
                executeRenderList(this.gfxDevice, renderLists.effects);
                executeRenderList(this.gfxDevice, renderLists.debug);
            }
        this.gfxDevice.endFrame();

        // Clear render lists
        for (let listName in renderLists) {
            renderLists[listName].primitives.length = 0;
        }
    }

    public resize(clientWidth: number, clientHeight: number, devicePixelRatio: number) {
        // Resize the canvas client size to fit the specified dimensions
        // @NOTE: The back buffer will be resized on next render
        this.canvas.style.width = `${clientWidth}px`; 
        this.canvas.style.height = `${clientHeight}px`;
        this.canvas.style.position = 'absolute';
    }
}

function executeRenderList(gfxDevice: Gfx.Renderer, list: RenderList) {
    const primCount = list.primitives.length; 
    for (let i = 0; i < primCount; i++) {
        const prim = list.primitives[i];

        gfxDevice.bindPipeline(prim.renderPipeline);
        gfxDevice.bindVertices(prim.vertexTable);
        gfxDevice.bindResources(prim.resourceTable);

        gfxDevice.setCullMode(list.defaultCullMode);
        gfxDevice.setDepthStencilState(list.defaultDepthStateId!);

        if (defined(prim.indexBuffer)) {
            const indexSize = prim.indexType === Gfx.Type.Ushort ? 2 : 4;
            const indexOffset = defaultValue(prim.indexBuffer.byteOffset, 0) / indexSize;
            if (defined(prim.instanceCount)) {
                gfxDevice.drawInstanced(prim.type, prim.indexBuffer.buffer, assertDefined(prim.indexType), indexOffset, 
                    prim.elementCount, prim.instanceCount)
            } else {
                gfxDevice.draw(prim.type, prim.indexBuffer.buffer, assertDefined(prim.indexType), indexOffset, prim.elementCount);
            }
        } else {
            gfxDevice.drawNonIndexed(prim.type, 0, prim.elementCount);
        }
    }
}