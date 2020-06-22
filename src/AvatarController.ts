import { AvatarFlags, Avatar, kAvatarCount } from "./Avatar";
import { vec3, quat, vec4 } from "gl-matrix";
import { InputAction } from "./Input";
import { clamp, angularDistance, ZeroVec3, normToLength, rotateTowardXZ, rotateXZ, lerp, getPointHermite } from "./MathHelpers";
import { UserCommand } from "./UserCommand";
import { EntityState, copyEntity, createEntity } from "./World";
import { assert, defined } from "./util";
import { Attack, evaluateHit } from "./Attack";
import { AvatarState } from "./AvatarState";
import { setFlag, setField, clearFlags } from "./Flags";
import { DebugRenderUtils } from "./DebugRender";
import { CollisionSystem } from "./Collision";

const scratchVec3A = vec3.create();
const scratchVec3B = vec3.create();
const scratchVec3C = vec3.create();
const scratchVec3D = vec3.create();

export const kAvatarWalkSpeed = 150; // Units per second
export const kAvatarRunSpeed = 600; // Units per second
const kWalkAcceleration = 600;
const kRunAcceleration = 3000;

interface SimContext {
    avatar: Avatar;
    avatars: Avatar[];
    readonly state: EntityState;
    readonly frame: number, 
    readonly dtSec: number, 
    readonly input: UserCommand
    readonly collision: CollisionSystem;

    // @NOTE: These will break the simulation if we try to rewind
    rollOrigin: vec3;
}

interface AvatarStateController {
    enter(context: SimContext): void;
    exit(context: SimContext): void;

    evaluate(context: SimContext): AvatarState;
    simulate(context: SimContext): EntityState;
}

class AttackRoll implements AvatarStateController {
    tag = AvatarState.AttackPunch;

    enter(context: SimContext) {
        context.avatar.attack = new Attack(context.avatar, context.state.state);

        vec3.copy(context.rollOrigin, context.state.origin);
    }

    exit(context: SimContext) {
        context.avatar.attack = null;
    }

    evaluate(context: SimContext): AvatarState {
        const duration = context.frame - context.state.stateStartFrame;
        if (duration >= context.avatar.attack!.def.duration) { // @HACK: Need to set up proper exiting
            return AvatarState.None;
        }
        return context.state.state;
    }

    simulate(context: SimContext) {
        const prevState = context.state;
        const nextState = copyEntity(createEntity(), prevState);

        const duration = context.frame - prevState.stateStartFrame;
        const attack = context.avatar.attack!;

        if (context.avatar.target && duration >= attack.def.movePeriod[0] && duration <= attack.def.movePeriod[1]) {
            const targetPos = context.avatar.target.state.origin;
            const targetOri = context.avatar.target.state.orientation;

            // Rolls are handled a bit differently
            const frameRange = attack.def.movePeriod[1] - attack.def.movePeriod[0];
            const range = attack.def.moveSpeed * 0.016 * frameRange;
            const t = Math.min(1.0, duration / frameRange);
            
            const attackVec = vec3.subtract(scratchVec3D, targetPos, context.rollOrigin);
            const targetDist = vec3.length(attackVec);
            
            const idealOffset = vec3.normalize(scratchVec3B, rotateXZ(scratchVec3B, attackVec, - Math.PI * 0.7));
            const idealPos = vec3.scaleAndAdd(scratchVec3A, targetPos, idealOffset, -attack.def.idealDistance);

            // Interpolate position along the curve
            const normEnd = normToLength(idealOffset, 2 * targetDist);
            const normStart = normToLength(rotateXZ(scratchVec3C, attackVec, Math.PI * 0.4), 3 * targetDist);
            const posStart = context.rollOrigin;
            const posEnd = idealPos;
            nextState.origin[0] = getPointHermite(posStart[0], posEnd[0], normStart[0], normEnd[0], t);
            nextState.origin[2] = getPointHermite(posStart[2], posEnd[2], normStart[2], normEnd[2], t);

            // Modify orientation to look at target
            const oriVel = Math.PI * 2;
            const toTarget = vec3.subtract(scratchVec3D, targetPos, prevState.origin);
            rotateTowardXZ(nextState.orientation, prevState.orientation, toTarget, oriVel * context.dtSec);
            assert(Math.abs(1.0 - vec3.length(nextState.orientation)) < 0.001);

            // @DEBUG
            const debugPos: vec3[] = [];
            const debugNorm: vec3[] = [];
            const kSampleCount = 8;
            for (let i = 0; i < kSampleCount; i++) {
                const pos = vec3.create();
                const x = i / (kSampleCount-1);

                pos[0] = getPointHermite(posStart[0], posEnd[0], normStart[0], normEnd[0], x);
                pos[2] = getPointHermite(posStart[2], posEnd[2], normStart[2], normEnd[2], x);

                debugPos[i] = pos;
                if (i > 0) debugNorm[i-1] = vec3.subtract(vec3.create(), pos, debugPos[i-1]);
            }
            debugNorm[kSampleCount-1] = vec3.create();
            DebugRenderUtils.renderArrows(debugPos, debugNorm, 10, true, vec4.fromValues(0, 1, 0, 1));
        }

        nextState.flags = clearFlags(nextState.flags, AvatarFlags.IsUTurning);
        nextState.speed = 0;
        return nextState;
    }
}

