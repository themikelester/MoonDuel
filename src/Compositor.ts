import { IS_DEVELOPMENT } from "./version";
import WebGl from './gfx/WebGl';
import { Renderer, kDefaultRenderPass } from './gfx/GfxTypes';

export const enum InitErrorCode {
    SUCCESS,
    NO_WEBGL_GENERIC,
}

export class Compositor {
    public gfxDevice: Renderer;

    constructor(public canvas: HTMLCanvasElement) {}

    public initialize(): InitErrorCode {
        this.gfxDevice = new WebGl();
        this.gfxDevice.setDebugEnabled(IS_DEVELOPMENT);
        const success = this.gfxDevice.initialize(this.canvas);
        if (success) this.gfxDevice.resize(this.canvas.width, this.canvas.height);
        return success ? InitErrorCode.SUCCESS : InitErrorCode.NO_WEBGL_GENERIC;
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