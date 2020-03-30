import * as Gfx from './gfx/GfxTypes';
import { computePackedBufferLayout, UniformBuffer } from './UniformBuffer';

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
    
    public buffer: UniformBuffer;
    public bufferView: Gfx.BufferView;
    private readonly renderer: Gfx.Renderer;

    constructor(renderer: Gfx.Renderer) {
        this.renderer = renderer;
    }

    initialize() {
        this.buffer = new UniformBuffer('GlobalUniforms', this.renderer, GlobalUniforms.bufferLayout);
        this.bufferView = this.buffer.getBufferView();
    }

    update() {
        this.buffer.write(this.renderer);
    }
}