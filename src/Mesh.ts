import * as Gfx from './gfx/GfxTypes';
import { RenderList, renderLists } from './RenderList';
import { RenderPrimitive } from './RenderPrimitive';
import { assertDefined, assert, defined, defaultValue } from './util';
import { vec3, quat, mat4 } from 'gl-matrix';
import { Skeleton, SkeletonComponent, SkinComponent } from './Skeleton';
import { Object3D } from './Object3D';
import { UniformBuffer } from './UniformBuffer';
import { Component } from './Component';
import { Entity } from './Entity';
import { FamilyBuilder, Family } from './Family';
import { World, System } from './World';
import { CTransform, Transform } from './Transform';

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
    enabled: boolean = false;
    renderList: RenderList;

    meshes: Array<{
        mesh: IMesh;
        pipeline: Gfx.Id;
        vertexTable: Gfx.Id;
        primitive: RenderPrimitive;
        material: Material;
        parent?: Transform;
    }> = []
}

const scratchMat4 = mat4.create();

export abstract class ModelSystem implements System {
    static initialize(world: World) {
        world.addFamily('model', CModel, CTransform);
        world.addFamily('skinnedModel', CModel, CTransform, SkeletonComponent, SkinComponent);
    }

    static render(world: World) {
        const camera = world.getSingletonCamera();
        const renderer = world.getSingletonRenderer();

        // Updated textures that store bone matrices
        const skinned = world.getFamily('skinnedModel');
        for (const entity of skinned.entities) {
            const skin = entity.getComponent(SkinComponent);
            const skeleton = entity.getComponent(SkeletonComponent);
            renderer.writeTextureData(skin.boneTex, skeleton.boneMatrices);
        }

        // @TODO: Frustum/Distance culling
        const family = world.getFamily('model');
        for (const entity of family.entities) {
            const model = assertDefined(entity.getComponent(CModel));
            const transform = assertDefined(entity.getComponent(CTransform));

            for (const mesh of model.meshes) {
                if (mesh.material.bindings['auto']) {
                    const matrixWorld = mesh.parent ? mesh.parent.matrixWorld : transform.matrixWorld;
                    (scratchMat4 as Float32Array).set(matrixWorld.elements);
                    const localToWorld = scratchMat4;

                    const modelViewProj = mat4.multiply(mat4.create(), camera.viewProjMatrix, localToWorld);

                    const uniforms = mesh.material.getUniformBuffer('auto');
                    uniforms.setMat4('u_model', localToWorld);
                    uniforms.setMat4('u_modelViewProjection', modelViewProj);
                    uniforms.write(renderer);
                }

                model.renderList.push(mesh.primitive);
            }
        }
    }

    static create(entity: Entity, renderList: RenderList) {
        const model = assertDefined(entity.getComponent(CModel));
        model.enabled = true;
        model.renderList = renderList;
        return model;
    }

    static addMesh(model: CModel, device: Gfx.Renderer, mesh: IMesh, material: Material, parent?: Transform) {
        assertDefined(model.renderList);

        // @TODO: Pipeline caching
        const pipeline = device.createRenderPipeline(material.shader, model.renderList.renderFormat, 
            mesh.vertexLayout, material.layout);
        
        const vertexTable = device.createVertexTable(pipeline);
        mesh.vertexBuffers.forEach((buf, i) => {
            device.setVertexBuffer(vertexTable, i, buf);
        });

        const primitive = {
            renderPipeline: pipeline,
            resourceTable: material.resources,
            vertexTable: vertexTable,
            
            elementCount: mesh.elementCount,
            type: mesh.primitiveType,

            indexBuffer: mesh.indexBuffer,
            indexType: mesh.indexType,
        }

        model.meshes.push({ mesh, pipeline, vertexTable, primitive, material, parent });

        return model;
    }

    static destroy(entity: Entity, device: Gfx.Renderer) {
        const model = assertDefined(entity.getComponent(CModel));
        
        for (const mesh of model.meshes) {
            device.removeVertexTable(mesh.vertexTable);            
            device.removeRenderPipeline(mesh.pipeline);
        }
    }
}