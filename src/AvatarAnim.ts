
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
    onResourcesLoaded(animations: AnimationClip[], debugMenu: DebugMenu) {
        this.debugMenu = debugMenu.addFolder('Animation');
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

    update(dtSec: number) {
        if (this.debugAnimation) this.debugAnimationMixer.update(dtSec);

        this.targetAvatar.updateMatrixWorld();
        this.targetAvatar.skeleton.update();

        return this.debugAnimation;
    }
}

interface AvatarAnimData {
    aIdle: AnimationAction;
    aWalk: AnimationAction;
    aRun: AnimationAction;
    startingFoot: number;
}

export class AvatarAnim {
    avatars: Avatar[];
    data: AvatarAnimData[] = [];
    ready = false;
    
    debugMenu: AnimationDebugMenu;

    initialize(avatars: Avatar[]) {
        this.avatars = avatars;
        this.debugMenu = new AnimationDebugMenu(this.avatars[0]);
    }

    onResourcesLoaded(gltf: GltfResource, debugMenu: DebugMenu) {
        const idleClip = assertDefined(gltf.animations.find(a => a.name === 'await1'));
        const walkClip = assertDefined(gltf.animations.find(a => a.name === 'awalk1'));
        const runClip = assertDefined(gltf.animations.find(a => a.name === 'brun1'));

        for (let i = 0; i < this.avatars.length; i++) {
            const avatar = this.avatars[i];
            
            // Buffer the animation clips now
            this.data[i] = {
                aIdle: avatar.animationMixer.clipAction(idleClip),
                aWalk: avatar.animationMixer.clipAction(walkClip),
                aRun: avatar.animationMixer.clipAction(runClip),
                startingFoot: 0,
            };

            const data = this.data[i];
            data.aIdle.play().setEffectiveWeight(1.0);
            data.aWalk.play().setEffectiveWeight(0.0);
            data.aRun.play().setEffectiveWeight(0.0);

            // Give each avatar a different idle phase, so their animations don't appear to sync
            data.aIdle.time = i * (data.aIdle.getClip().duration / (this.avatars.length + 1)); 

            data.aWalk.time = kWalkStartStopTimes[data.startingFoot] * data.aWalk.getClip().duration;
            data.aRun.time = kRunStartStopTimes[data.startingFoot] * data.aRun.getClip().duration;
        }

        this.debugMenu.onResourcesLoaded(gltf.animations, debugMenu);

        this.ready = true;
    }

    update(states: AvatarState[], dtSec: number) {
        if (!this.ready) return;

        for (let i = 0; i < states.length; i++) {
            const data = this.data[i];
            const avatar = this.avatars[i];
            const state = states[i];

            if (!avatar.active) {
                continue;
            }
            
            if (avatar.local) {
                const debugActive = this.debugMenu.update(dtSec);
                if (debugActive) { continue; }
            }

            const speed = vec3.length(state.velocity);
            const isWalking = state.flags & AvatarFlags.IsWalking;
            const isUTurning = state.flags & AvatarFlags.IsUTurning;

            data.aIdle.weight = saturate(1.0 - speed / kAvatarWalkSpeed);
            data.aRun.weight = saturate(delerp(isWalking ? kAvatarWalkSpeed : 0, kAvatarRunSpeed, speed));
            data.aRun.timeScale = data.aRun.weight;
            data.aWalk.weight = saturate(delerp(0, kAvatarWalkSpeed, speed)) - data.aRun.weight;
            data.aWalk.timeScale = data.aWalk.weight;

            // if (isUTurning) {
            //     this.aWalk.timeScale = -1.0;
            // }

            if (speed <= 0.0) {
                // Reset the walk animation so we always start from the same position when we begin walking again
                data.aWalk.time = kWalkStartStopTimes[data.startingFoot] * data.aWalk.getClip().duration;
                data.aRun.time = kRunStartStopTimes[data.startingFoot] * data.aRun.getClip().duration;
                data.startingFoot = (data.startingFoot + 1) % 2;
            }

            avatar.animationMixer.update(dtSec);            

            avatar.updateMatrixWorld();
            avatar.skeleton.update();
        }
    }
}