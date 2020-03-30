import { GltfResource } from "./resources/Gltf";
import { assertDefined } from "./util";
import { AnimationClip } from "./resources/Animation";
import { Avatar } from "./Avatar";
import { Clock } from "./Clock";
import { DebugMenu } from "./DebugMenu";
import { vec3, mat2 } from "gl-matrix";
import { InputManager } from "./Input";
import { Camera } from "./Camera";
import { Vector3 } from "./Object3D";

const scratchVec3A = vec3.create();
const scratchVector3A = new Vector3(scratchVec3A);

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
    localController = new LocalController();

    avatars: Avatar[];
    local: Avatar;

    initialize(avatars: Avatar[]) {
        this.avatars = avatars;
        this.local = avatars[0];
        this.localController.initialize(this.local);
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

    update({ clock, input, camera }: { clock: Clock, input: InputManager, camera: Camera }) {
        if (!this.ready) return;

        this.localController.update(clock, input, camera);

        for (const avatar of this.avatars) {
            avatar.animationMixer.update(clock.dt / 1000.0);
            avatar.updateMatrixWorld();
            avatar.skeleton.update();
        }
    }
}

class LocalController {
    avatar: Avatar;

    velocity: vec3 = vec3.create();
    velocityTarget: vec3 = vec3.create();
    
    orientation: vec3 = vec3.create();
    orientationTarget: vec3 = vec3.create();

    initialize(avatar: Avatar) {
        this.avatar = avatar;
    }

    update(clock: Clock, input: InputManager, camera: Camera) {
        const speed = 100; // Units per second

        this.getCameraRelativeMovementDirection(input, camera, this.velocityTarget);
        this.velocityTarget = vec3.scale(this.velocityTarget, this.velocityTarget, speed);
        vec3.copy(this.velocity, this.velocityTarget); // @TODO: Easing

        const dtSec = clock.dt / 1000.0; // TODO: Clock.dt should be in seconds
        
        this.avatar.position.addScaledVector(scratchVector3A.setBuffer(this.velocity), dtSec);
    }

    private getWorldRelativeMovementDirection(input: InputManager, result: vec3): vec3 {
        const x = input.getAxis('Horizontal');
        const z = input.getAxis('Vertical');
        return vec3.normalize(result, vec3.set(result, x, 0, z));
    }

    private getCameraRelativeMovementDirection(input: InputManager, camera: Camera, result: vec3): vec3 {
        const local = this.getWorldRelativeMovementDirection(input, result);
        const flatView = vec3.normalize(scratchVec3A, vec3.set(scratchVec3A, camera.forward[0], 0, camera.forward[2]));
        
        // 2D change of basis to the camera's sans-Y
        return vec3.set(result, 
            local[0] * -flatView[2] + local[2] * flatView[0],
            0,
            local[0] * flatView[0] + local[2] * flatView[2]
        );
    }
}