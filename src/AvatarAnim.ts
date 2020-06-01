
import { DebugMenu, IDebugMenu } from "./DebugMenu";
import { delerp, saturate, smoothstep } from "./MathHelpers";
import { AnimationClip, AnimationMixer, AnimationAction } from "./Animation";
import { assertDefined, defined } from "./util";
import { Avatar, AvatarFlags } from "./Avatar";
import { GltfResource } from "./resources/Gltf";
import { Clock } from "./Clock";
import { kAvatarRunSpeed } from "./AvatarController";
import { LoopOnce } from "three/src/constants";
import { AvatarState } from "./AvatarState";

const kWalkStartStopTimes = [0.25, 0.75]; // Normalized times at which one foot is on the ground and the body is centered over its position
const kRunStartStopTimes = [0.15, 0.65];

class AnimationDebugMenu {
    debugMenu: IDebugMenu;
    debugAnimation?: AnimationAction;
    debugAnimationMixer: AnimationMixer;

    constructor(private targetAvatar: Avatar) { }

    // Populate a DebugMenu folder with functions to play (and control) all possible animations 
    onResourcesLoaded(animations: AnimationClip[], debugMenu: DebugMenu) {
        this.debugMenu = debugMenu.addFolder('Animation');
        this.debugAnimationMixer = new AnimationMixer(this.targetAvatar);

        const funcs = {
            that: this,

            togglePaused: () => { if (this.debugAnimation) this.debugAnimation.paused = !this.debugAnimation.paused },
            stop: () => { if (this.debugAnimation) { this.debugAnimation.stop(); this.debugAnimation = undefined; } },

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
                this.debugAnimation = this.debugAnimationMixer.clipAction(anim, this.targetAvatar).reset().play();
            };
            this.debugMenu.add(playAnimMap, anim.name);
        }
    }

    update(targetAvatar: Avatar, dtSec: number) {
        this.targetAvatar = targetAvatar;
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
    aAttackSide: AnimationAction;
    aAttackVert: AnimationAction;
    aAttackPunch: AnimationAction;
    aStruck: AnimationAction;
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
        const idleClip = assertDefined(gltf.animations.find(a => a.name === 'akamae1'));
        const walkClip = assertDefined(gltf.animations.find(a => a.name === 'awalk1'));
        const runClip = assertDefined(gltf.animations.find(a => a.name === 'brun1'));
        const attackSideClip = assertDefined(gltf.animations.find(a => a.name === 'aat_yoko1'));
        const attackVertClip = assertDefined(gltf.animations.find(a => a.name === 'bat_jump1'));
        const attackPunchClip = assertDefined(gltf.animations.find(a => a.name === 'bat_syoutei_l1'));
        const struckClip = assertDefined(gltf.animations.find(a => a.name === 'ahakai1'));

        for (let i = 0; i < this.avatars.length; i++) {
            const avatar = this.avatars[i];

            // Buffer the animation clips now
            this.data[i] = {
                aIdle: avatar.animationMixer.clipAction(idleClip),
                aWalk: avatar.animationMixer.clipAction(walkClip),
                aRun: avatar.animationMixer.clipAction(runClip),
                aAttackSide: avatar.animationMixer.clipAction(attackSideClip),
                aAttackVert: avatar.animationMixer.clipAction(attackVertClip),
                aAttackPunch: avatar.animationMixer.clipAction(attackPunchClip),
                aStruck: avatar.animationMixer.clipAction(struckClip),
                startingFoot: 0,
            };

            const data = this.data[i];
            data.aIdle.play().setEffectiveWeight(1.0);
            data.aWalk.play().setEffectiveWeight(0.0);
            data.aRun.play().setEffectiveWeight(0.0);
            data.aAttackSide.play().setEffectiveWeight(0.0);
            data.aAttackVert.play().setEffectiveWeight(0.0);
            data.aAttackPunch.play().setEffectiveWeight(0.0);
            data.aStruck.play().setEffectiveWeight(0.0);

            // Attacks don't loop
            data.aAttackSide.setLoop(LoopOnce, 1);
            data.aAttackVert.setLoop(LoopOnce, 1);
            data.aAttackPunch.setLoop(LoopOnce, 1);

            // Give each avatar a different idle phase, so their animations don't appear to sync
            data.aIdle.time = i * (data.aIdle.getClip().duration / (this.avatars.length + 1));

            data.aWalk.time = kWalkStartStopTimes[data.startingFoot] * data.aWalk.getClip().duration;
            data.aRun.time = kRunStartStopTimes[data.startingFoot] * data.aRun.getClip().duration;
        }

        this.debugMenu.onResourcesLoaded(gltf.animations, debugMenu);

        this.ready = true;
    }

    apply(avatar: Avatar, data: AvatarAnimData, clock: Clock) {
        const state = avatar.state;
        let remainingWeight = 1.0;

        const idleTime = clock.renderTime / 1000.0;
        const locoTime = idleTime;
        const stateTime = (clock.renderTime - state.stateStartFrame * clock.simDt) * 0.001;

        // Attack 
        let attackWeight = 0.0;
        if (state.state === AvatarState.AttackSide || state.state === AvatarState.AttackVertical || state.state === AvatarState.AttackPunch) {
            attackWeight = Math.min(
                saturate(delerp(0.0, 0.2, stateTime)),
                1.0 - saturate(delerp(0.9, 1.0, stateTime / data.aAttackSide.getClip().duration)),
            );
        } else {
            attackWeight = 0.0;
        }
        remainingWeight -= attackWeight;

        // Struck
        let struckWeight = 0.0;
        if (state.state === AvatarState.Struck) {
            struckWeight = Math.min(
                saturate(delerp(0.0, 0.1, stateTime)),
                1.0 - saturate(delerp(0.444, 0.544, stateTime)),
            );
        }
        remainingWeight -= struckWeight;

        let locoWeight = remainingWeight * saturate(delerp(0, kAvatarRunSpeed, state.speed));
        let idleWeight = remainingWeight * saturate(delerp(kAvatarRunSpeed, 0, state.speed));

        data.aRun.time = locoTime % data.aRun.getClip().duration;
        data.aIdle.time = idleTime % data.aIdle.getClip().duration;
        data.aAttackSide.time = stateTime % data.aAttackSide.getClip().duration;
        data.aAttackVert.time = stateTime % data.aAttackVert.getClip().duration;
        data.aAttackPunch.time = stateTime % data.aAttackPunch.getClip().duration;
        data.aStruck.time = stateTime % data.aStruck.getClip().duration;
        
        data.aRun.weight = locoWeight;
        data.aIdle.weight = idleWeight;
        data.aAttackSide.weight = state.state === AvatarState.AttackSide ? attackWeight : 0;
        data.aAttackVert.weight = state.state === AvatarState.AttackVertical ? attackWeight : 0;
        data.aAttackPunch.weight = state.state === AvatarState.AttackPunch ? attackWeight : 0;
        data.aStruck.weight = struckWeight;
        
        avatar.animationMixer.update(0);
        avatar.updateMatrixWorld();
        avatar.skeleton.update();
    }

    update(clock: Clock) {
        if (!this.ready) return;
        const dtSec = clock.renderDt * 0.001;

        for (let i = 0; i < this.avatars.length; i++) {
            const data = this.data[i];
            const avatar = this.avatars[i];
            
            if (avatar.local) {
                const debugActive = this.debugMenu.update(avatar, dtSec);
                if (debugActive) { continue; }
            }

            if (avatar.isActive) this.apply(avatar, data, clock);
        }
    }
}