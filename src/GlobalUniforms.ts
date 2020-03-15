import * as Gfx from './gfx/GfxTypes';
import { computePackedBufferLayout } from './UniformBuffer';

// --------------------------------------------------------------------------------
// A buffer of uniforms that may be useful to many shaders, e.g. camera parameters.
// It is the systems' responsibilty to update the values each frame, via setUniform.
// `GlobalUniforms.bufferLayout` is static so that shaders can reference it in their
// resource layout. 
// --------------------------------------------------------------------------------

export class GlobalUniforms {
    public static bufferLayout: Gfx.BufferLayout = computePackedBufferLayout({
        g_camPos: { type: Gfx.Type.Float3 },
        g_proj: { type: Gfx.Type.Float4x4 },
        g_viewProj: { type: Gfx.Type.Float4x4 },
    });

    private readonly renderer: Gfx.Renderer;
    private bufferSize: number = 0;
    private _buffer: Gfx.Id;

    constructor(renderer: Gfx.Renderer) {
        this.renderer = renderer;
    }

    initialize() {
        // Compute size
        this.bufferSize = 0;
        const names = Object.keys(GlobalUniforms.bufferLayout);
        for (let i = 0; i < names.length; i++) {
            const uniform = GlobalUniforms.bufferLayout[names[i]];
            this.bufferSize += Gfx.TranslateTypeToSize(uniform.type);
        }

        this._buffer = this.renderer.createBuffer('GlobalUniforms', Gfx.BufferType.Uniform, Gfx.Usage.Dynamic, this.bufferSize);
    }

    setUniform(name: string, data: ArrayBufferView): void {
        const uniform = GlobalUniforms.bufferLayout[name];
        if (!uniform) throw new Error(`Attempted to set unknown global uniform ${name}`);
        const byteData = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        this.renderer.writeBufferData(this.buffer, uniform.offset, byteData);
    }

    get buffer(): Gfx.Id {
        return this._buffer;
    }
}