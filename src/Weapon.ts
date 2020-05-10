import { Model, CModel, ModelSystem } from "./Mesh";
import { Resource } from "./resources/Resource";
import { GltfResource, GltfPrimitive, GltfTechnique, GltfNode } from "./resources/Gltf";
import { BufferPackedLayout, computePackedBufferLayout, UniformBuffer } from "./UniformBuffer";
import { assertDefined, defaultValue, assert } from "./util";
import * as Gfx from './gfx/GfxTypes';
import { vec4, mat4 } from "gl-matrix";
import { Material, Mesh } from './Mesh';
import { renderLists } from "./RenderList";
import { Object3D } from './Object3D';
import { Camera } from './Camera';
import { EntityPrototype, Entity } from "./Entity";
import { World } from "./World";
import { CTransform } from "./Transform";

export class Weapon {
    model: Model;
    transform: Object3D;
}

const WeaponEntity = new class WeaponEntity extends EntityPrototype {} ([
    CTransform,
    CModel
]);

export class Sword extends Weapon {
    static shader: Gfx.Id;
    static mesh: Mesh;
    static resourceLayout: Gfx.ResourceLayout;
    static matUniformBuf: UniformBuffer;
    static matTextures: Record<string, Gfx.Id> = {};
    static meshNode: GltfNode;

    static onResourcesLoaded(resource: Resource, { gfxDevice }: { gfxDevice: Gfx.Renderer }) {
        const gltf = resource as GltfResource;

        const prim = gltf.meshes[0].primitives[0];
        const material = gltf.materials[prim.materialIndex];
        const technique = assertDefined(material.technique);
        this.shader = technique.shaderId;
        this.mesh = prim.mesh;
        this.meshNode = assertDefined(gltf.nodes.find(n => n.meshId === 0));

        // @TODO: Depth/Cull modes?

        const kAutoUniforms = [
            //'u_LightColors', 'u_LightCosAttens', 'u_LightDistAttens', 'u_LightTransforms',
            'u_model', 'u_modelViewProjection'];

        // Separate GLTF uniforms into:
        // - Static material uniforms (which can be shared between instances)
        // - Dynamic auto uniforms (set per frame based on transform data)
        // - Textures
        const matUniforms: BufferPackedLayout = {};
        const autoUniforms: BufferPackedLayout = {};
        const textures: string[] = [];
        for (const name of Object.keys(technique.uniforms)) {
            const uni = technique.uniforms[name];

            if (kAutoUniforms.includes(name)) { autoUniforms[name] = uni; }
            else if (uni.type === Gfx.Type.Texture2D) { textures.push(name); }
            else { matUniforms[name] = uni; }
        }

        // Build a resource layout based on the required uniforms
        const matUniLayout: Gfx.BufferLayout = computePackedBufferLayout(matUniforms);
        const autoUniLayout: Gfx.BufferLayout = computePackedBufferLayout(autoUniforms);
        const resourceLayout: Gfx.ShaderResourceLayout = {
            auto: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: autoUniLayout },
            material: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: matUniLayout },
        };
        for (let i = 0; i < textures.length; i++) {
            const texName = textures[i];
            resourceLayout[texName] = { index: i, type: Gfx.BindingType.Texture };
        }

        // This resource layout is shared between all instances
        Sword.resourceLayout = resourceLayout;

        // Construct a material uniform buffer that can be shared between instances
        this.matUniformBuf = new UniformBuffer(material.name, gfxDevice, matUniLayout);

        // Set static uniforms from the values provided in the GLTF material
        const values = assertDefined(material.values);
        for (const name of Object.keys(matUniforms).concat(textures)) {
            const uniform = technique.uniforms[name];
            const value = assertDefined(defaultValue(values[name], uniform.value),
                `Expected material uniform '${name}' to have a value in the material or technique`);

            if (uniform.type === Gfx.Type.Texture2D) {
                const texId = gltf.textures[value.index].id;
                this.matTextures[name] = texId;
            } else if (uniform.type === Gfx.Type.Float) {
                this.matUniformBuf.setFloat(name, value);
            } else {
                this.matUniformBuf.setFloats(name, value);
            }
        }

        // @HACK:
        this.matUniformBuf.setVec4('u_Color0', vec4.fromValues(0.4266, 0.4171, 0.5057, 1));
    }
}

export class WeaponSystem {
    initialize(world: World) {
    }

    update(world: World) {
        // @HACK:
        if (Sword.mesh) {
            this.create(world);
        }
    }

    create(world: World) {
        const modelSystem = world.systems[1] as ModelSystem; // @TODO
        const gfxDevice = world.getSingletonRenderer();

        const material = new Material(gfxDevice, name, Sword.shader, Sword.resourceLayout);

        const entity = new Entity(WeaponEntity);
        const model = modelSystem.create(entity, gfxDevice, renderLists.opaque, Sword.mesh, material);

        // Set shared resources
        Object.keys(Sword.matTextures).forEach(name => material.setTexture(gfxDevice, name, Sword.matTextures[name]));
        material.setUniformBuffer(gfxDevice, 'material', Sword.matUniformBuf);

        // Create a new uniform buffer for the per-instance data
        const bufLayout = (Sword.resourceLayout['auto'] as Gfx.UniformBufferResourceBinding).layout;
        const uniforms = new UniformBuffer('SwordModelUniforms', gfxDevice, bufLayout);
        material.setUniformBuffer(gfxDevice, 'auto', uniforms);

        return world.addEntity(entity);
    }
}