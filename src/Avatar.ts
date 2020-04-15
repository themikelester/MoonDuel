import { AvatarController } from "./AvatarController";
import { AvatarRender } from "./AvatarRender";
import { Renderer } from "./gfx/GfxTypes";
import { ResourceManager } from "./resources/ResourceLoading";
import { Clock } from "./Clock";
import { Camera } from "./Camera";
import { Object3D, Matrix4 } from "./Object3D";
import { AnimationMixer } from "./Animation";
import { GltfResource, GltfNode } from "./resources/Gltf";
import { assertDefined } from "./util";
import { Skeleton, Bone } from "./Skeleton";
import { InputManager } from "./Input";
import { AvatarAnim } from "./AvatarAnim";
import { vec3 } from "gl-matrix";

interface Dependencies {
    gfxDevice: Renderer;
    resources: ResourceManager;
    clock: Clock;
    camera: Camera;
    input: InputManager;
}

export class Avatar extends Object3D {
    nodes: GltfNode[];
    animationMixer: AnimationMixer;
    skeleton: Skeleton;
}

export enum AvatarFlags {
    IsWalking = 1 << 0,
    IsUTurning = 1 << 1,
}

export class AvatarState {
    pos: vec3 = vec3.create();
    velocity: vec3 = vec3.create();
    flags: AvatarFlags = 0;
}

const kGltfFilename = 'data/Tn.glb';

export class AvatarSystem {
    public localAvatar: Avatar = new Avatar();
    private avatarState: AvatarState = new AvatarState();

    private avatars: Avatar[] = [this.localAvatar];
    private gltf: GltfResource;

    private controller: AvatarController = new AvatarController();
    private animation = new AvatarAnim();
    private renderer: AvatarRender = new AvatarRender();

    initialize(game: Dependencies) {
        // Start loading all necessary resources
        game.resources.load(kGltfFilename, 'gltf', (error, resource) => {
            if (error) { return console.error(`Failed to load resource`, error); }
            this.gltf = resource as GltfResource;
            this.onResourcesLoaded(game);
        });

        this.controller.initialize(this.avatars);
        this.animation.initialize(this.localAvatar);
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

        this.animation.onResourcesLoaded(this.gltf);
        this.renderer.onResourcesLoaded(this.gltf, game);
    }

    update(game: Dependencies) {
    }

    updateFixed(game: Dependencies) {
        this.avatarState = this.controller.updateFixed(game);
    }

    render(game: Dependencies) {
        this.animation.update(this.avatarState, game.clock.simStep / 1000.0);
        this.renderer.render(game);
    }
}