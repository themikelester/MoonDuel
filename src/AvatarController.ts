import { GltfResource } from "./resources/Gltf";
import { assertDefined } from "./util";
import { AnimationClip } from "./resources/Animation";
import { Avatar } from "./Avatar";
import { Clock } from "./Clock";
import { DebugMenu } from "./DebugMenu";

// Populate a DebugMenu folder with functions to play all possible animations 
function createDebugAnimationList(animations: AnimationClip[], targetAvatar: Avatar ) {
    const debugMenu = DebugMenu.addFolder('Animation');
    const playAnimMap: { [name: string]: () => void } = {};
    for (const anim of animations) {
        playAnimMap[anim.name] = () => {
            targetAvatar.animationMixer.stopAllAction();
            targetAvatar.animationMixer.clipAction(anim).play();
        };
        debugMenu.add(playAnimMap, anim.name);
    }
}

/**
 * Drive each Avatar's skeleton, position, oriention, and animation
 */
export class AvatarController {
    ready: boolean = false;
    animations: AnimationClip[];
    avatars: Avatar[];

    initialize(avatars: Avatar[]) {
        this.avatars = avatars;
    }

    onResourcesLoaded(gltf: GltfResource) {
        this.animations = gltf.animations;
        createDebugAnimationList(this.animations, this.avatars[0]);

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