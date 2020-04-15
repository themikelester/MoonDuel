import { GltfResource } from "./resources/Gltf";
import { assertDefined, defined } from "./util";
import { AnimationClip, AnimationMixer, AnimationAction } from "./Animation";
import { Avatar } from "./Avatar";
import { Clock } from "./Clock";
import { DebugMenu, IDebugMenu } from "./DebugMenu";
import { vec3, mat2 } from "gl-matrix";
import { InputManager, UserCommand, InputAction } from "./Input";
import { Camera } from "./Camera";
import { Vector3 } from "./Object3D";
import { clamp, angularDistance, wrappedDistance, delerp, saturate } from "./MathHelpers";

const scratchVec3A = vec3.create();
const scratchVec3B = vec3.create();
const scratchVector3A = new Vector3(scratchVec3A);

const kWalkStartStopTimes = [0.25, 0.75]; // Normalized times at which one foot is on the ground and the body is centered over its position
const kRunStartStopTimes = [0.15, 0.65];
const kWalkSpeed = 150; // Units per second
const kRunSpeed = 600; // Units per second
const kWalkAcceleration = 600;
const kRunAcceleration = 3000;

enum AvatarFlags {
    IsWalking = 1 << 0,
    IsUTurning = 1 << 1,
}

class AvatarState {
    pos: vec3 = vec3.create();
    velocity: vec3 = vec3.create();
    flags: AvatarFlags = 0;
}

/**
 * Drive each Avatar's skeleton, position, oriention, and animation
 */
export class AvatarController {
    ready: boolean = false;
    animations: AnimationClip[];
    avatarAnim = new AvatarAnim();
    localController = new LocalController();

    prevState: AvatarState = new AvatarState();

    avatars: Avatar[];
    local: Avatar;

    debugMenu: AnimationDebugMenu;

    initialize(avatars: Avatar[]) {
        this.avatars = avatars;
        this.local = avatars[0];
        this.localController.initialize(this.local);
        this.avatarAnim.initialize(this.local);
        this.debugMenu = new AnimationDebugMenu(this.local);
    }

    onResourcesLoaded(gltf: GltfResource) {
        this.animations = gltf.animations;        
        this.avatarAnim.onResourcesLoaded(gltf);
        this.debugMenu.onResourcesLoaded(this.animations);
        this.ready = true;
    }

