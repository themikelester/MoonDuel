import simple_vert from './shaders/simple.vert';
import simple_frag from './shaders/simple.frag';
import { GlobalUniforms } from './GlobalUniforms';
import * as Gfx from './gfx/GfxTypes';
import { renderLists } from './RenderList';
import { RenderPrimitive } from './RenderPrimitive';

class SimpleShader implements Gfx.ShaderDescriptor {
    private static vert = simple_vert;
    private static frag = simple_frag;
    
    public static uniformLayout: Gfx.BufferLayout = {
        u_color: { offset: 0, type: Gfx.Type.Float4 },
    };

    public static resourceLayout = [
        { index: 0, type: Gfx.BindingType.UniformBuffer, layout: SimpleShader.uniformLayout },
        { index: 1, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    ];

    name = 'SimpleShader';
    vertSource = SimpleShader.vert.sourceCode;
    fragSource = SimpleShader.frag.sourceCode;
    resourceLayout = SimpleShader.resourceLayout;
}

export class Demo {
    private shader: Gfx.Id;
    private pipeline: Gfx.Id;
    private resources: Gfx.Id;
    private vertexBuffer: Gfx.Id;
    private uniformBuffer: Gfx.Id;
    private indexBuffer: Gfx.Id;

    initialize({ gfxDevice, globalUniforms }: { gfxDevice: Gfx.Renderer, globalUniforms: GlobalUniforms }) {
        const renderFormat: Gfx.RenderFormat = {
            blendingEnabled: false
        };

        const vertLayout: Gfx.VertexLayout = {
            buffers: [{
                stride: 12,
                layout: {
                    a_pos: { type: Gfx.Type.Float3, offset: 0 }
                }
            }]
        }

        this.shader = gfxDevice.createShader(new SimpleShader());
        this.pipeline = gfxDevice.createRenderPipeline(this.shader, renderFormat, vertLayout, SimpleShader.resourceLayout);
    
        this.uniformBuffer = gfxDevice.createBuffer('DemoUniforms', Gfx.BufferType.Uniform, Gfx.Usage.Dynamic, new Float32Array([0, 1, 0, 1]).buffer);
        this.indexBuffer = gfxDevice.createBuffer('PlaneIndices', Gfx.BufferType.Index, Gfx.Usage.Static, new Uint16Array([0, 1, 2, 2, 1, 3]).buffer);
        
        const vertices = new Float32Array([
            -0.5, -0.5, 0,
             0.5, -0.5, 0,
            -0.5,  0.5, 0,
             0.5,  0.5, 0,
        ])
        this.vertexBuffer = gfxDevice.createBuffer('PlaneVertices', Gfx.BufferType.Vertex, Gfx.Usage.Static, vertices);

        this.resources = gfxDevice.createResourceTable(this.pipeline);
        gfxDevice.setBuffer(this.resources, this.vertexBuffer, 0);
        gfxDevice.setBuffer(this.resources, this.uniformBuffer, 0);
        gfxDevice.setBuffer(this.resources, globalUniforms.buffer, 1);
    }

    update({ }) {

    }

    render({ }) {
        const primA: RenderPrimitive = {
            renderPipeline: this.pipeline,
            resourceTable: this.resources,
            elementCount: 6,
            indexBuffer: { bufferId: this.indexBuffer },
            indexType: Gfx.Type.Ushort,
            type: Gfx.PrimitiveType.Triangles
        }

        renderLists.opaque.push(primA);
    }
}