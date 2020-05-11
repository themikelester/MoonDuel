import * as Gfx from './gfx/GfxTypes';
import { RenderList, renderLists } from './RenderList';
import { RenderPrimitive } from './RenderPrimitive';
import { assertDefined, assert, defined, defaultValue } from './util';
import { vec3, quat, mat4 } from 'gl-matrix';
import { Skeleton } from './Skeleton';
import { Object3D } from './Object3D';
import { UniformBuffer } from './UniformBuffer';
import { Component } from './Component';
import { Entity } from './Entity';
import { FamilyBuilder, Family } from './Family';
import { World, System } from './World';
import { CTransform } from './Transform';

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

    destroy(device: Gfx.Renderer) {
        device.removeResourceTable(this.resources);
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

    destroy(device: Gfx.Renderer) {
        device.removeVertexTable(this.vertexTable);
        device.removeRenderPipeline(this.pipeline);
    }
}

export class SkinnedModel extends Model {
    skeleton: Skeleton;
    ibms: mat4[];
    boneTex: Gfx.Id;

    constructor(device: Gfx.Renderer, renderList: RenderList, mesh: Mesh, material: Material) {
        super(device, renderList, mesh, material);
    }

    bindSkeleton(device: Gfx.Renderer, skeleton: Skeleton) {
        this.skeleton = skeleton;

        const desc: Gfx.TextureDescriptor = {
            type: Gfx.TextureType.Texture2D,
            format: Gfx.TexelFormat.F32x4,
            usage: Gfx.Usage.Dynamic,
            width: 4,
            height: skeleton.bones.length,
            defaultMinFilter: Gfx.TextureFilter.Nearest,
            defaultMagFilter: Gfx.TextureFilter.Nearest,
        };

        this.boneTex = device.createTexture('BoneTex', desc, this.skeleton.boneMatrices);
    }

    writeBonesToTex(device: Gfx.Renderer) {
        device.writeTextureData(this.boneTex, this.skeleton.boneMatrices);
        return this.boneTex;
    }
}

export class CModel implements Component {
    mesh: IMesh;
    material: Material;

    pipeline: Gfx.Id = -1;
    vertexTable: Gfx.Id = -1;
    renderList: RenderList;

    primitive: RenderPrimitive;
    enabled: boolean = false;
}

export class CSkinnedModel extends CModel {
    skeleton: Skeleton;
    ibms: mat4[];
    boneTex: Gfx.Id;
}

export abstract class ModelSystem implements System {
    static initialize(world: World) {
        world.addFamily('model', CModel, CTransform);
    }

    static render(world: World) {
        const camera = world.getSingletonCamera();
        const renderer = world.getSingletonRenderer();

        // @TODO: Frustum/Distance culling
        const family = world.getFamily('model');
        for (const entity of family.entities) {
            const model = assertDefined(entity.getComponent(CModel));

            if (model.material.bindings['auto']) {
                const transform = assertDefined(entity.getComponent(CTransform));
                
                const modelViewProj = mat4.multiply(mat4.create(), camera.viewProjMatrix, transform.localToWorld);

                const uniforms = model.material.getUniformBuffer('auto');
                uniforms.setMat4('u_model', transform.localToWorld);
                uniforms.setMat4('u_modelViewProjection', modelViewProj);
                uniforms.write(renderer);
            }
    
            model.renderList.push(model.primitive);
        }
    }

    static create(entity: Entity, device: Gfx.Renderer, renderList: RenderList, mesh: IMesh, material: Material) {
        const model = assertDefined(entity.getComponent(CModel));
        
        model.renderList = renderList;
        model.mesh = mesh;
        model.material = material;

        // @TODO: Pipeline caching
        model.pipeline = device.createRenderPipeline(material.shader, renderList.renderFormat, mesh.vertexLayout, material.layout);
        
        model.vertexTable = device.createVertexTable(model.pipeline);
        mesh.vertexBuffers.forEach((buf, i) => {
            device.setVertexBuffer(model.vertexTable, i, buf);
        });

        model.primitive = {
            renderPipeline: model.pipeline,
            resourceTable: model.material.resources,
            vertexTable: model.vertexTable,
            
            elementCount: model.mesh.elementCount,
            type: model.mesh.primitiveType,

            indexBuffer: model.mesh.indexBuffer,
            indexType: model.mesh.indexType,
        }

        model.enabled = true;

        return model;
    }

    static destroy(entity: Entity, device: Gfx.Renderer) {
        const model = assertDefined(entity.getComponent(CModel));
        
        device.removeVertexTable(model.vertexTable);
        device.removeRenderPipeline(model.pipeline);
    }
}