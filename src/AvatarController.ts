import { AvatarFlags, Avatar, kAvatarCount } from "./Avatar";
import { vec3, quat, vec4 } from "gl-matrix";
import { InputAction } from "./Input";
import { clamp, angularDistance, ZeroVec3, normToLength, rotateTowardXZ, rotateXZ, lerp, getPointHermite } from "./MathHelpers";
import { UserCommand, kEmptyCommand } from "./UserCommand";
import { EntityState, copyEntity, createEntity } from "./World";
import { assert, defined, assertDefined } from "./util";
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
}

abstract class AvatarStateController {
    protected startFrame: number;
    protected state: AvatarState;
    
    private lastNonTargetingFrame = 0;

    // Called when the avatar transitions to this state from another
    // @NOTE: Both entry and exit are called before simulate, and may modify the context.state
    enter(context: SimContext, state: AvatarState): void {
        this.startFrame = context.frame;
        this.state = state;
    };

    // Called when the avatar transitions out of this state
    // @NOTE: Both entry and exit are called before simulate, and may modify the context.state
    abstract exit(context: SimContext): void;

    // Determines the state of the avatar for this frame. If it differs from last frame, a state transition occurs.
    // exit() and enter() will then be called, before the new state controller's simulate() is called.
    abstract evaluate(context: SimContext): AvatarState;

    // Called after evaluate/simulate has completed for all Avatars. Useful for things like collision detection. 
    // If this triggers a state change, exit()/enter() will be called immediately before the frame ends.
    evaluateLate(context: SimContext): AvatarState {
        const prevState = context.avatar.state;
        let avState: AvatarState = prevState.state;

        // Check for hits (and transition to the Struck state) only after all Avatar positions have been resolved
        if (context.avatar.skeleton) {
            const hits = context.collision.getHitsForTarget(context.avatar.collisionId);
            if (hits.length > 0) {
                for (const hit of hits) {
                    const attack = hit.owner;
                    if (evaluateHit(context.avatar, attack, context.frame)) {
                        context.avatar.hitBy.push(attack);
                    }
                }

                if (context.avatar.hitBy.length > 0 && context.avatar.state.state !== AvatarState.Struck) {
                    avState = AvatarState.Struck;
                }
            }
        }

        return avState;
    }

    // Create a new EntityState for the Avatar for this simulation frame
    simulate(context: SimContext): EntityState {
        const nextState = copyEntity(createEntity(), context.state);

        // Targeting
        if (context.input.actions & InputAction.TargetLeft) {
            const valid = this.lastNonTargetingFrame === context.frame - 1;
            if (valid) {
                // Find the next target
                // @TODO: This needs to be based on who's in view
                const initialIdx = (context.avatar.target?.state.id || 0) + 1;
                let target = context.avatars[initialIdx];
                while (!target.isActive || target.state.id === context.avatar.state.id) {
                    target = context.avatars[(target.state.id + 1) % kAvatarCount];
                    if (target.state.id === initialIdx) break;
                }

                if (target.state.id !== context.avatar.target?.state.id) {
                    context.avatar.target = target;
                    nextState.flags = setFlag(nextState.flags, AvatarFlags.HasTarget);
                    nextState.flags = setField(nextState.flags, 0b11100000, target.state.id);
                }
            }
        } else {
            this.lastNonTargetingFrame = context.frame;
        }

        if (context.input.actions & InputAction.TargetRight) {
            context.avatar.target = undefined;
            nextState.flags = clearFlags(nextState.flags, AvatarFlags.HasTarget);
        }

        nextState.state = this.state;
        nextState.stateStartFrame = this.startFrame;

        return nextState;
    }
}

class AttackRoll extends AvatarStateController {
    rollOrigin: vec3 = vec3.create();

