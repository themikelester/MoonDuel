import { AvatarController } from "./AvatarController";
import { AvatarRender } from "./AvatarRender";
import { Renderer } from "./gfx/GfxTypes";
import { ResourceManager } from "./resources/ResourceLoading";
import { Clock } from "./Clock";
import { Camera } from "./Camera";
import { Object3D, Matrix4, Vector3 } from "./Object3D";
import { AnimationMixer } from "./Animation";
import { GltfResource, GltfNode } from "./resources/Gltf";
import { assertDefined, defined, defaultValue, assert } from "./util";
import { Skeleton, Bone } from "./Skeleton";
import { AvatarAnim } from "./AvatarAnim";
import { DebugMenu } from "./DebugMenu";
import { NetModuleServer } from "./net/NetModule";
import { NetClientState } from "./net/NetClient";
import { Weapon, WeaponSystem } from "./Weapon";
import { SimStream, SimState, EntityState, World, GameObjectType, GameObject, GameObjectFactory } from "./World";
import { vec3 } from "gl-matrix";

interface ServerDependencies {
    debugMenu: DebugMenu;
    resources: ResourceManager;
    clock: Clock;
    world: World;

    net: NetModuleServer;
}

interface ClientDependencies {
    debugMenu: DebugMenu;
    resources: ResourceManager;
    clock: Clock;
    weapons: WeaponSystem;
    world: World;
    
    gfxDevice: Renderer;
    camera: Camera;
}

export class Avatar extends Object3D implements GameObject {
    state: EntityState;

    active: boolean = false;
    local: boolean = false;

    nodes: GltfNode[];
    animationMixer: AnimationMixer;
    skeleton: Skeleton;
    
    weapon: Weapon;
}

export enum AvatarFlags {
    IsActive = 1 << 0,
    IsWalking = 1 << 1,
    IsUTurning = 1 << 2,
}

export enum AvatarAttackType {
    None,
    Side,
    Vertical,
    Throw
}

const kGltfFilename = 'data/Tn.glb';
const kAvatarCount = 8;

export class AvatarSystemClient implements GameObjectFactory {
    public localAvatar: Avatar; // @HACK:

    private avatars: Avatar[] = [];

    private gltf: GltfResource;
    private animation = new AvatarAnim();
    private renderer: AvatarRender = new AvatarRender();

    constructor() {
        for (let i = 0; i < kAvatarCount; i++) {
            this.avatars[i] = new Avatar();
        }
        this.localAvatar = this.avatars[0];
    }

    initialize(game: ClientDependencies) {
        game.world.registerFactory(GameObjectType.Avatar, this);

        // Start loading all necessary resources
        game.resources.load(kGltfFilename, 'gltf', (error, resource) => {
            if (error) { return console.error(`Failed to load resource`, error); }
            this.gltf = resource as GltfResource;
            this.onResourcesLoaded(game);
        });

        this.animation.initialize(this.avatars);
        this.renderer.initialize(this.avatars, game.debugMenu);
    }

    onJoined(clientIndex: number) {
        this.localAvatar = this.avatars[clientIndex];
        this.localAvatar.local = true;
    }

    onResourcesLoaded(game: ClientDependencies) {
        for (const avatar of this.avatars) {
            // Clone all nodes
            avatar.nodes = this.gltf.nodes.map(src => src.clone(false));
            for (let i = 0; i < avatar.nodes.length; i++) {
                const src = this.gltf.nodes[i];
                const node = avatar.nodes[i];
                for (const child of src.children) {
                    const childIdx = this.gltf.nodes.indexOf(child as GltfNode);
                    node.add(avatar.nodes[childIdx]);
                }
            }

            // Assign the loaded scene graph to this Avatar object
            for (const rootNodeId of this.gltf.rootNodeIds.slice(0, 1)) {
                avatar.add(avatar.nodes[rootNodeId]);
            }
            
            // Create skeletons from the first GLTF skin
            const skin = assertDefined(this.gltf.skins[0]);
            const bones = skin.joints.map(jointId => avatar.nodes[jointId]); // @TODO: Loader should create these as Bones, not Object3Ds
            const ibms = skin.inverseBindMatrices?.map(ibm => new Matrix4().fromArray(ibm));
            avatar.skeleton = new Skeleton(bones as Object3D[] as Bone[], ibms);
        
            avatar.animationMixer = new AnimationMixer(avatar);
        }

        this.animation.onResourcesLoaded(this.gltf, game.debugMenu);
        this.renderer.onResourcesLoaded(this.gltf, game.gfxDevice);
    }

    update(game: ClientDependencies) {
        for (const avatar of this.avatars) {
            const state = avatar.state;
            if (!state || !avatar.nodes) continue;

            avatar.active = !!(state.flags & AvatarFlags.IsActive);
            
            // Attach the weapon
            if (!avatar.weapon) {
                const weaponId = kAvatarCount + avatar.id;
                const weapon = game.world.objects[weaponId] as Weapon;

                avatar.weapon = weapon;
                const joint = assertDefined(avatar.nodes.find(n => n.name === 'j_tn_item_r1'));
                joint.add(avatar.weapon.transform);
            }

            const pos = new Vector3(state.origin);
            avatar.position.copy(pos);
            avatar.lookAt(
                state.origin[0] + state.orientation[0],
                state.origin[1] + state.orientation[1],
                state.origin[2] + state.orientation[2],
            )

            avatar.updateMatrix();
            avatar.updateMatrixWorld();
        }
            
        this.animation.update(game.clock);
    }

