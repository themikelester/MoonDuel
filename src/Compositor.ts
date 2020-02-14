import { IS_DEVELOPMENT } from "./version";
import WebGl from './gfx/WebGl';
import { Renderer, kDefaultRenderPass } from './gfx/GfxTypes';

export class Compositor {
    constructor(public canvas: HTMLCanvasElement, public gfxDevice: Renderer) {}

    public initialize(): void {
    }

    public render(): void {
        this.gfxDevice.beginFrame();
            this.gfxDevice.bindRenderPass(kDefaultRenderPass);
            // @TODO: All the drawing work here
        this.gfxDevice.endFrame();
    }

    public resize(width: number, height: number, devicePixelRatio: number) {
        this.canvas.setAttribute('style', `width: ${width}px; height: ${height}px;`);
        this.canvas.width = width * devicePixelRatio;
        this.canvas.height = height * devicePixelRatio;
        if (this.gfxDevice) this.gfxDevice.resize(this.canvas.width, this.canvas.height);
    }
}