    enter(context: SimContext, state: AvatarState) {
        super.enter(context, state);

        context.avatar.attack = new Attack(context.avatar, state);
        vec3.copy(this.rollOrigin, context.state.origin);
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
        const nextState = super.simulate(context);
        const prevState = context.state;

        const duration = context.frame - prevState.stateStartFrame;
        const attack = context.avatar.attack!;

        if (context.avatar.target && duration >= attack.def.movePeriod[0] && duration <= attack.def.movePeriod[1]) {
            const targetPos = context.avatar.target.state.origin;
            const targetOri = context.avatar.target.state.orientation;

            // Rolls are handled a bit differently
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

        nextState.state = AvatarState.AttackPunch;
        nextState.stateStartFrame = this.startFrame;
        nextState.speed = 0;
        return nextState;
    }
}

class AttackBase extends AvatarStateController {
    rollOrigin: vec3 = vec3.create();

    enter(context: SimContext, state: AvatarState) {
        super.enter(context, state);

        context.avatar.attack = new Attack(context.avatar, state);

        vec3.copy(this.rollOrigin, context.state.origin);
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
        const nextState = super.simulate(context);

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

        nextState.state = this.state;
        nextState.stateStartFrame = this.startFrame;
        return nextState;
    }
}

class Struck extends AvatarStateController {
    hitVelocity: vec3 = vec3.create();

    enter(context: SimContext, state: AvatarState) {
        super.enter(context, state);

        const attacker = context.avatar.hitBy[0].instigator;

        const v = vec3.sub(scratchVec3A, context.state.origin, attacker.state.origin);
        const l = Math.sqrt(v[0] * v[0] + v[2] * v[2]) || 0.001;
        const push = vec3.set(scratchVec3B, v[0] / l, 2.0, v[2] / l);
        vec3.scale(this.hitVelocity, push, 1000);
        assert(!Number.isNaN(this.hitVelocity[0]));
        assert(!Number.isNaN(this.hitVelocity[1]));
        assert(!Number.isNaN(this.hitVelocity[2]));
    }

    exit(context: SimContext) {
        context.avatar.hitBy.length = 0;
        vec3.zero(this.hitVelocity);
    }

    evaluate(context: SimContext) {
        const duration = context.frame - context.state.stateStartFrame;

        if (duration > 34 && context.state.origin[1] <= 0.0) {
            return AvatarState.None;
        }
        
        return context.state.state;
    }

    simulate(context: SimContext) {
        const nextState = super.simulate(context);

        this.hitVelocity[1] += -9800 * context.dtSec;
        const pos = vec3.scaleAndAdd(vec3.create(), context.state.origin, this.hitVelocity, context.dtSec);
        if (pos[1] < 0.0) this.hitVelocity[1] = 0;

        nextState.state = AvatarState.Struck;
        nextState.stateStartFrame = this.startFrame;
        nextState.origin = pos;
        nextState.speed = 0;

        return nextState;
    }
}

class Default extends AvatarStateController {
    orientationTarget: vec3 = vec3.create();

    enter(context: SimContext, state: AvatarState) {
        super.enter(context, state);
    }

    exit(context: SimContext) {
        context.state.flags = clearFlags(context.state.flags, AvatarFlags.IsUTurning);
    }

    evaluate(context: SimContext) {
        const prevState = context.avatar.state;
        let avState: AvatarState = prevState.state;
        
        // Attacking
        let attackState;
        if (context.input.actions & InputAction.AttackSide) { attackState = AvatarState.AttackSide; }
        if (context.input.actions & InputAction.AttackVert) { attackState = AvatarState.AttackVertical; }
        if (context.input.actions & InputAction.AttackPunch) { attackState = AvatarState.AttackPunch; }

        if (attackState) {
            avState = attackState;
        }

        return avState;
    }

