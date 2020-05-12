import { AvatarController } from "./AvatarController";
import { AvatarRender } from "./AvatarRender";
import { Renderer } from "./gfx/GfxTypes";
import { ResourceManager } from "./resources/ResourceLoading";
import { Clock } from "./Clock";
import { Camera } from "./Camera";
import { Object3D, Matrix4, Vector3 } from "./Object3D";
import { AnimationMixer } from "./Animation";
import { GltfResource, GltfNode } from "./resources/Gltf";
import { assertDefined, assert } from "./util";
import { Skeleton, Bone } from "./Skeleton";
import { AvatarAnim } from "./AvatarAnim";
import { vec3 } from "gl-matrix";
import { SnapshotManager, Snapshot } from "./Snapshot";
import { UserCommandBuffer } from "./UserCommand";
import { DebugMenu } from "./DebugMenu";
import { NetModuleServer } from "./net/NetModule";
import { NetClientState } from "./net/NetClient";
import { Buf } from "./Buf";
import { Weapon, Sword } from "./Weapon";
import { World } from "./World";

interface ServerDependencies {
    debugMenu: DebugMenu;
    resources: ResourceManager;
    clock: Clock;
    world: World;

    snapshot: SnapshotManager;
    net: NetModuleServer;
}

interface ClientDependencies {
    debugMenu: DebugMenu;
    resources: ResourceManager;
    clock: Clock;

    gfxDevice: Renderer;
    camera: Camera;
    displaySnapshot: Snapshot;
}

export class Avatar extends Object3D {
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

export class AvatarState {
    origin: vec3 = vec3.create();
    velocity: vec3 = vec3.create();
    orientation: vec3 = vec3.fromValues(0, 0, 1);
    flags: AvatarFlags = 0;

    constructor(isActive: boolean = false) {
        this.flags = isActive ? AvatarFlags.IsActive : 0;
    }

    static lerp(result: AvatarState, a: AvatarState, b: AvatarState, t: number) {
        vec3.lerp(result.origin, a.origin, b.origin, t);
        vec3.lerp(result.velocity, a.velocity, b.velocity, t);
        vec3.lerp(result.orientation, a.orientation, b.orientation, t);
        result.flags = a.flags & b.flags;
    }

    static copy(result: AvatarState, a: AvatarState) {
        vec3.copy(result.origin, a.origin);
        vec3.copy(result.velocity, a.velocity);
        vec3.copy(result.orientation, a.orientation);
        result.flags = a.flags;
    }

    static serialize(buf: Buf, state: AvatarState) {
        Buf.writeFloat(buf, state.origin[0]);
        Buf.writeFloat(buf, state.origin[1]);
        Buf.writeFloat(buf, state.origin[2]);
        
        Buf.writeFloat(buf, state.velocity[0]);
        Buf.writeFloat(buf, state.velocity[1]);
        Buf.writeFloat(buf, state.velocity[2]);

        Buf.writeFloat(buf, state.orientation[0]);
        Buf.writeFloat(buf, state.orientation[1]);
        Buf.writeFloat(buf, state.orientation[2]);

        Buf.writeByte(buf, state.flags);
    }
    
    static deserialize(buf: Buf, state: AvatarState) {
        state.origin[0] = Buf.readFloat(buf);
        state.origin[1] = Buf.readFloat(buf);
        state.origin[2] = Buf.readFloat(buf);
        
        state.velocity[0] = Buf.readFloat(buf);
        state.velocity[1] = Buf.readFloat(buf);
        state.velocity[2] = Buf.readFloat(buf);

        state.orientation[0] = Buf.readFloat(buf);
        state.orientation[1] = Buf.readFloat(buf);
        state.orientation[2] = Buf.readFloat(buf);

        state.flags = Buf.readByte(buf);
    }
}

const kGltfFilename = 'data/Tn.glb';
const kWeaponFilename = 'data/Tkwn.glb';

export class AvatarSystemClient {
    public localAvatar: Avatar; // @HACK:

    private avatars: Avatar[] = [];
    private controllers: AvatarController[] = [];

