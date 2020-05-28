import { Model } from "./Mesh";
import { Resource } from "./resources/Resource";
import { GltfResource, GltfPrimitive, GltfTechnique, GltfNode } from "./resources/Gltf";
import { BufferPackedLayout, computePackedBufferLayout, UniformBuffer } from "./UniformBuffer";
import { assertDefined, defaultValue, assert, defined } from "./util";
import * as Gfx from './gfx/GfxTypes';
import { vec4, mat4, vec3, mat3 } from "gl-matrix";
import { Material, Mesh } from './Mesh';
import { renderLists } from "./RenderList";
import { Object3D } from './Object3D';
import { Camera } from './Camera';
import { ResourceManager } from "./resources/ResourceLoading";
import { AvatarSystemClient, AvatarFlags } from "./Avatar";
import { DebugRenderUtils } from "./DebugRender";
import { EntityState, GameObject, GameObjectFactory, World, GameObjectType } from "./World";
import { CollisionSystem } from "./Collision";
import { Ray } from "./Collision";
import { EnvironmentSystem } from "./Environment";

const scratchMat4 = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

//#region Weapon

export enum WeaponType {
    None = 0,
    Sword
};

enum WeaponFlags {
    IsActive = 1 << 0,
}

export class Weapon implements GameObject {
    state: EntityState;

    type: WeaponType;
    transform: Object3D = new Object3D();
    model?: Model; // May be undefined while the resources are loading

    attackQuad: vec3[] = [vec3.create(), vec3.create(), vec3.create(), vec3.create()];
    constructor(type: WeaponType, attackObb: mat4, state: EntityState) {
        this.state = state;
        this.type = type;
    }

    get isActive() {
        return this.state.flags & WeaponFlags.IsActive;
    }
}

//#endregion

//#region Weapon Blueprints

abstract class WeaponBlueprint {
    ready: boolean;
    attackObb: mat4;
    attackLine: vec3[];
    matUniformBuf: UniformBuffer;

    abstract loadResources(resources: ResourceManager, gfxDevice?: Gfx.Renderer): void;
    abstract create(state: EntityState, gfxDevice?: Gfx.Renderer): Weapon;
}

class EmptyBlueprint extends WeaponBlueprint {
    loadResources() { }
    create(): never {
        throw new Error('Attempted to create an empty weapon');
    }
}

class SwordBlueprint extends WeaponBlueprint {
    static kFilename = 'data/Tkwn.glb';

    shader: Gfx.Id;
    mesh: Mesh;
    resourceLayout: Gfx.ResourceLayout;
    matUniformBuf: UniformBuffer;
    matTextures: Record<string, Gfx.Id> = {};
    meshNode: GltfNode;

    readyPromise: Promise<void>;
    ready = false;

    constructor() {
        super();

        // Manually place a conservative OBB for the area of the model that can inflict damage
        this.attackObb = mat4.fromValues(
            20, 0, 0, 0,
            0, 5, 0, 0,
            0, 0, 90, 0,
            0, 0, 110, 1
        );

        this.attackLine = [
            vec3.fromValues(22, 0, 20),  // Start
            vec3.fromValues(18, 0, 200), // End
        ];
    }

    loadResources(resources: ResourceManager, gfxDevice?: Gfx.Renderer) {
        if (gfxDevice) {
            this.readyPromise = new Promise(resolve => {
                resources.load(SwordBlueprint.kFilename, 'gltf', (error, resource) => {
                    if (error) { return console.error(`Failed to load resource`, error); }
                    this.onResourcesLoaded(assertDefined(resource), gfxDevice);

                    this.ready = true;
                    resolve();
                });
            })
        }
    }

    create(state: EntityState, gfxDevice?: Gfx.Renderer): Weapon {
        const weapon: Weapon = new Weapon(WeaponType.Sword, this.attackObb, state);

        // Asynchronously assign the model once it has been loaded
        if (gfxDevice) {
            this.readyPromise.then(() => {
                const material = new Material(gfxDevice, name, this.shader, this.resourceLayout);
                const model = new Model(gfxDevice, renderLists.opaque, this.mesh, material);

                // Ignore the parent node, which only centers the model. The current origin is the avatar's grab point.
                model.updateWorldMatrix(true, false);
                weapon.transform.add(model); // @HACK: Unnecessary extra hierarchy. Model should not be an Object3D.

                // Set shared resources
                Object.keys(this.matTextures).forEach(name => material.setTexture(gfxDevice, name, this.matTextures[name]));
                material.setUniformBuffer(gfxDevice, 'material', this.matUniformBuf);

                // Create a new uniform buffer for the per-instance data
                const bufLayout = (this.resourceLayout['model'] as Gfx.UniformBufferResourceBinding).layout;
                const uniforms = new UniformBuffer('SwordModelUniforms', gfxDevice, bufLayout);
                material.setUniformBuffer(gfxDevice, 'model', uniforms);

                weapon.model = model;
            });
        }

        return weapon;
    }

