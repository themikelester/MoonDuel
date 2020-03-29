import { GltfResource } from "./resources/Gltf";
import { assertDefined } from "./util";
import { AnimationClip } from "./resources/Animation";
import { Avatar } from "./Avatar";
import { Clock } from "./Clock";

export class AvatarController {
    ready: boolean = false;
    animations: AnimationClip[];
    avatars: Avatar[];

    initialize(avatars: Avatar[]) {
        this.avatars = avatars;
    }

    onResourcesLoaded(gltf: GltfResource) {
        this.animations = gltf.animations;

        // @HACK:
        const clip = assertDefined(this.animations[12]);
        for (const avatar of this.avatars) {
            const action = avatar.animationMixer.clipAction(clip);
            action.play();
        }

        this.ready = true;
    }

    update({ clock }: { clock: Clock }) {
        if (!this.ready) return;

        for (const avatar of this.avatars) {
            avatar.animationMixer.update(clock.dt / 1000.0);
            avatar.updateMatrixWorld();
            avatar.skeleton.update();
        }
    }
}