    private gltf: GltfResource;
    private animation = new AvatarAnim();
    private renderer: AvatarRender = new AvatarRender();

    constructor() {
        for (let i = 0; i < Snapshot.kAvatarCount; i++) {
            this.avatars[i] = new Avatar();
            this.controllers[i] = new AvatarController();
        }
        this.localAvatar = this.avatars[0];
    }

    initialize(game: ClientDependencies) {
        // Start loading all necessary resources
        game.resources.load(kGltfFilename, 'gltf', (error, resource) => {
            if (error) { return console.error(`Failed to load resource`, error); }
            this.gltf = resource as GltfResource;
            this.onResourcesLoaded(game);
        });

        // @HACK:
        game.resources.load(kWeaponFilename, 'gltf', (error, resource) => {
            if (error) { return console.error(`Failed to load resource`, error); }
            Sword.onResourcesLoaded(assertDefined(resource), game);
        });

        this.animation.initialize(this.avatars);
        this.renderer.initialize(this.avatars);
    }

    onJoined(clientIndex: number) {
        this.localAvatar = this.avatars[clientIndex];
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

        // @HACK:
        equipWeapon(this.localAvatar, Sword.create(game.gfxDevice));
    }

    update(game: ClientDependencies) {
        const states = game.displaySnapshot.avatars;

        for (let i = 0; i < Snapshot.kAvatarCount; i++) {
            const avatar = this.avatars[i];
            const state = states[i];

            avatar.active = !!(state.flags & AvatarFlags.IsActive);

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
            
        this.animation.update(states, game.clock.renderDt / 1000.0);
    }

    updateFixed(game: ClientDependencies) {
        // @TODO: Prediction
    }

    render(game: ClientDependencies) {
        if (this.localAvatar && this.localAvatar.weapon) {
            (this.localAvatar.weapon as Sword).render(game);
        }
        this.renderer.render(game.gfxDevice, game.camera);
    }
}

function equipWeapon(avatar: Avatar, weapon: Weapon) {
    const joint = assertDefined(avatar.nodes.find(n => n.name === 'j_tn_item_r1'));
    joint.add(weapon.transform);
    avatar.weapon = weapon;
}

export class AvatarSystemServer {
    private avatars: Avatar[] = [];
    private controllers: AvatarController[] = [];

    private gltf: GltfResource;
    private animation = new AvatarAnim();

    constructor() {
        for (let i = 0; i < Snapshot.kAvatarCount; i++) {
            this.avatars[i] = new Avatar();
            this.controllers[i] = new AvatarController();
        }
    }

    initialize(game: ServerDependencies) {
        // Create GameObjects for each possible client
        for (let i = 0; i < Snapshot.kAvatarCount; i++) {
            const id = game.world.add(new AvatarState());
            assert(id === i);
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
        
            avatar.animationMixer = new AnimationMixer(avatar);
        }

        this.animation.onResourcesLoaded(this.gltf, game.debugMenu);
    }

    update(game: ServerDependencies) {
        // const states = game.displaySnapshot.avatars;

        // for (let i = 0; i < Snapshot.kAvatarCount; i++) {
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
        for (let i = 0; i < Snapshot.kAvatarCount; i++) {
            const state = game.world.get(i).data as AvatarState;
            const avatar = this.avatars[i];

            if (!(state.flags & AvatarFlags.IsActive)) continue;

            const client = game.net.clients[i];
            if (client && client.state === NetClientState.Active) {
                const inputCmd = client.getUserCommand(game.clock.simFrame);
                const dtSec = game.clock.simDt / 1000.0;
        
                const newState = this.controllers[i].update(state, dtSec, inputCmd);
                Object.assign(state, newState);
            }
        }
    }

    addAvatar(world: World, clientIndex: number) {
        for (let i = 0; i < Snapshot.kAvatarCount; i++) {
            const state = world.get(i).data as AvatarState;
            if (!(state.flags & AvatarFlags.IsActive)) {
                state.flags |= AvatarFlags.IsActive;
                return i;
            }
        }

        return -1;
    }
}