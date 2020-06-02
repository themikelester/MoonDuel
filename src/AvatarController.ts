import { AvatarFlags, Avatar, kAvatarCount } from "./Avatar";
import { vec3, quat } from "gl-matrix";
import { InputAction } from "./Input";
import { clamp, angularDistance, ZeroVec3, normToLength, rotateTowardXZ } from "./MathHelpers";
import { UserCommand } from "./UserCommand";
import { EntityState, copyEntity, createEntity } from "./World";
import { assert, defined } from "./util";
import { Attack } from "./Attack";
import { AvatarState } from "./AvatarState";

const scratchVec3A = vec3.create();
const scratchVec3B = vec3.create();

export const kAvatarWalkSpeed = 150; // Units per second
export const kAvatarRunSpeed = 600; // Units per second
const kWalkAcceleration = 600;
const kRunAcceleration = 3000;

/**
 * Drive each Avatar's skeleton, position, oriention, and animation
 */
export class AvatarController {
    orientationTarget: vec3 = vec3.create();
    hitVelocity: vec3 = vec3.create();
    lastNonTargetingFrame = 0;
    
    update(avatar: Avatar, avatars: Avatar[], frame: number, dtSec: number, input: UserCommand): EntityState {
        const state = avatar.state;

        // @HACK:
        const prevState = copyEntity(createEntity(), state);
        const nextState = state;
        
        const inputDir = this.getCameraRelativeMovementDirection(input, scratchVec3B);
        const inputActive = vec3.length(inputDir) > 0.1;
        const inputShouldWalk = input.actions & InputAction.Walk;

        let orientation = vec3.clone(prevState.orientation);
        let uTurning = !!(prevState.flags & AvatarFlags.IsUTurning);

        // Targeting
        if (input.actions & InputAction.TargetLeft || input.actions & InputAction.TargetRight) {
            const valid = this.lastNonTargetingFrame === frame-1;
            if (valid) {
                // Find the next target
                // @TODO: This needs to be based on who's in view
                const initialIdx = (avatar.target?.state.id || 0) + 1;
                let target = avatars[initialIdx];
                while (!target.isActive || target.state.id === avatar.state.id) { 
                    target = avatars[(target.state.id  + 1) % kAvatarCount];
                    if (target.state.id === initialIdx) break;
                }

                if (target.state.id !== avatar.target?.state.id) avatar.target = target;
            }
        } else {
            this.lastNonTargetingFrame = frame;
        }

        if (prevState.state === AvatarState.Struck) {
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
            
            if (duration > 34 && pos[1] <= 0.0) {
                avatar.hitBy.length = 0;

                nextState.state = AvatarState.None; 
                nextState.stateStartFrame = frame;
                vec3.zero(this.hitVelocity);
            }

            nextState.origin = pos;
            nextState.speed = 0;
            nextState.orientation = orientation;
            nextState.flags = AvatarFlags.IsActive;

            return nextState;
        }

        // Attacking
        if (!defined(avatar.attack)) {
            let attackState;
            if (input.actions & InputAction.AttackSide) { attackState = AvatarState.AttackSide; }
            if (input.actions & InputAction.AttackVert) { attackState = AvatarState.AttackVertical; }
            if (input.actions & InputAction.AttackPunch) { attackState = AvatarState.AttackPunch; }
            
            if (attackState) {
                nextState.state = attackState;
                nextState.stateStartFrame = frame;
                avatar.attack = new Attack(avatar, attackState);
            }
        } else {
            const duration = frame - prevState.stateStartFrame;
            if (duration >= avatar!.attack.def.duration) { // @HACK: Need to set up proper exiting
                nextState.state = AvatarState.None;
                nextState.stateStartFrame = frame;
                avatar.attack = null;
            }
        }

        if (defined(avatar.attack)) {
            const duration = frame - prevState.stateStartFrame;
            const attack = avatar.attack!;
            
            let toTarget = scratchVec3B;
            let dir = vec3.copy(scratchVec3A, prevState.orientation);
            let moveSpeed = 0;
            let oriVel = 0;
            if (avatar.target && duration >= attack.def.movePeriod[0] && duration <= attack.def.movePeriod[1]) {
                const targetPos = avatar.target.state.origin;
                
                // Normalized XZ direction from avatar to target
                const v = vec3.subtract(toTarget, targetPos, prevState.origin);
                v[1] = 0;
                const l = Math.sqrt(v[0]*v[0] + v[2]*v[2]);
                vec3.scale(v, v, 1.0 / l);

                // Signed distance to travel along v to reach ideal position
                const d = l - attack.def.idealDistance;
                vec3.scale(dir, v, Math.sign(d));

                // Ensure we don't travel past our ideal position this frame
                moveSpeed = Math.min(attack.def.moveSpeed, Math.abs(d) / dtSec);

                // Modify orientation to look at target
                oriVel = Math.PI * 2;
            }

            // If we have leftover running momentum, apply it
            const kGroundDecel = -1600;
            const contrib = Math.max(0, vec3.dot(prevState.orientation, nextState.orientation));
            const slideSpeed = prevState.speed * contrib;
            nextState.speed = Math.max(0, prevState.speed + kGroundDecel * dtSec);

            const vel = vec3.scale(scratchVec3A, dir, moveSpeed + slideSpeed);
            vec3.scaleAndAdd(nextState.origin, prevState.origin, vel, dtSec);

            rotateTowardXZ(nextState.orientation, prevState.orientation, toTarget, oriVel * dtSec);
            assert(Math.abs(1.0 - vec3.length(nextState.orientation)) < 0.001);

            nextState.flags = AvatarFlags.IsActive;
            return nextState;
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

        let flags = prevState.flags & ~(AvatarFlags.IsWalking | AvatarFlags.IsUTurning);
        if (inputShouldWalk) flags |= AvatarFlags.IsWalking;
        if (uTurning) flags |= AvatarFlags.IsUTurning;

        nextState.origin = pos;
        nextState.speed = speed;
        nextState.orientation = orientation;
        nextState.flags = flags;

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