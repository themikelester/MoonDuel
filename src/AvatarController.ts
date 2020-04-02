import { GltfResource } from "./resources/Gltf";
import { assertDefined, defined } from "./util";
import { AnimationClip, AnimationMixer, AnimationAction } from "./resources/Animation";
import { Avatar } from "./Avatar";
import { Clock } from "./Clock";
import { DebugMenu, IDebugMenu } from "./DebugMenu";
import { vec3, mat2 } from "gl-matrix";
import { InputManager } from "./Input";
import { Camera } from "./Camera";
import { Vector3 } from "./Object3D";
import { clamp, angularDistance, wrappedDistance } from "./MathHelpers";

const scratchVec3A = vec3.create();
const scratchVec3B = vec3.create();
const scratchVector3A = new Vector3(scratchVec3A);

const kWalkStartStopTimes = [0.25, 0.75]; // Normalized times at which one foot is on the ground and the body is centered over its position

/**
 * Drive each Avatar's skeleton, position, oriention, and animation
 */
export class AvatarController {
    ready: boolean = false;
    animations: AnimationClip[];
    localController = new LocalController();

    avatars: Avatar[];
    local: Avatar;

    debugMenu: AnimationDebugMenu;

    initialize(avatars: Avatar[]) {
        this.avatars = avatars;
        this.local = avatars[0];
        this.localController.initialize(this.local);
        this.debugMenu = new AnimationDebugMenu(this.local);
    }

    onResourcesLoaded(gltf: GltfResource) {
        this.animations = gltf.animations;        
        this.localController.onResourcesLoaded(gltf);
        this.debugMenu.onResourcesLoaded(this.animations);
        this.ready = true;
    }

    update({ clock, input, camera }: { clock: Clock, input: InputManager, camera: Camera }) {
        if (!this.ready) return;

        const debugActive = this.debugMenu.update(clock);
        if (debugActive) { return; }

        this.localController.update(clock, input, camera);

        for (const avatar of this.avatars) {
            avatar.animationMixer.update(clock.dt / 1000.0);            

            avatar.updateMatrixWorld();
            avatar.skeleton.update();
        }
    }
}

class AnimationDebugMenu {
    debugMenu: IDebugMenu;
    debugAnimation?: AnimationAction;
    debugAnimationMixer: AnimationMixer;

    constructor(private targetAvatar: Avatar) {}

    // Populate a DebugMenu folder with functions to play (and control) all possible animations 
    onResourcesLoaded(animations: AnimationClip[]) {
        this.debugMenu = DebugMenu.addFolder('Animation');
        this.debugAnimationMixer = new AnimationMixer(this.targetAvatar);

        const funcs = {
            that: this,

            togglePaused: () => { if(this.debugAnimation) this.debugAnimation.paused = !this.debugAnimation.paused },
            stop: () => { if(this.debugAnimation) { this.debugAnimation.stop(); this.debugAnimation = undefined; } },

            get time() { 
                if (defined(this.that.debugAnimation)) {
                    const time = this.that.debugAnimation.time;
                    const normalizedTime = time / this.that.debugAnimation.getClip().duration;
                    return normalizedTime;
                } else return 0.0;
            },
            set time(normalizedTime: number) { 
                if (defined(this.that.debugAnimation)) {
                    this.that.debugAnimation.paused = true;
                    this.that.debugAnimation.time = normalizedTime * this.that.debugAnimation.getClip().duration;
                }
            },
        }

        this.debugMenu.add(funcs, 'togglePaused');
        this.debugMenu.add(funcs, 'stop');
        this.debugMenu.add(funcs, 'time', 0.0, 1.0, 0.01);

        const playAnimMap: { [name: string]: () => void } = {};
        for (const anim of animations) {
            playAnimMap[anim.name] = () => {
                this.debugAnimationMixer.stopAllAction();
                this.debugAnimation = this.debugAnimationMixer.clipAction(anim).reset().play();
            };
            this.debugMenu.add(playAnimMap, anim.name);
        }
    }

    update(clock: Clock) {
        if (this.debugAnimation) this.debugAnimationMixer.update(clock.dt / 1000.0);

        this.targetAvatar.updateMatrixWorld();
        this.targetAvatar.skeleton.update();

        return this.debugAnimation;
    }
}

class LocalController {
    avatar: Avatar;
    animations?: AnimationClip[];

    speed: number = 0;
    velocity: vec3 = vec3.create();
    velocityTarget: vec3 = vec3.create();
    
    orientation: vec3 = vec3.create();
    orientationTarget: vec3 = vec3.create();

