import simple_vert from './shaders/simple.vert';
import simple_frag from './shaders/simple.frag';
import { GlobalUniforms } from './GlobalUniforms';
import * as Gfx from './gfx/GfxTypes';
import { renderLists, RenderList } from './RenderList';
import { RenderPrimitive } from './RenderPrimitive';
import { UniformBuffer } from './UniformBuffer';
import { ResourceManager } from './resources/ResourceLoading';
import { Material, Mesh, Model } from './Mesh';

class SimpleShader implements Gfx.ShaderDescriptor {
    private static vert = simple_vert;
    private static frag = simple_frag;
    
    public static uniformLayout: Gfx.BufferLayout = {
        u_color: { offset: 0, type: Gfx.Type.Float4 },
    };

    public static resourceLayout = {
        uniforms: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: SimpleShader.uniformLayout },
        globalUniforms: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
    };

    name = 'SimpleShader';
    vertSource = SimpleShader.vert.sourceCode;
    fragSource = SimpleShader.frag.sourceCode;
    resourceLayout = SimpleShader.resourceLayout;
}

export class Demo {
    private shader: Gfx.Id;
    private material: Material;
    private mesh: Mesh;
    private model: Model;
    private vertexBuffer: Gfx.Id;
    private indexBuffer: Gfx.Id;

    private uniformBuffer: UniformBuffer;

    initialize({ gfxDevice, globalUniforms, resources }: { gfxDevice: Gfx.Renderer, globalUniforms: GlobalUniforms, resources: ResourceManager }) {
        const renderFormat: Gfx.RenderFormat = {
            blendingEnabled: false
        };

        const vertexLayout: Gfx.VertexLayout = {
            buffers: [{
                stride: 12,
                layout: {
                    a_pos: { type: Gfx.Type.Float3, offset: 0 }
                }
            }]
        }

        resources.load('data/Duck.glb', 'gltf', (error, resource) => {
            if (error) { console.error(`Failed to load resource`, error); }
        });

        this.shader = gfxDevice.createShader(new SimpleShader());

        this.uniformBuffer = new UniformBuffer('PlaneUniforms', gfxDevice, SimpleShader.uniformLayout);
        this.uniformBuffer.setFloats('u_color', new Float32Array([0, 0, 1, 1]));
        this.uniformBuffer.write(gfxDevice);

        this.material = new Material(gfxDevice, this.shader);
        this.material.setUniformBuffer(gfxDevice, 'uniforms', this.uniformBuffer.getBuffer());
        this.material.setUniformBuffer(gfxDevice, 'globalUniforms', globalUniforms.buffer);
        
        const vertices = new Float32Array([
            -0.5, -0.5, 0,
             0.5, -0.5, 0,
            -0.5,  0.5, 0,
             0.5,  0.5, 0,
        ])
        this.vertexBuffer = gfxDevice.createBuffer('PlaneVertices', Gfx.BufferType.Vertex, Gfx.Usage.Static, vertices);
        this.indexBuffer = gfxDevice.createBuffer('PlaneIndices', Gfx.BufferType.Index, Gfx.Usage.Static, new Uint16Array([0, 1, 2, 2, 1, 3]).buffer);

        this.mesh = new Mesh({
            vertexLayout, 
            vertexBuffers: [this.vertexBuffer], 
            elementCount: 6, 
            indexBuffer: this.indexBuffer
        });
        this.model = new Model(gfxDevice, renderLists.opaque, this.mesh, this.material);
    }

    update({ }) {

    }

    render({ }) {
        renderLists.opaque.push(this.model.primitive);
    }
}