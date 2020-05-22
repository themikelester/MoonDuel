import { AvatarFlags, AvatarState, Avatar } from "./Avatar";
import { vec3 } from "gl-matrix";
import { InputAction } from "./Input";
import { clamp, angularDistance, ZeroVec3 } from "./MathHelpers";
import { UserCommand } from "./UserCommand";
import { EntityState, copyEntity, createEntity } from "./World";

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
    
    update(avatar: Avatar, frame: number, dtSec: number, input: UserCommand): EntityState {
        const state = avatar.state;

        // @HACK:
        const prevState = copyEntity(createEntity(), state);
        const nextState = state;
        
        const inputDir = this.getCameraRelativeMovementDirection(input, scratchVec3B);
        const inputActive = vec3.length(inputDir) > 0.1;
        const inputShouldWalk = input.actions & InputAction.Walk;

        let orientation = vec3.clone(prevState.orientation);
        let uTurning = !!(prevState.flags & AvatarFlags.IsUTurning);

        // Attacking
        if (prevState.state !== AvatarState.None) {
            const duration = frame - prevState.stateStartFrame;
            if (duration >= 69) { // @HACK: Need to set up proper exiting
                nextState.state = AvatarState.None;
                nextState.stateStartFrame = frame;
            }
        } else {
            if (input.actions & InputAction.AttackSide) {
                nextState.stateStartFrame = frame;
                nextState.state = AvatarState.AttackSide;
            }
            if (input.actions & InputAction.AttackVert) {
                nextState.stateStartFrame = frame;
                nextState.state = AvatarState.AttackVertical;
            }
        }

        if (prevState.state === AvatarState.Struck) {
            const duration = frame - prevState.stateStartFrame;
            if (duration > 34) {
                avatar.hitBy.length = 0;

                nextState.state = AvatarState.None; 
                nextState.stateStartFrame = frame;
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