    updateFixed({ clock, input }: { clock: Clock, input: InputManager }) {
        if (!this.ready) return;

        // const debugActive = this.debugMenu.update(clock);
        // if (debugActive) { return; }

        const inputCmd = input.getUserCommand();
        const dtSec = clock.simStep / 1000.0;
        const state = this.localController.update(this.prevState, dtSec, inputCmd);
        this.avatarAnim.update(state);

        for (const avatar of this.avatars) {
            avatar.animationMixer.update(clock.simStep / 1000.0);            

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

    speed: number = 0;
    velocity: vec3 = vec3.create();
    velocityTarget: vec3 = vec3.create();
    
    orientation: vec3 = vec3.create();
    orientationTarget: vec3 = vec3.create();

    uTurning: boolean = false;
    walking: boolean = false;

    initialize(avatar: Avatar) {
        this.avatar = avatar;
    }
    
    update(prevState: AvatarState, dtSec: number, input: UserCommand): AvatarState {
        this.avatar.updateMatrixWorld();
        vec3.set(this.orientation, this.avatar.matrixWorld.elements[8], this.avatar.matrixWorld.elements[9], this.avatar.matrixWorld.elements[10]);

        const inputDir = this.getCameraRelativeMovementDirection(input, scratchVec3B);
        const inputActive = vec3.length(inputDir) > 0.1;
        const inputShouldWalk = input.actions & InputAction.Walk;
        
        // Velocity
        const accel = inputShouldWalk ? kWalkAcceleration : kRunAcceleration;
        const maxSpeed = inputShouldWalk ? kWalkSpeed : kRunSpeed;

        const dSpeed = (inputActive ? accel : -accel) * dtSec;
        const targetSpeed = clamp(this.speed + dSpeed, 0, maxSpeed); 

        this.speed += clamp(
            targetSpeed - this.speed, 
            -accel * dtSec,
            accel * dtSec,
        );

        this.velocityTarget = vec3.copy(this.velocityTarget, this.orientation);
        this.velocity = vec3.scale(this.velocity, this.velocityTarget, this.speed);

        // Position
        const pos = vec3.scaleAndAdd(vec3.create(), prevState.pos, this.velocity, dtSec);
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
            }
        } else {
            // Start a 180 if we have a sharp input pointing directly away from our current orientation 
            if (vec3.dot(inputDir, this.orientationTarget) < -0.99) {
                this.uTurning = true;
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

        let flags = 0;
        if (inputShouldWalk) flags |= AvatarFlags.IsWalking;
        if (this.uTurning) flags |= AvatarFlags.IsUTurning;
        const state: AvatarState = {
            pos,
            velocity: this.velocity,
            flags
        }
        return state;
    }

    private getWorldRelativeMovementDirection(input: UserCommand, result: vec3): vec3 {
        const x = input.horizontalAxis;
        const z = input.verticalAxis;
        return vec3.normalize(result, vec3.set(result, x, 0, z));
    }

    private getCameraRelativeMovementDirection(input: UserCommand, result: vec3): vec3 {
        const local = this.getWorldRelativeMovementDirection(input, result);
        const flatView = vec3.normalize(scratchVec3A, vec3.set(scratchVec3A, input.headingX, 0, input.headingZ));
        
        // 2D change of basis to the camera's sans-Y
        return vec3.set(result, 
            local[0] * -flatView[2] + local[2] * flatView[0],
            0,
            local[0] * flatView[0] + local[2] * flatView[2]
        );
    }
}

class AvatarAnim {
    avatar: Avatar;
    
    aIdle: AnimationAction;
    aWalk: AnimationAction;
    aRun: AnimationAction;

    startingFoot = 0;

    initialize(avatar: Avatar) {
        this.avatar = avatar;
    }

    onResourcesLoaded(gltf: GltfResource) {
        // Buffer the animation clips now
        this.aIdle = this.avatar.animationMixer.clipAction(assertDefined(gltf.animations.find(a => a.name === 'await1')));
        this.aWalk = this.avatar.animationMixer.clipAction(assertDefined(gltf.animations.find(a => a.name === 'awalk1')));
        this.aRun = this.avatar.animationMixer.clipAction(assertDefined(gltf.animations.find(a => a.name === 'brun1')));

        this.aIdle.play().setEffectiveWeight(1.0);
        this.aWalk.play().setEffectiveWeight(0.0);
        this.aRun.play().setEffectiveWeight(0.0);

        this.aWalk.time = kWalkStartStopTimes[this.startingFoot] * this.aWalk.getClip().duration;
        this.aRun.time = kRunStartStopTimes[this.startingFoot] * this.aRun.getClip().duration;
    }

    update(avatar: AvatarState) {
        const speed = vec3.length(avatar.velocity);
        const isWalking = avatar.flags & AvatarFlags.IsWalking;
        const isUTurning = avatar.flags & AvatarFlags.IsUTurning;

        this.aIdle.weight = saturate(1.0 - speed / kWalkSpeed);
        this.aRun.weight = saturate(delerp(isWalking ? kWalkSpeed : 0, kRunSpeed, speed));
        this.aRun.timeScale = this.aRun.weight;
        this.aWalk.weight = saturate(delerp(0, kWalkSpeed, speed)) - this.aRun.weight;
        this.aWalk.timeScale = this.aWalk.weight;

        // if (isUTurning) {
        //     this.aWalk.timeScale = -1.0;
        // }

        if (speed <= 0.0) {
            // Reset the walk animation so we always start from the same position when we begin walking again
            this.aWalk.time = kWalkStartStopTimes[this.startingFoot] * this.aWalk.getClip().duration;
            this.aRun.time = kRunStartStopTimes[this.startingFoot] * this.aRun.getClip().duration;
            this.startingFoot = (this.startingFoot + 1) % 2;
        }
    }
}