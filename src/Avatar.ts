import { AvatarController } from "./AvatarController";
import { AvatarRender } from "./AvatarRender";
import { Renderer } from "./gfx/GfxTypes";
import { ResourceManager } from "./resources/ResourceLoading";
import { Clock } from "./Clock";
import { Camera } from "./Camera";
import { Object3D, Matrix4 } from "./Object3D";
import { AnimationMixer } from "./resources/Animation";
import { GltfResource } from "./resources/Gltf";
import { assertDefined } from "./util";
import { Skeleton, Bone } from "./Skeleton";

interface Dependencies {
    gfxDevice: Renderer;
    resources: ResourceManager;
    clock: Clock;
    camera: Camera;
}

export class Avatar extends Object3D {
    animationMixer: AnimationMixer;
    skeleton: Skeleton;
}

const kGltfFilename = 'data/Tn.glb';

export class AvatarSystem {
    private avatars: Avatar[];
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

        // Create a local avatar
        this.avatars = [new Avatar()];

        this.controller.initialize(this.avatars);
        this.renderer.initialize(this.avatars);
    }

    onResourcesLoaded(game: Dependencies) {
        for (const avatar of this.avatars) {
            // Assign the loaded scene graph to this Avatar object
            const rootNodes = this.gltf.rootNodeIds.map(nodeId => this.gltf.nodes[nodeId]);
            for (const node of rootNodes) {
                avatar.add(node);
            }
            
            // Create skeletons from the first GLTF skin
            const skin = assertDefined(this.gltf.skins[0]);
            const bones = skin.joints.map(jointId => this.gltf.nodes[jointId]); // @TODO: Loader should create these as Bones, not Object3Ds
            const ibms = skin.inverseBindMatrices?.map(ibm => new Matrix4().fromArray(ibm));
            avatar.skeleton = new Skeleton(bones as Object3D[] as Bone[], ibms);
        
            avatar.animationMixer = new AnimationMixer(avatar);
        }

        this.controller.onResourcesLoaded(this.gltf);
        this.renderer.onResourcesLoaded(this.gltf, game);
    }

    update(game: Dependencies) {
        this.controller.update(game);
    }

    render(game: Dependencies) {
        this.renderer.render(game);
    }
}