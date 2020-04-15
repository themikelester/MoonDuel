
import { DebugMenu, IDebugMenu } from "./DebugMenu";
import { delerp, saturate } from "./MathHelpers";
import { AnimationClip, AnimationMixer, AnimationAction } from "./Animation";
import { assertDefined, defined } from "./util";
import { Avatar, AvatarState, AvatarFlags } from "./Avatar";
import { GltfResource } from "./resources/Gltf";
import { Clock } from "./Clock";
import { vec3 } from "gl-matrix";
import { kAvatarWalkSpeed, kAvatarRunSpeed } from "./AvatarController";

const kWalkStartStopTimes = [0.25, 0.75]; // Normalized times at which one foot is on the ground and the body is centered over its position
const kRunStartStopTimes = [0.15, 0.65];

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

export class AvatarAnim {
    avatar: Avatar;
    ready = false;
    
    aIdle: AnimationAction;
    aWalk: AnimationAction;
    aRun: AnimationAction;

    startingFoot = 0;

    debugMenu: AnimationDebugMenu;

    initialize(avatar: Avatar) {
        this.avatar = avatar;
        this.debugMenu = new AnimationDebugMenu(this.avatar);
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

        this.debugMenu.onResourcesLoaded(gltf.animations);

        this.ready = true;
    }

    update(state: AvatarState, dtSec: number) {
        if (!this.ready) return;

        const speed = vec3.length(state.velocity);
        const isWalking = state.flags & AvatarFlags.IsWalking;
        const isUTurning = state.flags & AvatarFlags.IsUTurning;

        this.aIdle.weight = saturate(1.0 - speed / kAvatarWalkSpeed);
        this.aRun.weight = saturate(delerp(isWalking ? kAvatarWalkSpeed : 0, kAvatarRunSpeed, speed));
        this.aRun.timeScale = this.aRun.weight;
        this.aWalk.weight = saturate(delerp(0, kAvatarWalkSpeed, speed)) - this.aRun.weight;
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

        this.avatar.animationMixer.update(dtSec);            

        this.avatar.updateMatrixWorld();
        this.avatar.skeleton.update();
    }
}