    simulate(context: SimContext) {
        const nextState = super.simulate(context);
        
        const prevState = context.avatar.state;
        const avatar = context.avatar;

        const inputDir = this.getCameraRelativeMovementDirection(context.input, scratchVec3B);
        const inputActive = vec3.length(inputDir) > 0.1;
        const inputShouldWalk = !!(context.input.actions & InputAction.Walk);
        let uTurning = !!(prevState.flags & AvatarFlags.IsUTurning);

        let orientation = vec3.clone(prevState.orientation);

        // Velocity
        let speed = prevState.speed;
        const accel = inputShouldWalk ? kWalkAcceleration : kRunAcceleration;
        let maxSpeed = inputShouldWalk ? kAvatarWalkSpeed : kAvatarRunSpeed;
        if (nextState.state !== AvatarState.None) maxSpeed = 10;

        const dSpeed = (inputActive ? accel : -accel) * context.dtSec;
        const targetSpeed = clamp(speed + dSpeed, 0, maxSpeed);

        speed += clamp(
            targetSpeed - speed,
            -accel * context.dtSec,
            accel * context.dtSec,
        );

        const velocity = vec3.scale(vec3.create(), prevState.orientation, speed);

        // Position
        const pos = vec3.scaleAndAdd(vec3.create(), prevState.origin, velocity, context.dtSec);

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
            const turnCap = turnSpeedRadsPerSec * context.dtSec;

            const rotation = clamp(angleDelta, -turnCap, turnCap);
            vec3.rotateY(orientation, prevState.orientation, ZeroVec3, rotation);
        }

        nextState.flags = setFlag(nextState.flags, AvatarFlags.IsWalking, inputShouldWalk);
        nextState.flags = setFlag(nextState.flags, AvatarFlags.IsUTurning, uTurning);
        nextState.flags = setFlag(nextState.flags, AvatarFlags.IsActive);

        nextState.origin = pos;
        nextState.speed = speed;
        nextState.orientation = orientation;
        
        nextState.state = AvatarState.None;
        nextState.stateStartFrame = this.startFrame;

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

/**
 * Drive each Avatar's skeleton, position, oriention, and animation
 */
export class AvatarController {
    stateControllers: Partial<Record<AvatarState, AvatarStateController>>;

    initialize(avatar: Avatar, avatars: Avatar[], collision: CollisionSystem) {
        this.stateControllers = {
            [AvatarState.None]: new Default(),
            [AvatarState.AttackPunch]: new AttackRoll(),
            [AvatarState.AttackSide]: new AttackBase(),
            [AvatarState.AttackVertical]: new AttackBase(),
            [AvatarState.Struck]: new Struck(),
        }

        const context: SimContext = { avatar, avatars, frame: 0, dtSec: 0, input: kEmptyCommand, collision, state: avatar.state };
        this.stateControllers[AvatarState.None]!.enter(context, AvatarState.None);
    }

    update(avatar: Avatar, avatars: Avatar[], frame: number, dtSec: number, input: UserCommand, collision: CollisionSystem): EntityState {
        const context: SimContext = { avatar, avatars, frame, dtSec, input, collision, state: avatar.state };

        let nextState: AvatarState;
        let stateCtrl = assertDefined(this.stateControllers[context.state.state as AvatarState]);

        nextState = stateCtrl.evaluate(context);

        // Switch states if necessary
        if (nextState !== context.state.state) { 
            stateCtrl.exit(context); 
            stateCtrl = assertDefined(this.stateControllers[nextState]);
            stateCtrl.enter(context, nextState);
        } 

        // Run the simulation
        const state = stateCtrl.simulate(context);
        assert(defined(state.stateStartFrame));
        assert(defined(state.state));
        
        avatar.state = state;
        return state;
    }

    updateLate(avatar: Avatar, avatars: Avatar[], frame: number, dtSec: number, input: UserCommand, collision: CollisionSystem) {
        const context: SimContext = { avatar, avatars, frame, dtSec, input, collision, state: avatar.state };
        
        let stateCtrl = assertDefined(this.stateControllers[context.state.state as AvatarState]);
        const nextState = stateCtrl.evaluateLate(context);

        // Switch states if necessary
        if (nextState !== context.state.state) { 
            let nextStateCtrl = assertDefined(this.stateControllers[nextState]);

            stateCtrl.exit(context); 
            nextStateCtrl.enter(context, nextState);

            avatar.state.state = nextState;
        } 
    }
}