class AttackBase implements AvatarStateController {
    enter(context: SimContext) {
        context.avatar.attack = new Attack(context.avatar, context.state.state);

        vec3.copy(context.rollOrigin, context.state.origin);
    }

    exit(context: SimContext) {
        context.avatar.attack = null;
    }

    evaluate(context: SimContext): AvatarState {
        const duration = context.frame - context.state.stateStartFrame;
        if (duration >= context.avatar.attack!.def.duration) { // @HACK: Need to set up proper exiting
            return AvatarState.None;
        }
        return context.state.state;
    }

    simulate(context: SimContext) {
        const nextState = copyEntity(createEntity(), context.state);

        const duration = context.frame - context.state.stateStartFrame;
        const attack = context.avatar.attack!;

        let toTarget = scratchVec3D;
        let dir = vec3.copy(scratchVec3A, context.state.orientation);
        let moveSpeed = 0;
        let oriVel = 0;
        if (context.avatar.target && duration >= attack.def.movePeriod[0] && duration <= attack.def.movePeriod[1]) {
            const targetPos = context.avatar.target.state.origin;
            const targetOri = context.avatar.target.state.orientation;
                        
            // Normalized XZ direction from avatar to target
            const v = vec3.subtract(toTarget, targetPos, context.state.origin);
            v[1] = 0;
            const l = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
            vec3.scale(v, v, 1.0 / l);

            // Signed distance to travel along v to reach ideal position
            const d = l - attack.def.idealDistance;
            vec3.scale(dir, v, Math.sign(d));

            // Ensure we don't travel past our ideal position this frame
            moveSpeed = Math.min(attack.def.moveSpeed, Math.abs(d) / context.dtSec);

            // Modify orientation to look at target
            oriVel = Math.PI * 2;
        }

        // If we have leftover running momentum, apply it
        const kGroundDecel = -1000;
        const contrib = Math.max(0, vec3.dot(context.state.orientation, nextState.orientation));
        const slideSpeed = context.state.speed * contrib;
        nextState.speed = Math.max(0, context.state.speed + kGroundDecel * context.dtSec);

        const vel = vec3.scale(scratchVec3A, dir, moveSpeed + slideSpeed);
        vec3.scaleAndAdd(nextState.origin, context.state.origin, vel, context.dtSec);

        rotateTowardXZ(nextState.orientation, context.state.orientation, toTarget, oriVel * context.dtSec);
        assert(Math.abs(1.0 - vec3.length(nextState.orientation)) < 0.001);

        nextState.flags = clearFlags(nextState.flags, AvatarFlags.IsUTurning);
        return nextState;
    }
}

