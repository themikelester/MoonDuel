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

interface Dependencies {
    headless: boolean;

    gfxDevice?: Renderer;
    resources: ResourceManager;
    clock: Clock;
    camera?: Camera;
    snapshot: SnapshotManager;
    userCommands: UserCommandBuffer;
    debugMenu: DebugMenu;
}

interface GameDependencies extends Dependencies {
    gfxDevice: Renderer;
    camera: Camera;
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
    pos: vec3 = vec3.create();
    velocity: vec3 = vec3.create();
    orientation: vec3 = vec3.fromValues(0, 0, 1);
    flags: AvatarFlags = 0;

    constructor(isActive: boolean = false) {
        this.flags = isActive ? AvatarFlags.IsActive : 0;

        // @HACK: Make all avatars active, for testing
        this.flags = AvatarFlags.IsActive;
    }

    static lerp(result: AvatarState, a: AvatarState, b: AvatarState, t: number) {
        vec3.lerp(result.pos, a.pos, b.pos, t);
        vec3.lerp(result.velocity, a.velocity, b.velocity, t);
        vec3.lerp(result.orientation, a.orientation, b.orientation, t);
        result.flags = a.flags & b.flags;
    }

    static copy(result: AvatarState, a: AvatarState) {
        vec3.copy(result.pos, a.pos);
        vec3.copy(result.velocity, a.velocity);
        vec3.copy(result.orientation, a.orientation);
        result.flags = a.flags;
    }
}

const kGltfFilename = 'data/Tn.glb';

export class AvatarSystem {
    public localAvatar: Avatar;
    private avatarState: AvatarState = new AvatarState(true);

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
        this.avatars[0].local = true;
    }

    initialize(game: Dependencies) {
        // Start loading all necessary resources
        game.resources.load(kGltfFilename, 'gltf', (error, resource) => {
            if (error) { return console.error(`Failed to load resource`, error); }
            this.gltf = resource as GltfResource;
            this.onResourcesLoaded(game);
        });

        this.animation.initialize(this.avatars);
        this.renderer.initialize(this.avatars);
    }

    onResourcesLoaded(game: Dependencies) {
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
        if (!game.headless) this.renderer.onResourcesLoaded(this.gltf, (game as GameDependencies).gfxDevice);
    }

    update(game: Dependencies) {
        const states = game.snapshot.displaySnapshot.avatars;

        for (let i = 0; i < Snapshot.kAvatarCount; i++) {
            const avatar = this.avatars[i];
            const state = states[i];

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

    updateFixed(game: Dependencies) {
        const inputCmd = game.userCommands.getUserCommand(game.clock.simFrame);
        const dtSec = game.clock.simDt / 1000.0;

        this.avatarState = this.controllers[0].update(this.avatarState, dtSec, inputCmd);
        this.avatarState.flags |= AvatarFlags.IsActive;
    }

    render(deps: Dependencies) {
        if (!deps.headless) {
            const game = deps as GameDependencies;
            this.renderer.render(game.gfxDevice, game.camera);
        }
    }

    getSnapshot() {
        return this.avatarState;
    }
}