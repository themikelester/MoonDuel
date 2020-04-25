import { AvatarController } from "./AvatarController";
import { AvatarRender } from "./AvatarRender";
import { Renderer } from "./gfx/GfxTypes";
import { ResourceManager } from "./resources/ResourceLoading";
import { Clock } from "./Clock";
import { Camera } from "./Camera";
import { Object3D, Matrix4, Vector3 } from "./Object3D";
import { AnimationMixer } from "./Animation";
import { GltfResource, GltfNode } from "./resources/Gltf";
import { assertDefined } from "./util";
import { Skeleton, Bone } from "./Skeleton";
import { AvatarAnim } from "./AvatarAnim";
import { vec3 } from "gl-matrix";
import { SnapshotManager, Snapshot } from "./Snapshot";
import { UserCommandBuffer } from "./UserCommand";
import { DebugMenu } from "./DebugMenu";
import { NetModuleServer } from "./net/NetModule";
import { NetClientState } from "./net/NetClient";

interface ServerDependencies {
    debugMenu: DebugMenu;
    resources: ResourceManager;
    clock: Clock;
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
}

export enum AvatarFlags {
    IsActive = 1 << 0,
    IsWalking = 1 << 1,
    IsUTurning = 1 << 2,
}

export class AvatarState {
    clientId?: string;
    pos: vec3 = vec3.create();
    velocity: vec3 = vec3.create();
    orientation: vec3 = vec3.fromValues(0, 0, 1);
    flags: AvatarFlags = 0;

    constructor(isActive: boolean = false) {
        this.flags = isActive ? AvatarFlags.IsActive : 0;
    }

    static lerp(result: AvatarState, a: AvatarState, b: AvatarState, t: number) {
        result.clientId = b.clientId;
        vec3.lerp(result.pos, a.pos, b.pos, t);
        vec3.lerp(result.velocity, a.velocity, b.velocity, t);
        vec3.lerp(result.orientation, a.orientation, b.orientation, t);
        result.flags = a.flags & b.flags;
    }

    static copy(result: AvatarState, a: AvatarState) {
        result.clientId = a.clientId;
        vec3.copy(result.pos, a.pos);
        vec3.copy(result.velocity, a.velocity);
        vec3.copy(result.orientation, a.orientation);
        result.flags = a.flags;
    }
}

const kGltfFilename = 'data/Tn.glb';

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

        this.animation.initialize(this.avatars);
        this.renderer.initialize(this.avatars);
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
        const states = game.displaySnapshot.avatars;

        for (let i = 0; i < Snapshot.kAvatarCount; i++) {
            const avatar = this.avatars[i];
            const state = states[i];

            // @HACK: If we're connected, update the localAvatar to point at the one this client controls
            if (window.client.net.client.state === NetClientState.Connected) {
                if (state.clientId === window.client.net.client.id) {
                    this.localAvatar = avatar;
                }
            }

            avatar.active = !!(state.flags & AvatarFlags.IsActive);

            const pos = new Vector3(state.pos);
            avatar.position.copy(pos);
            avatar.lookAt(
                state.pos[0] + state.orientation[0],
                state.pos[1] + state.orientation[1],
                state.pos[2] + state.orientation[2],
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
        this.renderer.render(game.gfxDevice, game.camera);
    }
}

export class AvatarSystemServer {
    private states: AvatarState[] = [];
    private avatars: Avatar[] = [];
    private controllers: AvatarController[] = [];

    private gltf: GltfResource;
    private animation = new AvatarAnim();

    constructor() {
        for (let i = 0; i < Snapshot.kAvatarCount; i++) {
            this.states[i] = new AvatarState();
            this.avatars[i] = new Avatar();
            this.controllers[i] = new AvatarController();
        }
    }

    initialize(game: ServerDependencies) {
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
            const state = this.states[i];
            const avatar = this.avatars[i];

            if (!(state.flags & AvatarFlags.IsActive)) continue;

            const client = game.net.clients.find(c => c.id === state.clientId);
            if (client) {
                // @HACK: For now just use the last received command
                const inputCmd = client.userCommands.getUserCommand();
                const dtSec = game.clock.simDt / 1000.0;
        
                this.states[i] = this.controllers[i].update(state, dtSec, inputCmd);
            }
        }
    }

    addAvatar(clientId: string) {
        const state = assertDefined(this.states.find(s => !(s.flags & AvatarFlags.IsActive)), "Out of avatars");
        state.flags |= AvatarFlags.IsActive;
        state.clientId = clientId;
    }

    getSnapshot() {
        return this.states;
    }
}