/**
 * Drive each Avatar's skeleton, position, oriention, and animation
 */
export class AvatarController {
    lastNonTargetingFrame = 0;
    stateStartFrame = 0;
    
    // @NOTE: These will break the simulation if we try to rewind
    orientationTarget: vec3 = vec3.create();
    hitVelocity: vec3 = vec3.create();
    rollOrigin: vec3 = vec3.create();

    stateControllers: Partial<Record<AvatarState, AvatarStateController>>;

    initialize() {
        this.stateControllers = {
            [AvatarState.AttackPunch]: new AttackRoll(),
            [AvatarState.AttackSide]: new AttackBase(),
            [AvatarState.AttackVertical]: new AttackBase(),
        }
    }

    update(avatar: Avatar, avatars: Avatar[], frame: number, dtSec: number, input: UserCommand, collision: CollisionSystem): EntityState {
        const context: SimContext = { avatar, avatars, frame, dtSec, input, collision, state: avatar.state, 
            rollOrigin: this.rollOrigin 
        };

        let nextState: AvatarState;
        let stateCtrl = this.stateControllers[context.state.state as AvatarState];

        if (defined(stateCtrl)) {
            nextState = stateCtrl.evaluate(context);

            // Switch states if necessary
            if (nextState !== context.state.state) { 
                stateCtrl.exit(context); 
                stateCtrl = this.stateControllers[nextState];
                stateCtrl?.enter(context);
            }
        } else {
            nextState = this.legacyEvaluate(avatar, avatars, frame, dtSec, input);
            this.handleStateSwitch(nextState, avatar, avatars, frame, dtSec, input);
        }

        // Run the simulation
        let state;
        if (stateCtrl) { state = stateCtrl.simulate(context); }
        else { state = this.legacySimulate(nextState, avatar, avatars, frame, dtSec, input); }
        
        avatar.state = state;
        return state;
    }

    updateLate(avatar: Avatar, avatars: Avatar[], frame: number, dtSec: number, input: UserCommand, collision: CollisionSystem) {
        const avState = this.legacyEvaluateLate(avatar, avatars, frame, dtSec, input, collision);
        this.handleStateSwitch(avState, avatar, avatars, frame, dtSec, input);
        avatar.state.state = avState;
    }

    private handleStateSwitch(avState: AvatarState, avatar: Avatar, avatars: Avatar[], frame: number, dtSec: number, input: UserCommand) {
        if (avState !== avatar.state.state) {
            this.stateStartFrame = frame;

            if (avState === AvatarState.AttackSide || avState === AvatarState.AttackPunch || avState === AvatarState.AttackVertical) {
                avatar.attack = new Attack(avatar, avState);
                if (avState === AvatarState.AttackPunch) {
                    this.rollOrigin = avatar.state.origin;
                }
            } else {
                avatar.attack = null;
            }

            if (avatar.state.state === AvatarState.Struck) {
                avatar.hitBy.length = 0;
                vec3.zero(this.hitVelocity);
            }
        }
    }

    private legacyEvaluateLate(avatar: Avatar, avatars: Avatar[], frame: number, dtSec: number, input: UserCommand, collision: CollisionSystem): AvatarState {
        const prevState = avatar.state;
        let avState: AvatarState = prevState.state;

        if (avatar.skeleton) {
            const hits = collision.getHitsForTarget(avatar.collisionId);
            if (hits.length > 0) {
                for (const hit of hits) {
                    const attack = hit.owner;
                    if (evaluateHit(avatar, attack, frame)) {
                        avatar.hitBy.push(attack);
                    }
                }

                if (avatar.hitBy.length > 0 && avatar.state.state !== AvatarState.Struck) {
                    avState = AvatarState.Struck;
                }
            }
        }

        return avState;
    }