    uTurning: boolean = false;
    walking: boolean = false;

    // Animations
    aIdle: AnimationAction;
    aWalk: AnimationAction;

    startingFoot = 0;

    initialize(avatar: Avatar) {
        this.avatar = avatar;
    }

    onResourcesLoaded(gltf: GltfResource) {
        this.animations = gltf.animations;

        // Buffer the animation clips now
        this.aIdle = this.avatar.animationMixer.clipAction(assertDefined(gltf.animations.find(a => a.name === 'await1')));
        this.aWalk = this.avatar.animationMixer.clipAction(assertDefined(gltf.animations.find(a => a.name === 'awalk1')));

        this.aIdle.play().setEffectiveWeight(1.0);
        this.aWalk.play().setEffectiveWeight(0.0);
    }

    update(clock: Clock, input: InputManager, camera: Camera) {
        const walkSpeed = 150; // Units per second
        const dtSec = clock.dt / 1000.0; // TODO: Clock.dt should be in seconds

        this.avatar.updateMatrixWorld();
        vec3.set(this.orientation, this.avatar.matrixWorld.elements[8], this.avatar.matrixWorld.elements[9], this.avatar.matrixWorld.elements[10]);

        const inputDir = this.getCameraRelativeMovementDirection(input, camera, scratchVec3B);
        const inputActive = vec3.length(inputDir) > 0.1;
        
        // Velocity
        if (inputActive) {
            this.speed += 600 * dtSec;
            this.speed = Math.min(this.speed, walkSpeed);
        } else {
            this.speed -= 600 * dtSec;
            this.speed = Math.max(this.speed, 0);
        }

        this.velocityTarget = vec3.copy(this.velocityTarget, inputDir);
        this.velocity = vec3.scale(this.velocity, this.velocityTarget, this.speed);

        this.aWalk.weight = this.speed / walkSpeed;
        this.aIdle.weight = 1.0 - this.aWalk.weight;
        this.aWalk.timeScale = this.aWalk.weight;

        // Position
        this.avatar.position.addScaledVector(scratchVector3A.setBuffer(this.velocity), dtSec);

        // Orientation
        let shouldTurn = inputActive;

        let standingTurnSpeed = Math.PI * 3.75; // 4 30ms frames to turn 90 degrees
        let walkingTurnSpeed = Math.PI * 1.875; // 8 30ms frames to turn 90 degrees
        let runningTurnSpeed = Math.PI * 1.875; // 8 30ms frames to turn 90 degrees
        
        // State transitions
        if (this.uTurning) {
            // Uturn complete when we achieve the initial orientation target
            if (vec3.dot(this.orientation, this.orientationTarget) > 0.99) {
                this.uTurning = false;
                this.aWalk.timeScale = 1.0
            }
        } else {
            // Start a 180 if we have a sharp input pointing directly away from our current orientation 
            if (vec3.dot(inputDir, this.orientationTarget) < -0.99) {
                this.uTurning = true;
                this.aWalk.timeScale = -1.0
                vec3.copy(this.orientationTarget, inputDir);
            }
        }

        this.walking = this.speed > 0;

        // State evaluations
        let turnSpeedRadsPerSec = this.walking ? walkingTurnSpeed : standingTurnSpeed;
        if (this.uTurning) {
            shouldTurn = true; // Don't require user input to complete the 180
            turnSpeedRadsPerSec *= 2.0;
            this.orientationTarget = this.orientationTarget; // Don't update orientation target
        } else {
            if (inputActive) vec3.copy(this.orientationTarget, inputDir);
        }

        if (!this.walking) {
            // Reset the walk animation so we always start from the same position when we begin walking again
            this.aWalk.time = kWalkStartStopTimes[this.startingFoot] * this.aWalk.getClip().duration;
            this.startingFoot = (this.startingFoot + 1) % 2;
        }
        
        // Each frame, turn towards the input direction by a fixed amount, but only if the input is pressed. 
        // It takes 8 16ms frames to turn 90 degrees. So a full rotation takes about half of a second.
        if (shouldTurn) {
            const heading = Math.atan2(this.avatar.matrixWorld.elements[8], this.avatar.matrixWorld.elements[10]);
            const targetHeading = Math.atan2(this.orientationTarget[0], this.orientationTarget[2]);
            
            let angleDelta = angularDistance(heading, targetHeading);
            const turnCap = turnSpeedRadsPerSec * dtSec;

            this.avatar.rotateY(clamp(angleDelta, -turnCap, turnCap));
        }

        this.avatar.updateMatrix();
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