    updateFixed(game: ClientDependencies) {
        // @TODO: Prediction
    }

    render(game: ClientDependencies) {
        this.renderer.render(game.gfxDevice, game.camera);
    }

    createGameObject(initialState: EntityState) {
        const avatarIdx = initialState.id;
        assert(avatarIdx < kAvatarCount);

        const avatar = this.avatars[avatarIdx];
        avatar.state = initialState;

        return avatar;
    }

    deleteGameObject() {

    }
}

export class AvatarSystemServer implements GameObjectFactory {
    private avatars: Avatar[] = [];
    private controllers: AvatarController[] = [];

    private gltf: GltfResource;
    private animation = new AvatarAnim();

    initialize(game: ServerDependencies) {
        game.world.registerFactory(GameObjectType.Avatar, this);

        const baseline: Partial<EntityState> = { orientation: vec3.fromValues(0, 0, 1) };

        for (let i = 0; i < kAvatarCount; i++) {
            this.avatars[i] = game.world.createGameObject(GameObjectType.Avatar, baseline) as Avatar;
        }
        
        for (let i = 0; i < kAvatarCount; i++) {
            this.avatars[i].weapon = game.world.createGameObject(GameObjectType.Weapon, { parent: i }) as Weapon;
        }
        
        // Start loading all necessary resources
        game.resources.load(kGltfFilename, 'gltf', (error, resource) => {
            if (error) { return console.error(`Failed to load resource`, error); }
            this.gltf = resource as GltfResource;
            this.onResourcesLoaded(game);
        });

        this.animation.initialize(this.avatars);
    }

    onResourcesLoaded(game: ServerDependencies) {
        for (const avatar of this.avatars) {
            // Clone all nodes
            avatar.nodes = this.gltf.nodes.map(src => src.clone(false));
            for (let i = 0; i < avatar.nodes.length; i++) {
                const src = this.gltf.nodes[i];
                const node = avatar.nodes[i];
                for (const child of src.children) {
                    const childIdx = this.gltf.nodes.indexOf(child as GltfNode);
                    node.add(avatar.nodes[childIdx]);
                }
            }

            // Assign the loaded scene graph to this Avatar object
            for (const rootNodeId of this.gltf.rootNodeIds.slice(0, 1)) {
                avatar.add(avatar.nodes[rootNodeId]);
            }
            
            // Create skeletons from the first GLTF skin
            const skin = assertDefined(this.gltf.skins[0]);
            const bones = skin.joints.map(jointId => avatar.nodes[jointId]); // @TODO: Loader should create these as Bones, not Object3Ds
            const ibms = skin.inverseBindMatrices?.map(ibm => new Matrix4().fromArray(ibm));
            avatar.skeleton = new Skeleton(bones as Object3D[] as Bone[], ibms);

            // Attach the weapon
            const joint = assertDefined(avatar.nodes.find(n => n.name === 'j_tn_item_r1'));
            joint.add(avatar.weapon.transform);
        
            avatar.animationMixer = new AnimationMixer(avatar);
        }

        this.animation.onResourcesLoaded(this.gltf, game.debugMenu);
    }

    update(game: ServerDependencies) {
        // const states = game.displaySnapshot.avatars;

        // for (let i = 0; i < kAvatarCount; i++) {
        //     const avatar = this.avatars[i];
        //     const state = states[i];

        //     avatar.active = !!(state.flags & AvatarFlags.IsActive);

        //     const pos = new Vector3(state.pos);
        //     avatar.position.copy(pos);
        //     avatar.lookAt(
        //         state.pos[0] + state.orientation[0],
        //         state.pos[1] + state.orientation[1],
        //         state.pos[2] + state.orientation[2],
        //     )

        //     avatar.updateMatrix();
        //     avatar.updateMatrixWorld();
        // }
            
        // this.animation.update(states, game.clock.renderDt / 1000.0);
    }

    updateFixed(game: ServerDependencies) {
        for (let i = 0; i < kAvatarCount; i++) {
            const avatar = this.avatars[i];
            const client = game.net.clients[i];
            const state = avatar.state;
            
            state.flags = avatar.active ? (state.flags | AvatarFlags.IsActive) : state.flags & ~AvatarFlags.IsActive;

            let nextState = state;
            
            if (avatar.active && client && client.state === NetClientState.Active) {
                const pos = new Vector3(state.origin);
                avatar.position.copy(pos);
                avatar.lookAt(
                    state.origin[0] + state.orientation[0],
                    state.origin[1] + state.orientation[1],
                    state.origin[2] + state.orientation[2],
                )
    
                avatar.updateMatrix();
                avatar.updateMatrixWorld();
    
                const inputCmd = client.getUserCommand(game.clock.simFrame);
                const dtSec = game.clock.simDt / 1000.0;
        
                nextState = this.controllers[i].update(state, game.clock.simFrame, dtSec, inputCmd);
            }
        }

        this.animation.update(game.clock);
    }

    createGameObject(initialState: EntityState) {
        const avatar = new Avatar();
        avatar.state = initialState;

        const avatarIdx = this.avatars.length;
        this.controllers[avatarIdx] = new AvatarController();
        this.avatars[avatarIdx] = avatar;

        return avatar;
    }

    deleteGameObject() {

    }

    addAvatar(clientIndex: number) {
        const avatar = this.avatars[clientIndex];
        avatar.active = true;
    }

    removeAvatar(clientIndex: number) {
        const avatar = this.avatars[clientIndex];
        avatar.active = false;
    }
}