    private legacyEvaluate(avatar: Avatar, avatars: Avatar[], frame: number, dtSec: number, input: UserCommand): AvatarState {
        const prevState = avatar.state;
        let avState: AvatarState = prevState.state;
        const duration = frame - prevState.stateStartFrame;

        if (avState === AvatarState.Struck) {
            if (duration > 34 && prevState.origin[1] <= 0.0) {
                avState = AvatarState.None;
            }
        } else {
            // Attacking
            if (!defined(avatar.attack)) {
                let attackState;
                if (input.actions & InputAction.AttackSide) { attackState = AvatarState.AttackSide; }
                if (input.actions & InputAction.AttackVert) { attackState = AvatarState.AttackVertical; }
                if (input.actions & InputAction.AttackPunch) { attackState = AvatarState.AttackPunch; }

                if (attackState) {
                    avState = attackState;
                }
            } else {
                if (duration >= avatar!.attack.def.duration) { // @HACK: Need to set up proper exiting
                    avState = AvatarState.None;
                }
            }
        }

        return avState;
    }

    private legacySimulate(avState: AvatarState, avatar: Avatar, avatars: Avatar[], frame: number, dtSec: number, input: UserCommand) {
        const prevState = avatar.state;
        const nextState = copyEntity(createEntity(), prevState);

        const inputDir = this.getCameraRelativeMovementDirection(input, scratchVec3B);
        const inputActive = vec3.length(inputDir) > 0.1;
        const inputShouldWalk = !!(input.actions & InputAction.Walk);
        let uTurning = !!(prevState.flags & AvatarFlags.IsUTurning);

        let orientation = vec3.clone(prevState.orientation);
        
        nextState.state = avState;
        nextState.stateStartFrame = this.stateStartFrame;
        
        // Targeting
        if (input.actions & InputAction.TargetLeft) {
            const valid = this.lastNonTargetingFrame === frame - 1;
            if (valid) {
                // Find the next target
                // @TODO: This needs to be based on who's in view
                const initialIdx = (avatar.target?.state.id || 0) + 1;
                let target = avatars[initialIdx];
                while (!target.isActive || target.state.id === avatar.state.id) {
                    target = avatars[(target.state.id + 1) % kAvatarCount];
                    if (target.state.id === initialIdx) break;
                }

                if (target.state.id !== avatar.target?.state.id) {
                    avatar.target = target;
                    nextState.flags = setFlag(nextState.flags, AvatarFlags.HasTarget);
                    nextState.flags = setField(nextState.flags, 0b11100000, target.state.id);
                }
            }
        } else {
            this.lastNonTargetingFrame = frame;
        }

        if (input.actions & InputAction.TargetRight) {
            avatar.target = undefined;
            nextState.flags = clearFlags(nextState.flags, AvatarFlags.HasTarget);
        }

        if (avState === AvatarState.Struck) {
            const duration = frame - prevState.stateStartFrame;

            if (this.hitVelocity[0] === 0 && this.hitVelocity[1] === 0 && this.hitVelocity[2] === 0) {
                const attacker = avatar.hitBy[0].instigator;

                const v = vec3.sub(scratchVec3A, prevState.origin, attacker.state.origin);
                const l = Math.sqrt(v[0] * v[0] + v[2] * v[2]) || 0.001;
                const push = vec3.set(scratchVec3B, v[0] / l, 2.0, v[2] / l);
                vec3.scale(this.hitVelocity, push, 1000);
                assert(!Number.isNaN(this.hitVelocity[0]));
                assert(!Number.isNaN(this.hitVelocity[1]));
                assert(!Number.isNaN(this.hitVelocity[2]));
            }

            this.hitVelocity[1] += -9800 * dtSec;
            const pos = vec3.scaleAndAdd(vec3.create(), prevState.origin, this.hitVelocity, dtSec);
            if (pos[1] < 0.0) this.hitVelocity[1] = 0;

            nextState.origin = pos;
            nextState.speed = 0;
            nextState.orientation = orientation;
            nextState.flags = clearFlags(nextState.flags, AvatarFlags.IsUTurning);

            return nextState;
        }

        if (defined(avatar.attack)) {
            const duration = frame - prevState.stateStartFrame;
            const attack = avatar.attack!;

            let toTarget = scratchVec3D;
            let dir = vec3.copy(scratchVec3A, prevState.orientation);
            let moveSpeed = 0;
            let oriVel = 0;
            if (avatar.target && duration >= attack.def.movePeriod[0] && duration <= attack.def.movePeriod[1]) {
                const targetPos = avatar.target.state.origin;
                const targetOri = avatar.target.state.orientation;

                // Rolls are handled a bit differently
                if (attack.type === AvatarState.AttackPunch) {
                    const frameRange = attack.def.movePeriod[1] - attack.def.movePeriod[0];
                    const range = attack.def.moveSpeed * 0.016 * frameRange;
                    const t = Math.min(1.0, duration / frameRange);
                    
                    const attackVec = vec3.subtract(scratchVec3D, targetPos, this.rollOrigin);
                    const targetDist = vec3.length(attackVec);
                    
                    const idealOffset = vec3.normalize(scratchVec3B, rotateXZ(scratchVec3B, attackVec, - Math.PI * 0.7));
                    const idealPos = vec3.scaleAndAdd(scratchVec3A, targetPos, idealOffset, -attack.def.idealDistance);

                    // Interpolate position along the curve
                    const normEnd = normToLength(idealOffset, 2 * targetDist);
                    const normStart = normToLength(rotateXZ(scratchVec3C, attackVec, Math.PI * 0.4), 3 * targetDist);
                    const posStart = this.rollOrigin;
                    const posEnd = idealPos;
                    nextState.origin[0] = getPointHermite(posStart[0], posEnd[0], normStart[0], normEnd[0], t);
                    nextState.origin[2] = getPointHermite(posStart[2], posEnd[2], normStart[2], normEnd[2], t);

                    // Modify orientation to look at target
                    oriVel = Math.PI * 2;
                    toTarget = vec3.subtract(toTarget, targetPos, prevState.origin);
                    rotateTowardXZ(nextState.orientation, prevState.orientation, toTarget, oriVel * dtSec);
                    assert(Math.abs(1.0 - vec3.length(nextState.orientation)) < 0.001);

                    // @DEBUG
                    const debugPos: vec3[] = [];
                    const debugNorm: vec3[] = [];
                    const kSampleCount = 8;
                    for (let i = 0; i < kSampleCount; i++) {
                        const pos = vec3.create();
                        const x = i / (kSampleCount-1);

                        pos[0] = getPointHermite(posStart[0], posEnd[0], normStart[0], normEnd[0], x);
                        pos[2] = getPointHermite(posStart[2], posEnd[2], normStart[2], normEnd[2], x);

                        debugPos[i] = pos;
                        if (i > 0) debugNorm[i-1] = vec3.subtract(vec3.create(), pos, debugPos[i-1]);
                    }
                    debugNorm[kSampleCount-1] = vec3.create();
                    DebugRenderUtils.renderArrows(debugPos, debugNorm, 10, true, vec4.fromValues(0, 1, 0, 1));

                    nextState.flags = clearFlags(nextState.flags, AvatarFlags.IsUTurning);
                    nextState.speed = 0;
                    return nextState;
                } else {                                 
                    // Normalized XZ direction from avatar to target
                    const v = vec3.subtract(toTarget, targetPos, prevState.origin);
                    v[1] = 0;
                    const l = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
                    vec3.scale(v, v, 1.0 / l);

                    // Signed distance to travel along v to reach ideal position
                    const d = l - attack.def.idealDistance;
                    vec3.scale(dir, v, Math.sign(d));

                    // Ensure we don't travel past our ideal position this frame
                    moveSpeed = Math.min(attack.def.moveSpeed, Math.abs(d) / dtSec);

                    // Modify orientation to look at target
                    oriVel = Math.PI * 2;

                    // If we have leftover running momentum, apply it
                    const kGroundDecel = -1000;
                    const contrib = Math.max(0, vec3.dot(prevState.orientation, nextState.orientation));
                    const slideSpeed = prevState.speed * contrib;
                    nextState.speed = Math.max(0, prevState.speed + kGroundDecel * dtSec);

                    const vel = vec3.scale(scratchVec3A, dir, moveSpeed + slideSpeed);
                    vec3.scaleAndAdd(nextState.origin, prevState.origin, vel, dtSec);

                    rotateTowardXZ(nextState.orientation, prevState.orientation, toTarget, oriVel * dtSec);
                    assert(Math.abs(1.0 - vec3.length(nextState.orientation)) < 0.001);

                    nextState.flags = clearFlags(nextState.flags, AvatarFlags.IsUTurning);
                    return nextState;
                }
            }
        }

        // Velocity
        let speed = prevState.speed;
        const accel = inputShouldWalk ? kWalkAcceleration : kRunAcceleration;
        let maxSpeed = inputShouldWalk ? kAvatarWalkSpeed : kAvatarRunSpeed;
        if (nextState.state !== AvatarState.None) maxSpeed = 10;

        const dSpeed = (inputActive ? accel : -accel) * dtSec;
        const targetSpeed = clamp(speed + dSpeed, 0, maxSpeed);

        speed += clamp(
            targetSpeed - speed,
            -accel * dtSec,
            accel * dtSec,
        );

        const velocity = vec3.scale(vec3.create(), prevState.orientation, speed);

        // Position
        const pos = vec3.scaleAndAdd(vec3.create(), prevState.origin, velocity, dtSec);

        // Orientation
        let shouldTurn = inputActive;

        let standingTurnSpeed = Math.PI * 3.75; // 4 30ms frames to turn 90 degrees
        let walkingTurnSpeed = Math.PI * 1.875; // 8 30ms frames to turn 90 degrees
        let runningTurnSpeed = Math.PI * 1.875; // 8 30ms frames to turn 90 degrees

        // State transitions
        if (uTurning) {
            // Uturn complete when we achieve the initial orientation target
            if (vec3.dot(orientation, this.orientationTarget) > 0.99) {
                uTurning = false;
            }
        } else {
            // Start a 180 if we have a sharp input pointing directly away from our current orientation 
            if (vec3.dot(inputDir, this.orientationTarget) < -0.99) {
                uTurning = true;
                vec3.copy(this.orientationTarget, inputDir);
            }
        }

        const walking = speed > 0;

        // State evaluations
        let turnSpeedRadsPerSec = walking ? walkingTurnSpeed : standingTurnSpeed;
        if (uTurning) {
            shouldTurn = true; // Don't require user input to complete the 180
            turnSpeedRadsPerSec *= 2.0;
            this.orientationTarget = this.orientationTarget; // Don't update orientation target
        } else {
            if (inputActive) vec3.copy(this.orientationTarget, inputDir);
        }

        // Each frame, turn towards the input direction by a fixed amount, but only if the input is pressed. 
        // It takes 8 16ms frames to turn 90 degrees. So a full rotation takes about half of a second.
        if (shouldTurn) {
            const heading = Math.atan2(prevState.orientation[0], prevState.orientation[2]);
            const targetHeading = Math.atan2(this.orientationTarget[0], this.orientationTarget[2]);

            let angleDelta = angularDistance(heading, targetHeading);
            const turnCap = turnSpeedRadsPerSec * dtSec;

            const rotation = clamp(angleDelta, -turnCap, turnCap);
            vec3.rotateY(orientation, prevState.orientation, ZeroVec3, rotation);
        }

        nextState.flags = setFlag(nextState.flags, AvatarFlags.IsWalking, inputShouldWalk);
        nextState.flags = setFlag(nextState.flags, AvatarFlags.IsUTurning, uTurning);
        nextState.flags = setFlag(nextState.flags, AvatarFlags.IsActive);

        nextState.origin = pos;
        nextState.speed = speed;
        nextState.orientation = orientation;

        return nextState;
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