import * as Gfx from './gfx/GfxTypes';
import { RenderList, renderLists } from './RenderList';
import { RenderPrimitive } from './RenderPrimitive';
import { assertDefined, assert, defined, defaultValue } from './util';
import { vec3, quat, mat4 } from 'gl-matrix';
import { Skeleton } from './Skeleton';
import { Object3D } from './Object3D';
import { UniformBuffer } from './UniformBuffer';

type BufferOrBufferView = Gfx.BufferView | Gfx.Id;
function toBufferView(val: BufferOrBufferView): Gfx.BufferView {
    return (val as Gfx.BufferView).buffer ? val as Gfx.BufferView: { buffer: val as Gfx.Id }
}

export interface IMesh {
    vertexLayout: Gfx.VertexLayout;
    vertexBuffers: Gfx.BufferView[];
    elementCount: number;

    indexBuffer?: Gfx.BufferView;
    indexType?: Gfx.Type;

    primitiveType: Gfx.PrimitiveType;
}

export class Mesh implements IMesh {
    vertexLayout: Gfx.VertexLayout;
    vertexBuffers: Gfx.BufferView[];
    elementCount: number;

    indexBuffer?: Gfx.BufferView;
    indexType?: Gfx.Type;

    primitiveType: Gfx.PrimitiveType;

    constructor(desc: IMesh) {
        this.vertexLayout = desc.vertexLayout;
        this.vertexBuffers = desc.vertexBuffers;
        this.elementCount = desc.elementCount;
        this.primitiveType = defaultValue(desc.primitiveType, Gfx.PrimitiveType.Triangles);
        
        assert(desc.vertexBuffers.length === desc.vertexLayout.buffers.length);

        if (desc.indexBuffer) {
            this.indexBuffer = desc.indexBuffer;
            this.indexType = defaultValue(desc.indexType, Gfx.Type.Ushort);
        }
    }
}

// Material is basically an instance of a Shader. All the necessary Uniforms and Textures are collected here.
// @NOTE: It does not perform any allocation. These resources may be shared between multiple materials.
export class Material {
    name: string;
    shader: Gfx.Id;
    layout: Gfx.ResourceLayout;

    resources: Gfx.Id;
    bindings: { [name: string]: UniformBuffer | Gfx.TextureView | Gfx.TextureView[] }; // @TODO: CPU texture type

    constructor(device: Gfx.Renderer, name: string, shader: Gfx.Id, resourceLayout: Gfx.ResourceLayout) {
        this.shader = shader;
        this.name = name;
        this.layout = resourceLayout;
        this.resources = device.createResourceTable(this.layout);
        this.bindings = {};
    }

    assertReady() {
        for (const name of Object.keys(this.layout)) {
            assertDefined(this.bindings[name], `Material expects a binding for ${name}`);
        }
    }

    getUniformBuffer(name: string): UniformBuffer {
        const binding = this.bindings[name];
        assertDefined(binding, `Uniform buffer "${name}" is not bound to material "${this.name}"`);
        return binding as UniformBuffer;
    }

    setUniformBuffer(device: Gfx.Renderer, name: string, buffer: UniformBuffer) {
        const binding = assertDefined(this.layout[name], 'Invalid resource name');
        assert(binding.type === Gfx.BindingType.UniformBuffer, 'Mismatching resource type');
        this.bindings[name] = buffer;
        device.setBuffer(this.resources, binding.index, buffer.getBufferView());
    }

    setTexture(device: Gfx.Renderer, name: string, value: Gfx.TextureView) {
        const binding = assertDefined(this.layout[name], 'Invalid resource name') as Gfx.TextureResourceBinding;
        assert(binding.type === Gfx.BindingType.Texture, 'Mismatching resource type');
        assert(!defined(binding.count), 'Use Material.setTextureArray');
        this.bindings[name] = value;
        device.setTexture(this.resources, binding.index, value as Gfx.TextureView);
    }

    setTextureArray(device: Gfx.Renderer, name: string, value: Gfx.TextureView[]) {
        const binding = assertDefined(this.layout[name], 'Invalid resource name') as Gfx.TextureResourceBinding;
        assert(binding.type === Gfx.BindingType.Texture, 'Mismatching resource type');
        assert(defined(binding.count), 'Use Material.setTextureArray');
        this.bindings[name] = value;
        device.setTextures(this.resources, binding.index, value);
    }
}

export class Model extends Object3D {
    mesh: IMesh;
    material: Material;

    pipeline: Gfx.Id;
    vertexTable: Gfx.Id;
    renderList: RenderList;

    private _primitive: RenderPrimitive;
    get primitive(): RenderPrimitive {
        this.material.assertReady();
        return this._primitive;
    }

    constructor(device: Gfx.Renderer, renderList: RenderList, mesh: IMesh, material: Material) {
        super();

        this.renderList = renderList;
        this.mesh = mesh;
        this.material = material;

        // @TODO: Pipeline caching
        this.pipeline = device.createRenderPipeline(material.shader, renderList.renderFormat, mesh.vertexLayout, material.layout);
        
        this.vertexTable = device.createVertexTable(this.pipeline);
        mesh.vertexBuffers.forEach((buf, i) => {
            device.setVertexBuffer(this.vertexTable, i, buf);
        });

        this._primitive = {
            renderPipeline: this.pipeline,
            resourceTable: this.material.resources,
            vertexTable: this.vertexTable,
            
            elementCount: this.mesh.elementCount,
            type: this.mesh.primitiveType,

            indexBuffer: this.mesh.indexBuffer,
            indexType: this.mesh.indexType,
        }
    }
}

export class SkinnedModel extends Model {
    skeleton: Skeleton;
    ibms: mat4[];

    constructor(device: Gfx.Renderer, renderList: RenderList, mesh: Mesh, material: Material) {
        super(device, renderList, mesh, material);
    }

    bindSkeleton(skeleton: Skeleton) {
        this.skeleton = skeleton;
    }
}