    private onResourcesLoaded(resource: Resource, gfxDevice: Gfx.Renderer) {
        const gltf = resource as GltfResource;

        const prim = gltf.meshes[0].primitives[0];
        const material = gltf.materials[prim.materialIndex!];
        const technique = assertDefined(material.technique);
        this.shader = technique.shaderId;
        this.mesh = prim.mesh;
        this.meshNode = assertDefined(gltf.nodes.find(n => n.meshId === 0));

        // @TODO: Depth/Cull modes?

        const kModelUniforms = [
            //'u_LightColors', 'u_LightCosAttens', 'u_LightDistAttens', 'u_LightTransforms',
            'u_model', 'u_modelViewProjection'];

        // Separate GLTF uniforms into:
        // - Static material uniforms (which can be shared between instances)
        // - Dynamic model uniforms (set per frame based on model data)
        // - Textures
        const matUniforms: BufferPackedLayout = {};
        const modelUniforms: BufferPackedLayout = {};
        const textures: string[] = [];
        for (const name of Object.keys(technique.uniforms)) {
            const uni = technique.uniforms[name];

            if (kModelUniforms.includes(name)) { modelUniforms[name] = uni; }
            else if (uni.type === Gfx.Type.Texture2D) { textures.push(name); }
            else { matUniforms[name] = uni; }
        }

        // Build a resource layout based on the required uniforms
        const matUniLayout: Gfx.BufferLayout = computePackedBufferLayout(matUniforms);
        const modelUniLayout: Gfx.BufferLayout = computePackedBufferLayout(modelUniforms);
        const resourceLayout: Gfx.ShaderResourceLayout = {
            model: { index: 0, type: Gfx.BindingType.UniformBuffer, layout: modelUniLayout },
            material: { index: 1, type: Gfx.BindingType.UniformBuffer, layout: matUniLayout },
        };
        for (let i = 0; i < textures.length; i++) {
            const texName = textures[i];
            resourceLayout[texName] = { index: i, type: Gfx.BindingType.Texture };
        }

        // This resource layout is shared between all instances
        this.resourceLayout = resourceLayout;

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

        this.matUniformBuf.write(gfxDevice);
    }
}

//#endregion

//#region Weapon System
export class WeaponSystem implements GameObjectFactory {
    gfxDevice?: Gfx.Renderer;
    blueprints: Record<WeaponType, WeaponBlueprint>;
    weapons: Weapon[] = [];

    constructor(world: World) {
        world.registerFactory(GameObjectType.Weapon, this);
        this.blueprints = {
            [WeaponType.None]: new EmptyBlueprint(),
            [WeaponType.Sword]: new SwordBlueprint(),
        }
    }

    initialize({ resources, gfxDevice }: { resources: ResourceManager, gfxDevice?: Gfx.Renderer }) {
        this.gfxDevice = gfxDevice;
        this.blueprints[WeaponType.Sword].loadResources(resources, gfxDevice!);
    }

    createGameObject(initialState: EntityState) {
        const weapon = this.blueprints[WeaponType.Sword].create(initialState, this.gfxDevice);
        this.weapons.push(weapon);
        return weapon;
    }

    deleteGameObject() {

    }

    updateFixed({ world, collision }: { world: World, collision: CollisionSystem }) {
        for (const weaponId in this.weapons) {
            const weapon = this.weapons[weaponId];
            const bp = this.blueprints[weapon.type];

            // Set the weapon active flag based on its parent's flag
            const parent = world.objects.find(o => o.state.id === weapon.state.parent!);
            weapon.state.flags = parent!.state.flags & AvatarFlags.IsActive;

            if (weapon.isActive) {
                // Copy the last front edge to the new back edge
                vec3.copy(weapon.attackQuad[2], weapon.attackQuad[0]);
                vec3.copy(weapon.attackQuad[3], weapon.attackQuad[1]);

                // Create the new front edge by orient the weapon attack line for this frame
                (scratchMat4 as Float32Array).set(weapon.transform.matrixWorld.elements);
                vec3.transformMat4(weapon.attackQuad[0], bp.attackLine[0], scratchMat4);
                vec3.transformMat4(weapon.attackQuad[1], bp.attackLine[1], scratchMat4);
            }
        }
    }

    render({ gfxDevice, camera, environment }: { gfxDevice: Gfx.Renderer, camera: Camera, environment: EnvironmentSystem }, debug = false) {
        const blueprint = this.blueprints[WeaponType.Sword];
        if (blueprint.ready) {
            const env = environment.getCurrentEnvironment();
            const matUniforms = this.blueprints[WeaponType.Sword].matUniformBuf;
            matUniforms.setVec4('u_Color0', env.actorColor.ambient);
            matUniforms.setVec4('u_KonstColor0', env.actorColor.diffuse);
            matUniforms.setFloats('u_LightTransforms', [
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                env.baseLight.position[0], env.baseLight.position[1], env.baseLight.position[2], 1,
            ]);
            matUniforms.write(gfxDevice);
        }

        for (const weapon of this.weapons) {
            if (!weapon.isActive) continue;

            const model = weapon.model;
            if (defined(model)) {
                weapon.transform.updateWorldMatrix(false, true);

                const matrixWorld = new Float32Array(model.matrixWorld.elements) as mat4;

                const uniforms = model.material.getUniformBuffer('model');
                uniforms.setMat4('u_model', matrixWorld);
                uniforms.setMat4('u_modelViewProjection', mat4.multiply(mat4.create(), camera.viewProjMatrix, matrixWorld));
                uniforms.write(gfxDevice);

                model.renderList.push(model.primitive);
            }
        }
    }
}

//#endregion