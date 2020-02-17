import * as Gfx from './gfx/GfxTypes';
import simple_vert from './shaders/simple.vert';
import simple_frag from './shaders/simple.frag';
import { GlobalUniforms } from './GlobalUniforms';
import { GltfLoader } from './Gltf';
import { Model } from './Model';
import { renderLists } from './RenderList';
import { RenderPrimitive } from './RenderPrimitive';
import { UniformBuffer } from './UniformBuffer';
import { mat4, vec3 } from 'gl-matrix';

// @TEST
import gltfModel from './Duck.glb';

const identityMtx = mat4.fromScaling(mat4.create(), vec3.fromValues(1,1,1));

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
    private pipeline: Gfx.Id;
    private resources: Gfx.Id;
    private vertexBuffer: Gfx.Id;
    private indexBuffer: Gfx.Id;

    private uniformBuffer: UniformBuffer;

    // @TEST
    private gltfModel: Model;

    async initialize({ gfxDevice, globalUniforms }: { gfxDevice: Gfx.Renderer, globalUniforms: GlobalUniforms }) {
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
        
        const vertices = new Float32Array([
            -0.5, -0.5, 0,
             0.5, -0.5, 0,
            -0.5,  0.5, 0,
             0.5,  0.5, 0,
        ])
        this.vertexBuffer = gfxDevice.createBuffer('PlaneVertices', Gfx.BufferType.Vertex, Gfx.Usage.Static, vertices);
        this.indexBuffer = gfxDevice.createBuffer('PlaneIndices', Gfx.BufferType.Index, Gfx.Usage.Static, new Uint16Array([0, 1, 2, 2, 1, 3]).buffer);

        this.uniformBuffer = new UniformBuffer('PlaneUniforms', gfxDevice, SimpleShader.uniformLayout);
        this.uniformBuffer.setFloats('u_color', new Float32Array([0, 0, 1, 1]));
        this.uniformBuffer.write(gfxDevice);

        this.resources = gfxDevice.createResourceTable(this.pipeline);
        gfxDevice.setBuffer(this.resources, this.vertexBuffer, 0);
        gfxDevice.setBuffer(this.resources, this.uniformBuffer.getBuffer(), 0);
        gfxDevice.setBuffer(this.resources, globalUniforms.buffer, 1);

        // GLTF
        const res = await fetch(gltfModel);
        const buf = await res.arrayBuffer();

        const loader = new GltfLoader();
        loader.initialize(gfxDevice, globalUniforms);
        this.gltfModel = loader.loadModelFromGlb('Test', buf, gfxDevice);

        // @HACK:
        // for (let mesh of this.gltfModel.meshes) {
        //     mesh.uniformBuffer.setFloats('u_modelMtx', new Float32Array(identityMtx));
        //     mesh.uniformBuffer.write(gfxDevice);
        // }
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

        if (this.gltfModel) {
            for (let mesh of this.gltfModel.meshes) {
                mesh.primitives.forEach(p => renderLists.opaque.push(p));
            }
        }
    }
}