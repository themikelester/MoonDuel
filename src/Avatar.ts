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

const kGltfFilename = 'data/Tn.glb';

export class AvatarSystem {
    public localAvatar: Avatar = new Avatar();

    private avatars: Avatar[] = [this.localAvatar];
    private gltf: GltfResource;

    private controller: AvatarController = new AvatarController();
    private renderer: AvatarRender = new AvatarRender();

    initialize(game: Dependencies) {
        // Start loading all necessary resources
        game.resources.load(kGltfFilename, 'gltf', (error, resource) => {
            if (error) { return console.error(`Failed to load resource`, error); }
            this.gltf = resource as GltfResource;
            this.onResourcesLoaded(game);
        });

        this.controller.initialize(this.avatars);
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

        this.controller.onResourcesLoaded(this.gltf);
        this.renderer.onResourcesLoaded(this.gltf, game);
    }

    update(game: Dependencies) {
    }

    updateFixed(game: Dependencies) {
        this.controller.updateFixed(game);
    }

    render(game: Dependencies) {
        this.renderer.render(game);
    }
}